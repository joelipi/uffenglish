// modules/speech-orchestrator.js - Platform-agnostic speech orchestrator factory
import * as Core from './speech.core.js';
import { validateAnswerPrecheck } from '../answer/answers.js';
import { appStore } from '../store/store.js';
import Strings from '../../data/strings.js';
import normalize from '../bilingual/normalize.js';
import calculateSimilarity from '../answer/calculate-similarity.js';

export function createSpeechOrchestrator({
    startSpeechCamRecording,
    stopSpeechCamRecording,
    getSpeechCamStream,
    safelyStopStream,
    startLocalAudioTap,
    stopLocalAudioTap,
    transcribeAudioBuffer,
    preloadWhisperEngine,
    updateSpeechRecording,
}) {
    const listeningState = { active: false, hesitationTimer: null, transitioning: false };

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
            if (uiHooks?.onPreflightRejected) uiHooks.onPreflightRejected(warningMessage);

            updateSpeechRecording(
                configData?.lessons?.[currentLessonIndex]?.lessonId,
                currentStepIndex,
                { userResponse: transcriptToReview, cue: step?.cue }
            ).catch(e => console.error(e));

            setTimeout(() => toggleSpeechRecognition(params), 2500);
        };

        const courseLevel = configData?.courseLevel || 'A0';
        const { isValid, warningMessage } = await validateAnswerPrecheck(
            transcriptToReview, step.cue, step, courseLevel, userData, appStore.getState().responsesGiven
        );

        if (!isValid) { rejectPreflight(warningMessage); return; }

        // ── closedResponse homophone / near-match check ────────────────
        // Whisper often transcribes homophones (to/too, rules/roles) or
        // near-identical words.  When the user's spoken response is close
        // enough to the expected cue, show the cue itself for confirmation
        // so the user isn't confused by a slightly-off transcription.
        let displayTranscript = transcriptToReview;
        if (step.responseType === 'closedResponse' && step.cue) {
            try {
                const cueText = typeof step.cue === 'object' ? step.cue?.en : step.cue;
                const normalizedUser = await normalize(transcriptToReview.trim().toLowerCase());
                const normalizedCue = await normalize(cueText.trim().toLowerCase());
                const similarity = calculateSimilarity(normalizedUser, normalizedCue);
                if (similarity >= 95) {
                    displayTranscript = cueText;
                    console.log('[PT] closedResponse homophone match — showing cue instead of transcript', {
                        transcript: transcriptToReview, cue: cueText, similarity
                    });
                }
            } catch (e) {
                console.warn('[PT] closedResponse homophone check failed, using raw transcript:', e);
            }
        }

        let timeLeft = 7;
        let reviewActive = true;

        const acceptTranscript = () => {
            if (!reviewActive) return;
            reviewActive = false;
            clearInterval(timerInterval);

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

        const rejectTranscript = () => {
            if (!reviewActive) return;
            reviewActive = false;
            clearInterval(timerInterval);
            appStore.getState().clearPlaybackBlob();

            if (uiHooks?.onTranscriptRejected) uiHooks.onTranscriptRejected(step?.cue, transcriptToReview);

            updateSpeechRecording(
                configData?.lessons?.[currentLessonIndex]?.lessonId,
                currentStepIndex,
                { userResponse: transcriptToReview, cue: step?.cue }
            ).catch(e => console.error(e));

            setTimeout(() => toggleSpeechRecognition(params), 600);
        };

        console.warn('[PT] CALLING onReviewStart', { displayTranscript: displayTranscript.substring(0, 30), transcriptToReview: transcriptToReview.substring(0, 30), timeLeft });
        if (uiHooks?.onReviewStart) uiHooks.onReviewStart(displayTranscript, timeLeft, acceptTranscript, rejectTranscript);

        const timerInterval = setInterval(() => {
            if (!reviewActive) return clearInterval(timerInterval);
            timeLeft--;
            if (uiHooks?.onReviewUpdate) uiHooks.onReviewUpdate(timeLeft);
            if (timeLeft <= 0) acceptTranscript();
        }, 1000);
    }

    async function toggleSpeechRecognition(params) {
        if (listeningState.transitioning) {
            console.warn('[Speech] toggleSpeechRecognition called while transitioning, ignoring.');
            return;
        }
        listeningState.transitioning = true;
        try {
            if (listeningState.hesitationTimer) {
                console.log('[Hesitation] Top-level cleanup: killing existing timer');
                clearInterval(listeningState.hesitationTimer);
                listeningState.hesitationTimer = null;
            }

            const { button, step, micStatusText, userData, configData, currentLessonIndex, currentStepIndex, player, uiHooks } = params;

            if (uiHooks?.onPauseVideo) uiHooks.onPauseVideo(player);

            if (!listeningState.active) {
                listeningState.active = true;

                // Show warming-up state while camera stream initializes
                appStore.getState().setSystemMessage({ type: 'analyzing', bilingual: Strings.getBilingual('status_starting_camera', userData?.native_language) });

                try {
                    await startSpeechCamRecording(micStatusText, userData);
                } catch (e) {
                    listeningState.active = false;
                    appStore.getState().setSystemMessage(null);
                    return;
                }

                // Stream is ready — activate mic UI
                appStore.getState().setSystemMessage(null);
                appStore.getState().setMicActive(true);
                appStore.getState().setHesitationMs(0);
                if (uiHooks?.onRecordingStart) uiHooks.onRecordingStart(userData);

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

                    const readyInterval = setInterval(() => {
                        const state = appStore.getState();
                        if (state.isWhisperReady) {
                            clearInterval(readyInterval);
                            if (uiHooks?.onEngineReady) uiHooks.onEngineReady(button);
                        } else if (state.isWhisperEngineFailed) {
                            clearInterval(readyInterval);
                        }
                    }, 1000);
                    return;
                } else {
                    let speechDetected = false;
                    let speechStarted = false;
                    let pauseTick = 0;
                    const PAUSE_GRACE_TICKS = 10;
                    let lastSpeechTime = Date.now();

                    if (listeningState.hesitationTimer) {
                        clearInterval(listeningState.hesitationTimer);
                    }

                    console.log('[Hesitation] Starting new 100ms hesitation timer (1s grace period)');
                    let hesitationTick = 0;
                    let totalHesitationPoints = 0;
                    const GRACE_TICKS = 10;
                    let liveHesitationMs = 0;
                    listeningState.hesitationTimer = setInterval(() => {
                        hesitationTick++;
                        const currentActive = listeningState.active;
                        console.log(`[Hesitation] Tick #${hesitationTick} | active=${currentActive} | speechDetected=${speechDetected} | time=${Date.now()}`);
                        if (!speechDetected && currentActive && hesitationTick === GRACE_TICKS + 1) {
                            console.log('[Hesitation] Grace period ended - starting deductions');
                        }
                        if (!speechDetected && currentActive && hesitationTick > GRACE_TICKS) {
                            liveHesitationMs = (hesitationTick - GRACE_TICKS) * 100;
                            appStore.getState().setHesitationMs(liveHesitationMs);
                            console.log(`[Hesitation] SILENCE DETECTED (after grace) \u2192 deducting 1pt, liveHesitationMs=${liveHesitationMs}`);
                            if (typeof appStore.getState().deductFlowScore === 'function') {
                                const before = appStore.getState().flowScore;
                                appStore.getState().deductFlowScore(1);
                                const after = appStore.getState().flowScore;
                                console.log(`[Hesitation] flowScore: ${before} \u2192 ${after}`);
                            }
                            if (uiHooks?.onHesitation) uiHooks.onHesitation(++totalHesitationPoints);
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
                                console.log(`[Hesitation] MID-SPEECH PAUSE - deducting 1pt`);
                                if (typeof appStore.getState().deductFlowScore === 'function') {
                                    appStore.getState().deductFlowScore(1);
                                }
                                if (uiHooks?.onHesitation) uiHooks.onHesitation(++totalHesitationPoints);
                            }
                        }
                    }, 100);

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
                    if (uiHooks?.onRecordingActive) uiHooks.onRecordingActive(button);
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
                let videoBlob;
                try {
                    videoBlob = await stopSpeechCamRecording({
                        download: false, persist: true, keepStreamAlive: true, playback: true, autoplay: true,
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

                if (!videoBlob) {
                    stopListeningEarly(userData, player, uiHooks);
                    appStore.getState().setMicActive(false);
                    return;
                }

                try {
                    const extractionResult = Core.trimSilenceWithPadding(rawAudioData, {
                        threshold: 0.03, preRoll: 0.3, postRoll: 0.3, sampleRate: 16000, initialIgnoreMs: 800
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
