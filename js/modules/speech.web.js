// modules/speech.web.js
import Strings from '../data/strings.js';
import { saveSpeechRecording } from './storage.js';
import { State } from './state.js';
import * as ui from '../components/ui.js';

export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isWindows = navigator.platform.indexOf('Win') > -1;
export const isAndroid = /Android/.test(navigator.userAgent);

let localRawAudioChunks = [];
let localAudioContext = null;
let localAudioProcessor = null;

export let speechCamStream = null;
let speechCamRecorder = null;
let speechCamChunks = [];
let isPlaceholderStream = false;

let recognition = null;
let recognitionTimeout = null;

function getMediaConstraints() {
    return {
        video: {
            aspectRatio: { ideal: 16 / 9 },
            facingMode: "user",
            ...(isWindows && { aspectRatio: { ideal: 9 / 16 } })
        },
        audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: { ideal: 16000 }
        }
    };
}

export function safelyStopStream() {
    if (speechCamStream) {
        speechCamStream.getTracks().forEach(t => t.stop());
        speechCamStream = null;
    }
    isPlaceholderStream = false;
}

async function createPlaceholderStream() {
    const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: { ideal: 16000 } }
    });

    const canvas = document.createElement('canvas');
    if (isWindows) { canvas.width = 480; canvas.height = 854; }
    else { canvas.width = 854; canvas.height = 480; }

    const ctx = canvas.getContext('2d');

    function draw() {
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const centerX = canvas.width / 2, centerY = canvas.height / 2, baseSize = Math.min(canvas.width, canvas.height);
        ctx.fillStyle = '#444444';
        const headRadius = baseSize * 0.15;
        ctx.beginPath(); ctx.arc(centerX, centerY - headRadius * 0.4, headRadius, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(centerX, centerY + headRadius * 1.5, baseSize * 0.25, baseSize * 0.3, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#666666'; ctx.font = `bold ${Math.round(baseSize * 0.05)}px Arial`; ctx.textAlign = 'center';
        ctx.fillText('WEBCAM OFF', centerX, canvas.height - (baseSize * 0.1));
    }

    draw();
    const mixedStream = new MediaStream([...canvas.captureStream(5).getVideoTracks(), ...audioStream.getAudioTracks()]);
    const interval = setInterval(() => { if (speechCamStream && isPlaceholderStream) draw(); else clearInterval(interval); }, 1000);
    return mixedStream;
}

async function ensureSpeechCamStream() {
    const wantsPlaceholder = !!State.isCameraOff;
    if (speechCamStream) {
        if (isPlaceholderStream === wantsPlaceholder) return speechCamStream;
        safelyStopStream();
    }
    if (wantsPlaceholder) {
        speechCamStream = await createPlaceholderStream();
        isPlaceholderStream = true;
    } else {
        speechCamStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
        isPlaceholderStream = false;
    }
    return speechCamStream;
}

export async function warmUpSpeechCamStream() {
    try {
        await ensureSpeechCamStream();
        ui.ensureWebcamPreview(speechCamStream);
    } catch (err) {
        ui.removeWebcamPreview();
        safelyStopStream();
    }
}

export async function startSpeechCamRecording(micStatusText, userData) {
    try {
        await ensureSpeechCamStream();
        ui.ensureWebcamPreview(speechCamStream);

        let mimeType = '';
        if (isIOS) {
            if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E')) mimeType = 'video/mp4;codecs=avc1.42E01E';
            else if (MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';
        } else {
            if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) mimeType = 'video/webm;codecs=vp9';
            else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) mimeType = 'video/webm;codecs=vp8';
            else mimeType = 'video/webm';
        }

        const options = mimeType ? { mimeType } : {};
        if (!mimeType) console.warn('[Recording] No preferred MIME type supported; using browser default');

        speechCamChunks = [];
        speechCamRecorder = new MediaRecorder(speechCamStream, options);

        speechCamRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) speechCamChunks.push(e.data);
        };

        speechCamRecorder.start();
    } catch (err) {
        console.error('[Recording] startSpeechCamRecording FAILED:', err);
        alert(Strings.get('alert_media_error', userData?.native_language));
        ui.setMicStatusText(`<i class='bi bi-exclamation-diamond'></i> ${Strings.get('error_media_details', userData?.native_language)}`);
        ui.removeWebcamPreview();
        safelyStopStream();
        throw err; // re-throw so the orchestrator can abort cleanly
    }
}

