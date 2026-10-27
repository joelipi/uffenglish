// modules/speech-orchestrator.js - Platform-agnostic speech orchestrator factory
import * as Core from './speech.core.js';
import { validateAnswerPrecheck, findMatchingCueText } from '../answer/answers.js';
import { appStore } from '../store/store.js';
import Strings from '../../data/strings.js';
import { getAppLanguage } from '../bilingual/config-normalizer.js';
import { decideRerecordAction, RERECORD_DECISIONS } from './rerecord-logic.js';
import { isPreviewGateStep, applyStepLookOverlaysOnce } from '../looks/recording-looks-logic.js';
import { resolveReviewCountdownStart, shouldAutoAcceptReview } from '../lesson/review-countdown-logic.js';

function computeWaveformPeaks(audioData, numPeaks = 120) {
    const blockSize = Math.max(1, Math.floor(audioData.length / numPeaks));
    const peaks = new Float32Array(numPeaks);
    for (let i = 0; i < numPeaks; i++) {
        let max = 0;
        const start = i * blockSize;
        const end = Math.min(start + blockSize, audioData.length);
        for (let j = start; j < end; j++) {
            const abs = Math.abs(audioData[j]);
            if (abs > max) max = abs;
        }
        peaks[i] = max;
    }
    return peaks;
}

