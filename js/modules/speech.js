// modules/speech.js
import * as Core from './speech.core.js';
import * as WebAdapter from './speech.web.js';
import { transcribeAudioBuffer, preloadWhisperEngine, isEngineReady } from '../workers/whisper/app-vad-asr-web.js';
import * as ui from '../components/ui.js';
import { updateSpeechRecording } from './storage.js';
import { validateAnswerPrecheck } from './answers.js';
import { State } from './state.js';
import Strings from '../data/strings.js';

export * from './speech.web.js';

const listeningState = { active: false };

export function initLocalVoiceAI() {
    return preloadWhisperEngine();
}

function stopListeningEarly(userData, player) {
    console.warn('[Speech] stopListeningEarly called');
    WebAdapter.stopWebSpeech();
    if (player) player.play();
    ui.prepareMediaUI();
    ui.setMicStatusText(`<div class='text-center' style='color: red; font-size: large;'><i class='bi bi-exclamation-triangle-fill'></i> ${Strings.get('try_again_speech', userData?.native_language)}</div>`);
}

/**
 * Shared post-recognition pipeline for both Whisper and Web Speech paths.
 * Takes a raw transcript and timing metadata, runs preflight validation,
 * shows the review UI with accept/reject, and calls handleAnswer on acceptance.
 *
 * @param {object} opts
 * @param {string}  opts.transcript      - Raw transcript string
 * @param {object}  opts.timingMeta      - { pauseCount, hesitation, netDuration }
 * @param {boolean} [opts.checkGibberish] - Whether to run logprob gibberish check
 * @param {number}  [opts.logprob]        - Whisper avg_logprob (Whisper path only)
 * @param {object}  opts.params           - Full toggleSpeechRecognition params
 * @param {object}  opts.player           - Video player ref for early-stop
 */
