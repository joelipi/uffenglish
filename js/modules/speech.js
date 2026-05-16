// modules/speech.js
import * as Core from './speech.core.js';
import * as WebAdapter from './speech.web.js';
import { transcribeAudioBuffer, preloadWhisperEngine } from '../workers/whisper/app-vad-asr-web.js';
import { updateSpeechRecording } from './storage.js';
import { validateAnswerPrecheck } from './answers.js';
import { State } from './state.js';
import { appStore } from './store.js';

export * from './speech.web.js';

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
    const { button, question, userData, configData, currentLessonIndex, currentQuestionIndex, handleAnswer, uiHooks } = params;

    if (!transcript) {
        stopListeningEarly(userData, player, uiHooks);
        return;
    }

    if (checkGibberish && Core.isGibberish(logprob)) {
        console.warn('[Speech] Gibberish detected');
        if (uiHooks?.onGibberishDetected) uiHooks.onGibberishDetected();
        stopListeningEarly(null, player, uiHooks);

        updateSpeechRecording(
            configData?.lessons?.[currentLessonIndex]?.lessonId,
            currentQuestionIndex,
            { userResponse: transcript, cue: question?.cue }
        ).catch(e => console.error(e));
        return;
    }

    const processedTranscript = Core.cleanTranscript(transcript);
    const transcriptToReview = processedTranscript || transcript;

    const rejectPreflight = (warningMessage) => {
        if (uiHooks?.onPreflightRejected) uiHooks.onPreflightRejected(warningMessage);

        updateSpeechRecording(
            configData?.lessons?.[currentLessonIndex]?.lessonId,
            currentQuestionIndex,
            { userResponse: transcriptToReview, cue: question?.cue }
        ).catch(e => console.error(e));

        setTimeout(() => toggleSpeechRecognition(params), 2500);
    };

    const englishLevel = configData?.languageLevel || 'A0';
    const { isValid, warningMessage } = await validateAnswerPrecheck(
        transcriptToReview, question.cue, question, englishLevel, userData, State.cuesGiven
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
            question.cue,
            question,
            button,
            question.explanation,
            question.translation,
            timingMeta,
            userData,
            configData
        );
    };

    const rejectTranscript = () => {
        if (!reviewActive) return;
        reviewActive = false;
        clearInterval(timerInterval);

        if (uiHooks?.onTranscriptRejected) uiHooks.onTranscriptRejected(question?.cue, transcriptToReview);

        updateSpeechRecording(
            configData?.lessons?.[currentLessonIndex]?.lessonId,
            currentQuestionIndex,
            { userResponse: transcriptToReview, cue: question?.cue }
        ).catch(e => console.error(e));

        setTimeout(() => toggleSpeechRecognition(params), 600);
    };

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
        const { button, question, micStatusText, userData, configData, currentLessonIndex, currentQuestionIndex, player, uiHooks } = params;

        if (uiHooks?.onPauseVideo) uiHooks.onPauseVideo(player);

        if (!listeningState.active) {
            // --- START ---
            listeningState.active = true;
            if (uiHooks?.onRecordingStart) uiHooks.onRecordingStart(userData);

            try {
                await WebAdapter.startSpeechCamRecording(micStatusText, userData);
            } catch (e) {
                listeningState.active = false;
                return;
            }

            if (uiHooks?.onMicDisable) uiHooks.onMicDisable(button);

            // REFACTORED: Check Zustand instead of window
            if (!appStore.getState().isWhisperReady) {
                listeningState.active = false;
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

                // Clean up old timer if any exists
                if (listeningState.hesitationTimer) {
                    clearInterval(listeningState.hesitationTimer);
                }

                // Start a 1-second hesitation timer
                listeningState.hesitationTimer = setInterval(() => {
                    if (!speechDetected && listeningState.active) {
                        console.log('[Speech] Hesitation detected! Deducting flow points.');
                        if (typeof appStore.getState().deductFlowScore === 'function') {
                            appStore.getState().deductFlowScore(10);
                        }
                        if (uiHooks?.onHesitation) uiHooks.onHesitation(10);
                    }
                }, 1000);

                if (WebAdapter.speechCamStream) {
                    await WebAdapter.startLocalAudioTap(WebAdapter.speechCamStream, () => {
                        if (!speechDetected) {
                            speechDetected = true;
                            if (listeningState.hesitationTimer) {
                                clearInterval(listeningState.hesitationTimer);
                                listeningState.hesitationTimer = null;
                            }
                            console.log('[Speech] Real-time speech detected! Hesitation timer cleared.');
                        }
                    });
                }
                if (uiHooks?.onRecordingActive) uiHooks.onRecordingActive(button);
            }
        } else {
            // --- STOP ---
            listeningState.active = false;
            if (listeningState.hesitationTimer) {
                clearInterval(listeningState.hesitationTimer);
                listeningState.hesitationTimer = null;
            }
            if (uiHooks?.onRecordingStop) uiHooks.onRecordingStop(button);

            const rawAudioData = WebAdapter.stopLocalAudioTap();
            const videoBlob = await WebAdapter.stopSpeechCamRecording({
                download: false, persist: true, keepStreamAlive: true, playback: true, autoplay: true,
                meta: {
                    lessonId: configData?.lessons?.[currentLessonIndex]?.lessonId || null,
                    questionIndex: currentQuestionIndex ?? null,
                    inputType: question?.inputType || null,
                    title: question?.question || null,
                }
            });

            await new Promise(r => setTimeout(r, 250));

            if (!videoBlob) {
                stopListeningEarly(userData, player, uiHooks);
                return;
            }

            try {
                // FIX: Bypass the buggy background VAD and strictly use the chronological math from Core
                const extractionResult = Core.trimSilenceWithPadding(rawAudioData, {
                    threshold: 0.015, preRoll: 0.3, postRoll: 0.3, sampleRate: 16000
                });
                const whisperResult = await transcribeAudioBuffer(extractionResult.trimmed);
                const finalTranscript = typeof whisperResult === 'string' ? whisperResult : whisperResult.text;
                const logprob = whisperResult.avg_logprob !== undefined ? whisperResult.avg_logprob : 0;

                await processTranscript({
                    transcript: finalTranscript,
                    timingMeta: {
                        pauseCount: extractionResult.pauseCount,
                        hesitation: extractionResult.hesitation,
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