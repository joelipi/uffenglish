// modules/speech.shared.js - Platform-agnostic speech orchestrator
import * as Core from './speech.core.js';
import * as WebAdapter from './speech.web.js';
import { transcribeAudioBuffer, preloadWhisperEngine } from '../workers/whisper/app-vad-asr-web.js';
import { updateSpeechRecording } from './storage.js';
import { validateAnswerPrecheck } from './answers.js';
import { appStore } from './store.js';

export const listeningState = { active: false, hesitationTimer: null, transitioning: false };

export function initLocalVoiceAI() {
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
        if (uiHooks?.onPreflightRejected) uiHooks.onPreflightRejected(warningMessage);

        updateSpeechRecording(
            configData?.lessons?.[currentLessonIndex]?.lessonId,
            currentStepIndex,
            { userResponse: transcriptToReview, cue: step?.cue }
        ).catch(e => console.error(e));

        setTimeout(() => toggleSpeechRecognition(params), 2500);
    };

    const englishLevel = configData?.languageLevel || 'A0';
    const { isValid, warningMessage } = await validateAnswerPrecheck(
        transcriptToReview, step.cue, step, englishLevel, userData, appStore.getState().cuesGiven
    );

    if (!isValid) { rejectPreflight(warningMessage); return; }

    let timeLeft = 7;
    let reviewActive = true;

    const acceptTranscript = () => {
        if (!reviewActive) return;
        reviewActive = false;
        clearInterval(timerInterval);

        if (uiHooks?.onReviewEnd) uiHooks.onReviewEnd();

        handleAnswer(
            transcriptToReview,
            step.cue,
            step,
            button,
            step.explanation,
            step.translation,
            timingMeta,
            userData,
            configData
        );
    };

    const rejectTranscript = () => {
        if (!reviewActive) return;
        reviewActive = false;
        clearInterval(timerInterval);

        if (uiHooks?.onTranscriptRejected) uiHooks.onTranscriptRejected(step?.cue, transcriptToReview);

        updateSpeechRecording(
            configData?.lessons?.[currentLessonIndex]?.lessonId,
            currentStepIndex,
            { userResponse: transcriptToReview, cue: step?.cue }
        ).catch(e => console.error(e));

        setTimeout(() => toggleSpeechRecognition(params), 600);
    };

    console.warn('[PT] CALLING onReviewStart', { transcriptToReview: transcriptToReview.substring(0, 30), timeLeft });
    if (uiHooks?.onReviewStart) uiHooks.onReviewStart(transcriptToReview, timeLeft, acceptTranscript, rejectTranscript);

    const timerInterval = setInterval(() => {
        if (!reviewActive) return clearInterval(timerInterval);
        timeLeft--;
        if (uiHooks?.onReviewUpdate) uiHooks.onReviewUpdate(timeLeft);
        if (timeLeft <= 0) acceptTranscript();
    }, 1000);
}

export async function toggleSpeechRecognition(params) {
    if (listeningState.transitioning) {
        console.warn('[Speech] toggleSpeechRecognition called while transitioning, ignoring.');
        return;
    }
    listeningState.transitioning = true;
    try {
        // Always kill any previous hesitation timer before doing anything
        if (listeningState.hesitationTimer) {
            console.log('[Hesitation] Top-level cleanup: killing existing timer');
            clearInterval(listeningState.hesitationTimer);
            listeningState.hesitationTimer = null;
        }

        const { button, step, micStatusText, userData, configData, currentLessonIndex, currentStepIndex, player, uiHooks } = params;

        if (uiHooks?.onPauseVideo) uiHooks.onPauseVideo(player);

        if (!listeningState.active) {
            // --- START ---
            listeningState.active = true;
            appStore.getState().setMicActive(true);
            appStore.getState().setHesitationMs(0);
            if (uiHooks?.onRecordingStart) uiHooks.onRecordingStart(userData);

            try {
                await WebAdapter.startSpeechCamRecording(micStatusText, userData);
            } catch (e) {
                listeningState.active = false;
                appStore.getState().setMicActive(false);
                return;
            }

            if (uiHooks?.onMicDisable) uiHooks.onMicDisable(button);

            // REFACTORED: Check Zustand instead of window
            if (!appStore.getState().isWhisperReady) {
                listeningState.active = false;
                appStore.getState().setMicActive(false);
                console.error('[Speech] Whisper engine not ready');

                // Abort the camera recording so the browser doesn't lock the stream
                try {
                    WebAdapter.stopSpeechCamRecording({ keepStreamAlive: true, download: false, persist: false, playback: false, autoplay: false });
                } catch (e) {
                    console.warn("Could not abort camera recording", e);
                }

                if (uiHooks?.onEngineNotReady) uiHooks.onEngineNotReady(userData);

                const readyInterval = setInterval(() => {
                    // REFACTORED: Poll Zustand instead of window
                    if (appStore.getState().isWhisperReady) {
                        clearInterval(readyInterval);
                        if (uiHooks?.onEngineReady) uiHooks.onEngineReady(button);
                    }
                }, 1000);
                return;
            } else {
                // --- Whisper path ---
                let speechDetected = false;
                let speechStarted = false;
                let pauseTick = 0;
                const PAUSE_GRACE_TICKS = 10; // 1s
                let lastSpeechTime = Date.now();

                // Clean up old timer if any exists
                if (listeningState.hesitationTimer) {
                    clearInterval(listeningState.hesitationTimer);
                }

                console.log('[Hesitation] Starting new 100ms hesitation timer (1s grace period)');
                // Smooth hesitation: 1 point per 100ms after 1s grace
                let hesitationTick = 0;
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
                        console.log(`[Hesitation] SILENCE DETECTED (after grace) → deducting 1pt, liveHesitationMs=${liveHesitationMs}`);
                        if (typeof appStore.getState().deductFlowScore === 'function') {
                            const before = appStore.getState().flowScore;
                            appStore.getState().deductFlowScore(1);
                            const after = appStore.getState().flowScore;
                            console.log(`[Hesitation] flowScore: ${before} → ${after}`);
                        }
                        if (uiHooks?.onHesitation) uiHooks.onHesitation(1);
                    }

                    // Mid-speech pause detection (after user has started speaking)
                    // Treat as silence if no speech chunk seen for >1s
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
                            if (uiHooks?.onHesitation) uiHooks.onHesitation(1);
                        }
                    }
                }, 100);

                if (WebAdapter.speechCamStream) {
                    await WebAdapter.startLocalAudioTap(WebAdapter.speechCamStream, () => {
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
                            // User resumed speaking after a pause
                            pauseTick = 0;
                        }
                    });
                }
                if (uiHooks?.onRecordingActive) uiHooks.onRecordingActive(button);
            }
        } else {
            // --- STOP ---
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
                rawAudioData = WebAdapter.stopLocalAudioTap();
            } catch (e) {
                console.error('[DBUG] stopLocalAudioTap threw:', e);
                stopListeningEarly(userData, player, uiHooks);
                return;
            }
            let videoBlob;
            try {
                videoBlob = await WebAdapter.stopSpeechCamRecording({
                    download: false, persist: true, keepStreamAlive: true, playback: true, autoplay: true,
                    meta: {
                        lessonId: configData?.lessons?.[currentLessonIndex]?.lessonId || null,
                        stepIndex: currentStepIndex ?? null,
                        stepType: step?.stepType || null,
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