export function stopSpeechCamRecording({ download = true, persist = false, meta = {}, keepStreamAlive = false, playback = true, autoplay = false } = {}) {
    try {
        if (speechCamRecorder && speechCamRecorder.state !== 'inactive') {
            const recorder = speechCamRecorder;
            const chunks = speechCamChunks;
            const mime = recorder.mimeType || (isIOS ? 'video/mp4' : 'video/webm');

            speechCamRecorder = null;
            speechCamChunks = [];

            return new Promise((resolve) => {
                recorder.onstop = async () => {
                    let blobToReturn = null;
                    try {
                        if (chunks.length === 0) { resolve(null); return; }

                        const blob = new Blob(chunks, { type: mime });
                        blobToReturn = blob;

                        if (playback && blob.size > 0) await ui.setupPlaybackVideo(blob, autoplay, chunks);

                        if (download && blob.size > 0) {
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = `speech_recording_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
                            document.body.appendChild(a); a.click(); a.remove();
                            setTimeout(() => URL.revokeObjectURL(url), 10000);
                        } else if (persist && blob.size > 0) {
                            await saveSpeechRecording(blob, meta);
                        }
                    } catch (error) {
                        console.error('[Recording] Error in onstop handler:', error);
                    } finally {
                        if (!keepStreamAlive) { ui.removeWebcamPreview(); safelyStopStream(); }
                        else ui.hideWebcamPreview();
                        resolve(blobToReturn);
                    }
                };
                recorder.stop();
            });
        } else {
            speechCamRecorder = null;
            speechCamChunks = [];
            if (!keepStreamAlive) { ui.removeWebcamPreview(); safelyStopStream(); }
            else ui.hideWebcamPreview();
            return Promise.resolve(null);
        }
    } catch (err) {
        speechCamRecorder = null;
        speechCamChunks = [];
        ui.removeWebcamPreview(); safelyStopStream();
        return Promise.resolve(null);
    }
}

export function startLocalAudioTap(stream) {
    localRawAudioChunks = [];

    // NOTE: createScriptProcessor is deprecated. Replacement is AudioWorklet.
    // Also not available in React Native — needs a native module equivalent.
    localAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const source = localAudioContext.createMediaStreamSource(stream);
    localAudioProcessor = localAudioContext.createScriptProcessor(4096, 1, 1);

    localAudioProcessor.onaudioprocess = (event) => {
        localRawAudioChunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };

    source.connect(localAudioProcessor);
    localAudioProcessor.connect(localAudioContext.destination);
}

export function stopLocalAudioTap() {
    if (localAudioProcessor) {
        localAudioProcessor.disconnect();
        localAudioContext.close();
        localAudioProcessor = null;
        localAudioContext = null;
    }

    const totalLength = localRawAudioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const flattenedAudio = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of localRawAudioChunks) {
        flattenedAudio.set(chunk, offset);
        offset += chunk.length;
    }

    localRawAudioChunks = [];
    return flattenedAudio;
}

export function isWebSpeechActive() {
    return !!recognition;
}

export function stopWebSpeech() {
    if (recognition) recognition.stop();
    clearTimeout(recognitionTimeout);
}

/**
 * Starts Web Speech recognition and returns a Promise that resolves with
 * { transcript: string, netDuration: number } when a result is received,
 * or rejects with an Error if recognition fails fatally.
 *
 * This function owns only the Web Speech API lifecycle: setup, Android quirks,
 * audioTrack routing, and timeout/restart logic. All post-recognition logic
 * (preflight checks, review UI, handleAnswer) lives in speech.js, mirroring
 * the Whisper path exactly.
 *
 * @param {object} options
 * @param {string}           [options.lang]          BCP-47 tag, default 'en-US'
 * @param {MediaStreamTrack} [options.audioTrack]    Track to transcribe instead
 *   of the live mic. Pass a track from videoElement.captureStream() to avoid
 *   mic contention on Android. On desktop Chrome 135+, passed directly to
 *   recognition.start(). On Android, routed through an AudioContext fork since
 *   start({ audioTrack }) is not yet supported there (Chrome 147, caniuse Apr 2026).
 * @param {string}           [options.nativeLanguage] For localised UI strings
 * @returns {Promise<{ transcript: string, netDuration: number }>}
 */
export function startWebSpeechRecognition({ lang = 'en-US', audioTrack = null, nativeLanguage = null } = {}) {
    return new Promise((resolve, reject) => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            reject(new Error('Web Speech API not available'));
            return;
        }

        // --- audioTrack routing ---
        // Desktop Chrome 135+: start({ audioTrack }) is supported natively.
        // Android Chrome: not supported yet. Workaround — fork the track through
        // an AudioContext/MediaStreamDestination so the recognition engine sees
        // it as a stream it can consume. Since we're transcribing from video
        // playback (not the live mic), MediaRecorder has already stopped and
        // there is no mic contention regardless.
        // No audioTrack: recognition uses the default mic (original behaviour).
        let audioCtxForFork = null;
        let forkedTrack = null;
        let useNativeAudioTrackParam = false;

        if (audioTrack) {
            const chromeMatch = navigator.userAgent.match(/Chrome\/(\d+)/);
            const chromeVersion = chromeMatch ? parseInt(chromeMatch[1], 10) : 0;
            // caniuse (Apr 2026): audioTrack param supported desktop Chrome 135+,
            // NOT supported on Chrome for Android 147 (latest listed).
            useNativeAudioTrackParam = !isAndroid && chromeVersion >= 135;

            if (useNativeAudioTrackParam) {
                forkedTrack = audioTrack;
            } else {
                try {
                    const sourceStream = new MediaStream([audioTrack]);
                    audioCtxForFork = new (window.AudioContext || window.webkitAudioContext)();
                    const source = audioCtxForFork.createMediaStreamSource(sourceStream);
                    const destination = audioCtxForFork.createMediaStreamDestination();
                    source.connect(destination);
                    forkedTrack = destination.stream.getAudioTracks()[0];
                    console.log('[WebSpeech] AudioContext fork created for playback transcription');
                } catch (e) {
                    console.warn('[WebSpeech] AudioContext fork failed, falling back to default mic:', e);
                    forkedTrack = null;
                    audioCtxForFork = null;
                }
            }
        }

        let settled = false;

        const cleanup = () => {
            settled = true;
            clearTimeout(recognitionTimeout);
            recognition = null;
            if (audioCtxForFork) {
                audioCtxForFork.close().catch(() => {});
                audioCtxForFork = null;
            }
        };

        const startRecognition = () => {
            if (useNativeAudioTrackParam && forkedTrack) {
                recognition.start({ audioTrack: forkedTrack });
            } else {
                recognition.start();
            }
        };

        recognition = new SpeechRecognition();
        recognition.lang = lang;
        recognition.interimResults = false;

        if (isAndroid) {
            // Android drops the connection on any pause — continuous causes more
            // problems than it solves there.
            recognition.continuous = false;
            recognition.maxAlternatives = 1;
        } else {
            recognition.continuous = true;
        }

        recognition.onstart = () => {
            clearTimeout(recognitionTimeout);
            ui.setMicStatusText(`<i class='bi bi-mic-fill'></i> ${Strings.get('status_speak', nativeLanguage)}`);
        };

        recognition.onerror = (event) => {
            // 'no-speech' and 'aborted' are recoverable — the timeout loop will
            // restart. Everything else is fatal for this attempt.
            if (event.error === 'no-speech' || event.error === 'aborted') return;
            if (settled) return;

            let errorMessage = Strings.get('error_speech_generic', nativeLanguage);
            if (event.error === 'not-allowed') errorMessage = Strings.get('error_mic_permissions', nativeLanguage);
            else if (event.error === 'network') errorMessage = Strings.get('error_internet', nativeLanguage);
            ui.setMicStatusText(`<div class='text-center'>${errorMessage}</div>`);
            cleanup();
            reject(new Error(`SpeechRecognition error: ${event.error}`));
        };

        recognition.onresult = (event) => {
            if (settled) return;
            let finalTranscript = '';

            if (isAndroid) {
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    if (event.results[i].isFinal) { finalTranscript = event.results[i][0].transcript; break; }
                }
            } else {
                if (event.results?.[0]?.[0]) finalTranscript = event.results[0][0].transcript;
            }

            if (finalTranscript) {
                recognition.stop();
                // Web Speech gives no timing data — estimate from word count
                // at an average speaking pace of ~2.5 words/sec
                const netDuration = Math.max(1, finalTranscript.split(' ').length / 2.5);
                cleanup();
                resolve({ transcript: finalTranscript, netDuration });
            }
            // empty interim result — let timeout handle restart
        };

        recognition.onend = () => {
            // Fires after stop() or a network drop. If already settled, do nothing.
            // Otherwise the timeout loop will handle restarting.
        };

        // Timeout / restart loop
        const scheduleTimeout = () => {
            recognitionTimeout = setTimeout(() => {
                if (settled || !recognition) return;
                console.warn('[WebSpeech] Timeout — restarting');
                recognition.stop();
                setTimeout(() => {
                    if (settled || !recognition) return;
                    try {
                        startRecognition();
                        ui.setMicStatusText(`<i class='bi bi-mic-fill'></i> ${Strings.get('status_speak', nativeLanguage)}`);
                        scheduleTimeout();
                    } catch (e) {
                        cleanup();
                        reject(new Error('SpeechRecognition failed to restart'));
                    }
                }, isAndroid ? 1000 : 500);
            }, isAndroid ? 8000 : 5000);
        };

        startRecognition();
        scheduleTimeout();
    });
}