async function processTranscript({ transcript, timingMeta, checkGibberish = false, logprob = 0, params, player }) {
    const { button, question, userData, configData, currentLessonIndex, currentQuestionIndex, handleAnswer } = params;

    if (!transcript) {
        stopListeningEarly(userData, player);
        return;
    }

    // Gibberish check — Whisper path only (logprob not available from Web Speech)
    if (checkGibberish && Core.isGibberish(logprob)) {
        console.warn('[Speech] Gibberish detected');
        ui.setMicStatusText(`<div class='text-center mt-3' style='color: #ff9800; font-size: large;'><i class='bi bi-ear-x'></i> Audio unclear. Please try speaking clearly.</div>`);
        stopListeningEarly(null, player);
        updateSpeechRecording(
            configData?.lessons?.[currentLessonIndex]?.lessonId,
            currentQuestionIndex,
            { userResponse: transcript, cue: question?.cue }
        ).catch(e => console.error(e));
        return;
    }

    const processedTranscript = Core.cleanTranscript(transcript);
    const transcriptToReview = processedTranscript || transcript;

    const rejectPreflight = (message) => {
        ui.clearPlaybackVideo(); ui.removeWebcamPreview();
        window.dispatchEvent(new CustomEvent('preflightRejected'));
        ui.setMicStatusText(`<div class='text-center text-danger'>${message}</div>`);
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

    // --- Review UI ---
    let timeLeft = 7;
    let reviewActive = true;

    const acceptTranscript = () => {
        if (!reviewActive) return;
        reviewActive = false;
        clearInterval(timerInterval);
        ui.setMicStatusText("");
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
        ui.clearPlaybackVideo(); ui.removeWebcamPreview();
        window.dispatchEvent(new CustomEvent('transcriptRejected', { detail: { cue: question?.cue, transcript: transcriptToReview } }));
        ui.setMicStatusText(`<div class='text-center text-warning mt-3'><div class="spinner-border spinner-border-sm" role="status"></div> Restarting Mic...</div>`);
        updateSpeechRecording(
            configData?.lessons?.[currentLessonIndex]?.lessonId,
            currentQuestionIndex,
            { userResponse: transcriptToReview, cue: question?.cue }
        ).catch(e => console.error(e));
        setTimeout(() => toggleSpeechRecognition(params), 600);
    };

    ui.renderWhisperReviewUI(transcriptToReview, timeLeft, acceptTranscript, rejectTranscript);

    const timerInterval = setInterval(() => {
        if (!reviewActive) return clearInterval(timerInterval);
        timeLeft--;
        ui.updateWhisperTimer(timeLeft);
        if (timeLeft <= 0) acceptTranscript();
    }, 1000);
}

export async function toggleSpeechRecognition(params) {
    const { button, question, micStatusText, userData, configData, currentLessonIndex, currentQuestionIndex, player } = params;

    ui.pauseVideoIfPlaying(player);

    if (!listeningState.active) {
        // --- START ---
        listeningState.active = true;

        ui.setMicStatusText(`<div class="text-center"><div class="mb-0" style="color: green; font-size: 30px;"><i class="bi bi-mic" style="color: green; font-size: 100px !important;"></i><br>${Strings.get('status_speak', userData?.native_language)}</div></div>`);

        try {
            await WebAdapter.startSpeechCamRecording(micStatusText, userData);
        } catch (e) {
            // startSpeechCamRecording re-throws after setting its own error UI
            listeningState.active = false;
            return;
        }

        button.style.display = "none";

        if (!isEngineReady) {
            // --- Web Speech path (Whisper engine not loaded) ---
            // On Android: we record video first, then transcribe from playback
            // to avoid mic contention. stopSpeechCamRecording is called with
            // autoplay:true, which starts the video. We then capture the audio
            // track from the playing video element and pass it to
            // startWebSpeechRecognition. The mic is free at that point since
            // MediaRecorder has stopped.
            //
            // On desktop: recognition runs immediately against the live mic,
            // same as before, with the audioTrack param used if Chrome 135+.
            console.warn('[Whisper] Engine not ready, using Web Speech fallback.');

            if (WebAdapter.isAndroid) {
                // Android: stop recording first, start playback, then transcribe
                // from the playing video element's audio track.
                button.style.display = "none";
                ui.setMicStatusText(`<div class='text-center text-warning mt-3'><div class="spinner-border spinner-border-sm" role="status"></div> ${Strings.get('status_processing', userData?.native_language)}</div>`);

                const videoBlob = await WebAdapter.stopSpeechCamRecording({
                    download: false, persist: true, keepStreamAlive: false,
                    playback: true, autoplay: true,
                    meta: {
                        lessonId: configData?.lessons?.[currentLessonIndex]?.lessonId || null,
                        questionIndex: currentQuestionIndex ?? null,
                        inputType: question?.inputType || null,
                        title: question?.question || null,
                    }
                });

                if (!videoBlob) {
                    stopListeningEarly(userData, player);
                    listeningState.active = false;
                    return;
                }

                // Get the audio track from the now-playing video element.
                // ui.getPlaybackVideoElement() should return the <video> DOM node
                // that setupPlaybackVideo placed in the page.
                const videoEl = ui.getPlaybackVideoElement();
                let audioTrack = null;

                if (videoEl && typeof videoEl.captureStream === 'function') {
                    try {
                        const captured = videoEl.captureStream();
                        audioTrack = captured.getAudioTracks()[0] || null;
                        if (audioTrack) console.log('[Speech] Android: transcribing from playback audio track');
                        else console.warn('[Speech] Android: captureStream returned no audio tracks, falling back to mic');
                    } catch (e) {
                        console.warn('[Speech] Android: captureStream failed, falling back to mic:', e);
                    }
                } else {
                    console.warn('[Speech] Android: no video element or captureStream unavailable, falling back to mic');
                }

                ui.setMicStatusText(`<i class='bi bi-mic-fill'></i> ${Strings.get('status_speak', userData?.native_language)}`);

                try {
                    const { transcript, netDuration } = await WebAdapter.startWebSpeechRecognition({
                        lang: 'en-US',
                        audioTrack,
                        nativeLanguage: userData?.native_language
                    });

                    listeningState.active = false;
                    await processTranscript({
                        transcript,
                        timingMeta: { pauseCount: null, hesitation: null, netDuration },
                        params,
                        player
                    });
                } catch (err) {
                    console.error('[Speech] Android Web Speech failed:', err);
                    listeningState.active = false;
                    stopListeningEarly(userData, player);
                }

            } else {
                // Desktop: run recognition immediately against the live mic.
                // Video recording stays active in parallel (no contention on desktop).
                // stopSpeechCamRecording is called after we get a transcript so
                // the recording covers the full speech window.
                try {
                    const { transcript, netDuration } = await WebAdapter.startWebSpeechRecognition({
                        lang: 'en-US',
                        nativeLanguage: userData?.native_language
                        // No audioTrack here — live mic, same as original behaviour.
                        // The audioTrack param would require a stream we don't have
                        // until after recording stops. Desktop has no mic contention
                        // so this is fine.
                    });

                    listeningState.active = false;

                    // Stop recording now that we have the transcript
                    await WebAdapter.stopSpeechCamRecording({
                        download: false, persist: true, keepStreamAlive: false,
                        playback: true, autoplay: true,
                        meta: {
                            lessonId: configData?.lessons?.[currentLessonIndex]?.lessonId || null,
                            questionIndex: currentQuestionIndex ?? null,
                            inputType: question?.inputType || null,
                            title: question?.question || null,
                        }
                    });

                    await processTranscript({
                        transcript,
                        timingMeta: { pauseCount: null, hesitation: null, netDuration },
                        params,
                        player
                    });
                } catch (err) {
                    console.error('[Speech] Desktop Web Speech failed:', err);
                    listeningState.active = false;
                    stopListeningEarly(userData, player);
                }
            }

        } else {
            // --- Whisper path ---
            if (WebAdapter.speechCamStream) WebAdapter.startLocalAudioTap(WebAdapter.speechCamStream);
            button.style.display = "block";
            button.innerHTML = '<i class="bi bi-mic-mute-fill"></i>';
            button.classList.add('btn-danger');
        }

    } else {
        // --- STOP (Whisper path only — Web Speech paths are self-terminating) ---
        listeningState.active = false;
        button.style.display = "none";
        ui.clearMicStatusAndHideMedia();
        ui.setMicStatusText(`<div class='text-center text-warning mt-3'><div class="spinner-border spinner-border-sm" role="status"></div> Analyzing Speech...</div>`);

        // Drain audio tap synchronously before any await
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

        // See note in previous version: 250ms hedge against MediaRecorder flush
        // edge cases. Remove once confirmed stable with the onstop fix.
        await new Promise(r => setTimeout(r, 250));

        if (!videoBlob) {
            stopListeningEarly(userData, player);
            return;
        }

        try {
            const extractionResult = Core.trimSilenceWithPadding(rawAudioData, {
                threshold: 0.02, preRoll: 0.3, postRoll: 0.3, sampleRate: 16000
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
            stopListeningEarly(userData, player);
        }
    }
}