export function createSpeechOrchestrator({
    startSpeechCamRecording,
    startDeferredSpeechCamRecording,
    stopSpeechCamRecording,
    getSpeechCamStream,
    safelyStopStream,
    startLocalAudioTap,
    stopLocalAudioTap,
    transcribeAudioBuffer,
    preloadWhisperEngine,
    updateSpeechRecording,
}) {
    const listeningState = { active: false, hesitationTimer: null, readyPoll: null, transitioning: false };

    function clearReadyPoll() {
        if (listeningState.readyPoll) {
            clearInterval(listeningState.readyPoll);
            listeningState.readyPoll = null;
        }
    }

    function initLocalVoiceAI() {
        return preloadWhisperEngine();
    }

    function stopListeningEarly(userData, player, uiHooks) {
        console.warn('[Speech] stopListeningEarly called');
        if (player) player.play();
        if (uiHooks?.onStopEarly) uiHooks.onStopEarly(userData);
    }

    async function processTranscript({ transcript, timingMeta, checkGibberish = false, logprob = 0, params, player }) {
        const { button, step, userData, configData, currentLessonIndex, currentStepIndex, handleAnswer, uiHooks } = params;

        console.warn('[PT] ENTERED', { hasTranscript: !!transcript, checkGibberish, hasUiHooks: !!uiHooks, hasOnReviewStart: !!uiHooks?.onReviewStart });

        if (!transcript) {
            console.warn('[PT] EXIT: empty transcript');
            stopListeningEarly(userData, player, uiHooks);
            return;
        }

        if (checkGibberish && Core.isGibberish(logprob)) {
            console.warn('[PT] EXIT: gibberish', { logprob });
            if (uiHooks?.onGibberishDetected) uiHooks.onGibberishDetected();
            stopListeningEarly(null, player, uiHooks);

            updateSpeechRecording(
                configData?.lessons?.[currentLessonIndex]?.lessonId,
                currentStepIndex,
                { userResponse: transcript, cue: step?.cue }
            ).catch(e => console.error(e));
            return;
        }

        const processedTranscript = Core.cleanTranscript(transcript);
        const transcriptToReview = processedTranscript || transcript;

        console.warn('[PT] VALIDATING', { transcriptToReview: transcriptToReview.substring(0, 30) });

        const rejectPreflight = (warningMessage) => {
            appStore.getState().clearPlaybackBlob();
            appStore.getState().clearRecordedAudioPeaks();
            if (uiHooks?.onPreflightRejected) uiHooks.onPreflightRejected(warningMessage);

            updateSpeechRecording(
                configData?.lessons?.[currentLessonIndex]?.lessonId,
                currentStepIndex,
                { userResponse: transcriptToReview, cue: step?.cue }
            ).catch(e => console.error(e));
        };

        const courseLevel = configData?.courseLevel || 'A0';
        const { isValid, warningMessage } = await validateAnswerPrecheck(
            transcriptToReview, step.cue, step, courseLevel, userData, appStore.getState().responsesGiven
        );

        if (!isValid) { rejectPreflight(warningMessage); return; }

        // ── closedResponse homophone / near-match check ────────────────
        // Whisper often transcribes homophones (to/too, rules/roles) or
        // near-identical words.  When the user's spoken response matches a
        // cue variant (plain string, array, template, or regex), show the
        // canonical cue text for confirmation so the user isn't confused
        // by a slightly-off transcription.
        let displayTranscript = transcriptToReview;
        if ((step.responseType === 'closedResponse' || step.responseType === 'friendClosedResponse') && step.cue) {
            try {
                const matchedCue = await findMatchingCueText(transcriptToReview, step.cue, step);
                if (matchedCue) {
                    displayTranscript = matchedCue;
                    console.log('[PT] closedResponse homophone match — showing cue instead of transcript', {
                        transcript: transcriptToReview, cue: matchedCue
                    });
                }
            } catch (e) {
                console.warn('[PT] closedResponse homophone check failed, using raw transcript:', e);
            }
        }

        // `null` when the countdown is switched off (it is, by default): the
        // review then has no timer and the learner accepts or re-records when
        // they are ready. See review-countdown-logic.js.
        let timeLeft = resolveReviewCountdownStart();
        let reviewActive = true;
        // The ticker is created only when there is a countdown; every stop site
        // goes through this, so accepting/rejecting always cancels it.
        let timerInterval = null;
        const stopReviewCountdown = () => {
            if (timerInterval !== null) {
                clearInterval(timerInterval);
                timerInterval = null;
            }
        };

        const acceptTranscript = () => {
            if (!reviewActive) return;
            reviewActive = false;
            stopReviewCountdown();

            if (uiHooks?.onReviewEnd) uiHooks.onReviewEnd('feedback');

            handleAnswer(
                transcriptToReview,
                step.cue,
                step,
                button,
                step.explanation,
                timingMeta,
                userData,
                configData
            );
        };

        // The review "record again" (✕) button is a single press: it re-enters
        // the exact same mic path the first tap takes — stream → camera preview
        // → 3-2-1 countdown → take — instead of parking the learner on an idle
        // `recording/answering` screen that needs a second press. Called after
        // `onTranscriptRejected` so the app is already in `recording/answering`
        // when `onRecordingStart` fires (its guard treats that phase as an
        // in-step retry and leaves it alone).
        const restartTakeAfterReject = () => {
            const decision = decideRerecordAction({
                listeningActive: listeningState.active,
                transitioning: listeningState.transitioning,
            });
            if (decision !== RERECORD_DECISIONS.restart) {
                // Not a dead end: `onTranscriptRejected` already put the app in
                // `recording/answering`, so the mic button is mounted and the
                // manual second press still works.
                console.warn('[Speech] Re-record not started —', decision);
                return;
            }
            console.log('[Speech] Re-record pressed — restarting the take immediately');
            toggleSpeechRecognition(params).catch((e) => {
                console.error('[Speech] Re-record could not start a new take:', e);
            });
        };

        const rejectTranscript = () => {
            if (!reviewActive) return;
            reviewActive = false;
            stopReviewCountdown();
            appStore.getState().clearPlaybackBlob();
            appStore.getState().clearRecordedAudioPeaks();

            if (uiHooks?.onTranscriptRejected) uiHooks.onTranscriptRejected(step?.cue, transcriptToReview);

            updateSpeechRecording(
                configData?.lessons?.[currentLessonIndex]?.lessonId,
                currentStepIndex,
                { userResponse: transcriptToReview, cue: step?.cue }
            ).catch(e => console.error(e));

            restartTakeAfterReject();
        };

        console.warn('[PT] CALLING onReviewStart', { displayTranscript: displayTranscript.substring(0, 30), transcriptToReview: transcriptToReview.substring(0, 30), timeLeft });
        if (uiHooks?.onReviewStart) uiHooks.onReviewStart(displayTranscript, timeLeft, acceptTranscript, rejectTranscript);

        // The countdown is suppressed unless review-countdown-logic.js enables
        // it: with no timer there is nothing to tick and nothing that accepts on
        // the learner's behalf, so the decision waits for them.
        if (timeLeft === null) {
            console.log('[PT] review countdown disabled — the learner decides when to accept or re-record');
            return;
        }

        timerInterval = setInterval(() => {
            if (!reviewActive) return stopReviewCountdown();
            timeLeft--;
            if (uiHooks?.onReviewUpdate) uiHooks.onReviewUpdate(timeLeft);
            if (shouldAutoAcceptReview({ timeLeft })) acceptTranscript();
        }, 1000);
    }

    async function toggleSpeechRecognition(params) {
        if (listeningState.transitioning) {
            console.warn('[Speech] toggleSpeechRecognition called while transitioning, ignoring.');
            return;
        }
        listeningState.transitioning = true;
        try {
            clearReadyPoll();

            if (listeningState.hesitationTimer) {
                console.log('[Hesitation] Top-level cleanup: killing existing timer');
                clearInterval(listeningState.hesitationTimer);
                listeningState.hesitationTimer = null;
            }

            const { button, step, micStatusText, userData, configData, currentLessonIndex, currentStepIndex, player, uiHooks, trackHesitation = true } = params;

            if (uiHooks?.onPauseVideo) uiHooks.onPauseVideo(player);

            if (!listeningState.active) {
                const openingPreview = isPreviewGateStep(step) && !appStore.getState().awaitingRecordingStart;
                if (isPreviewGateStep(step)) {
                    // A step's config overlays are its DEFAULT look; apply them
                    // once before the composite stream is built so the first
                    // preview frame already carries them.
                    const cfg = configData || appStore.getState().configData;
                    const lessonIdx = currentLessonIndex ?? appStore.getState().currentLessonIndex;
                    const stepIdx = currentStepIndex ?? appStore.getState().currentStepIndex;
                    const lesson = cfg?.lessons?.[lessonIdx];
                    const stepKey = `${lesson?.lessonId || 'lesson'}:${stepIdx}`;
                    applyStepLookOverlaysOnce({
                        stepKey,
                        stepOverlays: step.overlays,
                        store: appStore,
                    });
                }

                listeningState.active = true;
                appStore.getState().clearRecordedAudioPeaks();

                try {
                    // Prepare MediaRecorder but defer actual start until audio tap is ready
                    await startSpeechCamRecording(micStatusText, userData, { deferStart: true });
                } catch (e) {
                    console.error('[Speech] Could not start mic/cam — staying on mode chooser:', e);
                    listeningState.active = false;
                    appStore.getState().setMicActive(false);
                    // The chooser (IntroChoices / DecisionButtons) is still mounted
                    // because we no longer enter recording/answering until media is
                    // acquired. Surface actionable recovery guidance and let the
                    // user retry — do NOT wipe the message or strand them.
                    if (uiHooks?.onMediaError) {
                        uiHooks.onMediaError(e);
                    } else {
                        appStore.getState().setSystemMessage({
                            type: 'media-error',
                            text: Strings.get('error_media_generic', getAppLanguage()) || String(e?.message || e),
                        });
                    }
                    return;
                }

                if (uiHooks?.onMicDisable) uiHooks.onMicDisable(button);

                if (!appStore.getState().isWhisperReady) {
                    listeningState.active = false;
                    appStore.getState().setMicActive(false);
                    console.error('[Speech] Whisper engine not ready');

                    try {
                        stopSpeechCamRecording({ keepStreamAlive: true, download: false, persist: false, playback: false, autoplay: false });
                    } catch (e) {
                        console.warn("Could not abort camera recording", e);
                    }

                    if (uiHooks?.onEngineNotReady) uiHooks.onEngineNotReady(userData);

                    listeningState.readyPoll = setInterval(() => {
                        const state = appStore.getState();
                        if (state.isWhisperReady) {
                            clearReadyPoll();
                            if (uiHooks?.onEngineReady) uiHooks.onEngineReady(button);
                        } else if (state.isWhisperEngineFailed) {
                            clearReadyPoll();
                        }
                    }, 1000);
                    return;
                } else if (openingPreview) {
                    // Step 1 of the two-step friendClosedResponse flow (stories/092):
                    // the Continue button opens the full-screen camera preview with
                    // the look controls and the bottom #micBtn ready (isMicActive:
                    // false, listeningState.active: false). Returning here releases
                    // listeningState.transitioning so tapping #micBtn starts the
                    // take immediately on the next invocation.
                    listeningState.active = false;
                    appStore.getState().setMicActive(false);
                    appStore.getState().setAwaitingRecordingStart(true);
                    if (uiHooks?.onRecordingStart) uiHooks.onRecordingStart(userData);
                    console.log('[Look] preview open — waiting for the microphone tap');
                    return;
                } else {
                    appStore.getState().setAwaitingRecordingStart(false);
                    let speechDetected = false;
                    let speechStarted = false;
                    let pauseTick = 0;
                    const PAUSE_GRACE_TICKS = 10;
                    let lastSpeechTime = Date.now();

                    if (listeningState.hesitationTimer) {
                        clearInterval(listeningState.hesitationTimer);
                        listeningState.hesitationTimer = null;
                    }

                    // The live hesitation timer only feeds the flow score / stat
                    // bubble. Friend/shareCta lessons never show it, so the
                    // caller passes trackHesitation=false to skip the 10 Hz
                    // interval (and its per-tick store writes and logging).
                    if (trackHesitation) {
                        console.log('[Hesitation] Starting new 100ms hesitation timer (1s grace period)');
                        let hesitationTick = 0;
                        let totalHesitationPoints = 0;
                        const GRACE_TICKS = 10;
                        let liveHesitationMs = 0;
                        listeningState.hesitationTimer = setInterval(() => {
                            hesitationTick++;
                            const currentActive = listeningState.active;
                            const isFirstResponse = appStore.getState().appPhase === 'firstResponse';
                            console.log(`[Hesitation] Tick #${hesitationTick} | active=${currentActive} | speechDetected=${speechDetected} | time=${Date.now()}`);
                            if (!speechDetected && currentActive && hesitationTick === GRACE_TICKS + 1) {
                                console.log('[Hesitation] Grace period ended - starting deductions');
                            }
                            if (!speechDetected && currentActive && hesitationTick > GRACE_TICKS) {
                                liveHesitationMs = (hesitationTick - GRACE_TICKS) * 100;
                                appStore.getState().setHesitationMs(liveHesitationMs);
                                if (isFirstResponse) {
                                    console.log(`[Hesitation] firstResponse phase - suppressing 1pt deduction, liveHesitationMs=${liveHesitationMs}`);
                                } else {
                                    console.log(`[Hesitation] SILENCE DETECTED (after grace) \u2192 deducting 1pt, liveHesitationMs=${liveHesitationMs}`);
                                    if (typeof appStore.getState().deductFlowScore === 'function') {
                                        const before = appStore.getState().flowScore;
                                        appStore.getState().deductFlowScore(1);
                                        const after = appStore.getState().flowScore;
                                        console.log(`[Hesitation] flowScore: ${before} \u2192 ${after}`);
                                    }
                                    if (uiHooks?.onHesitation) uiHooks.onHesitation(++totalHesitationPoints);
                                }
                            }

                            if (speechStarted && Date.now() - lastSpeechTime > 1000) {
                                speechDetected = false;
                            }

                            if (speechStarted && !speechDetected && currentActive) {
                                pauseTick++;
                                if (pauseTick === PAUSE_GRACE_TICKS + 1) {
                                    console.log('[Hesitation] Mid-speech pause >1s detected - resuming deductions');
                                }
                                if (pauseTick > PAUSE_GRACE_TICKS) {
                                    if (isFirstResponse) {
                                        console.log(`[Hesitation] MID-SPEECH PAUSE (firstResponse) - suppressing 1pt deduction`);
                                    } else {
                                        console.log(`[Hesitation] MID-SPEECH PAUSE - deducting 1pt`);
                                        if (typeof appStore.getState().deductFlowScore === 'function') {
                                            appStore.getState().deductFlowScore(1);
                                        }
                                        if (uiHooks?.onHesitation) uiHooks.onHesitation(++totalHesitationPoints);
                                    }
                                }
                            }
                        }, 100);
                    } else {
                        console.log('[Hesitation] Skipped (friend/shareCta lesson — hesitation is not displayed)');
                    }

                    // Stream is ready — transition to recording/answering so the
                    // full-screen camera preview is visible, then run a 3-2-1
                    // countdown before recording starts (skipped on
                    // friendClosedResponse, where the preview screen already gave
                    // the learner time to frame themselves).
                    appStore.getState().setMicActive(true);
                    appStore.getState().setHesitationMs(0);
                    if (uiHooks?.onRecordingStart) uiHooks.onRecordingStart(userData);
                    if (uiHooks?.onRecordingActive) uiHooks.onRecordingActive(button);

                    if (isPreviewGateStep(step)) {
                        console.log('[Look] microphone tapped — starting the take immediately');
                    } else {
                        for (const n of [3, 2, 1]) {
                            appStore.getState().setRecordingCountdown(n);
                            await new Promise((r) => setTimeout(r, 1000));
                        }
                    }
                    appStore.getState().setRecordingCountdown(null);

                    // Wait for the composite to paint at least one frame before
                    // recording, so a cold camera cannot freeze the take on frame 0.
                    await startDeferredSpeechCamRecording();

                    const stream = getSpeechCamStream();
                    if (stream) {
                        await startLocalAudioTap(stream, () => {
                            lastSpeechTime = Date.now();
                            if (!speechDetected) {
                                speechDetected = true;
                                speechStarted = true;
                                pauseTick = 0;
                                if (listeningState.hesitationTimer) {
                                    console.log('[Hesitation] Voice onset detected - clearing timer');
                                    clearInterval(listeningState.hesitationTimer);
                                    listeningState.hesitationTimer = null;
                                }
                                console.log('[Hesitation] Real-time speech detected! Timer stopped.');
                            } else if (speechStarted) {
                                pauseTick = 0;
                            }
                        });
                    }
                }
            } else {
                listeningState.active = false;
                appStore.getState().setMicActive(false);
                if (listeningState.hesitationTimer) {
                    console.log('[Hesitation] Recording stopped manually - clearing timer');
                    clearInterval(listeningState.hesitationTimer);
                    listeningState.hesitationTimer = null;
                }
                if (uiHooks?.onRecordingStop) uiHooks.onRecordingStop(button);

                let rawAudioData;
                try {
                    rawAudioData = await stopLocalAudioTap();
                } catch (e) {
                    console.error('[DBUG] stopLocalAudioTap threw:', e);
                    stopListeningEarly(userData, player, uiHooks);
                    return;
                }

                // A connected input can hand us a live stream that produces no
                // frames (the field case: a Bluetooth microphone). Classify the
                // capture before it reaches Whisper, so silence is answered with
                // guidance and a retry instead of a flat waveform and an endless
                // "transcribing" screen (stories/087-no-audio-capture).
                const capture = Core.analyzeCapturedAudio(rawAudioData);
                if (!capture.usable) {
                    console.warn(`[Speech] No usable audio captured (${capture.reason}), max amplitude ${capture.maxAmplitude.toFixed(4)} — not sending it to Whisper`);
                }

                if (capture.usable) {
                    const peaks = computeWaveformPeaks(rawAudioData, 120);
                    const durationMs = Math.round((rawAudioData.length / 16000) * 1000);
                    appStore.getState().setRecordedAudioPeaks({ peaks, durationMs });
                }

                let videoBlob;
                try {
                    videoBlob = await stopSpeechCamRecording({
                        download: false, persist: true, keepStreamAlive: true,
                        // A silent take is not replayed back to the learner.
                        playback: capture.usable, autoplay: capture.usable,
                        meta: {
                            lessonId: configData?.lessons?.[currentLessonIndex]?.lessonId || null,
                            stepIndex: currentStepIndex ?? null,
                            responseType: step?.responseType || null,
                            title: step?.step || null,
                        }
                    });
                } catch (e) {
                    console.error('[DBUG] stopSpeechCamRecording threw:', e);
                    stopListeningEarly(userData, player, uiHooks);
                    return;
                }

                await new Promise(r => setTimeout(r, 250));

                if (!capture.usable) {
                    appStore.getState().clearRecordedAudioPeaks();
                    appStore.getState().clearPlaybackBlob();
                    if (typeof safelyStopStream === 'function') {
                        try {
                            safelyStopStream();
                        } catch (e) {
                            console.warn('[Speech] Could not release silent capture stream:', e);
                        }
                    }
                    if (uiHooks?.onNoAudioCaptured) {
                        uiHooks.onNoAudioCaptured(userData);
                    } else {
                        stopListeningEarly(userData, player, uiHooks);
                    }
                    return;
                }

                if (!videoBlob) {
                    stopListeningEarly(userData, player, uiHooks);
                    appStore.getState().setMicActive(false);
                    return;
                }

                try {
                    const extractionResult = Core.trimSilenceWithPadding(rawAudioData, {
                        threshold: 0.03, preRoll: 0.3, postRoll: 0.3, sampleRate: 16000, initialIgnoreMs: 300
                    });
                    console.warn('[PT] trimmed len=', extractionResult?.trimmed?.length);
                    const whisperResult = await transcribeAudioBuffer(extractionResult.trimmed);
                    console.warn('[PT] whisper result=', typeof whisperResult === 'string' ? whisperResult : whisperResult?.text);
                    const finalTranscript = typeof whisperResult === 'string' ? whisperResult : whisperResult?.text;
                    const logprob = whisperResult?.avg_logprob !== undefined ? whisperResult.avg_logprob : 0;

                    const liveHesitation = appStore.getState().hesitationMs || extractionResult.hesitation;

                    console.warn('[PT] ABOUT TO CALL processTranscript', { transcript: finalTranscript?.substring(0, 30), logprob });
                    await processTranscript({
                        transcript: finalTranscript,
                        timingMeta: {
                            pauseCount: extractionResult.pauseCount,
                            hesitation: liveHesitation,
                            netDuration: extractionResult.netDuration
                        },
                        checkGibberish: true,
                        logprob,
                        params,
                        player
                    });
                } catch (error) {
                    console.error('[Speech] Whisper extraction failed:', error);
                    stopListeningEarly(userData, player, uiHooks);
                }
            }
        } finally {
            listeningState.transitioning = false;
        }
    }

    return { listeningState, initLocalVoiceAI, toggleSpeechRecognition };
}
