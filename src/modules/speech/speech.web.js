// modules/speech.web.js
// Web-only module — uses navigator.userAgent, navigator.platform, navigator.mediaDevices.
// React Native replaces this with speech.native.js via platform-specific file resolution.
import Strings from '../../data/strings.js';
import { saveSpeechRecording } from '../storage/storage.js';
import { appStore, setWebcamStream } from '../store/store.js';

import { transcribeAudioBuffer, analyzeAudioBufferWithVAD, preloadWhisperEngine } from '../../workers/whisper/app-vad-asr-web.js';

// iOS detection disabled — iOS now uses same path as other devices
// export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isWindows = navigator.platform.indexOf('Win') > -1;


let localRawAudioChunks = [];
let localAudioContext = null;
let localAudioWorkletNode = null;

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
    const wantsPlaceholder = !!appStore.getState().isCameraOff;
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
        setWebcamStream(speechCamStream);
    } catch (err) {
        setWebcamStream(null);
        safelyStopStream();
    }
}

export async function startSpeechCamRecording(micStatusText, userData) {
    try {
        await ensureSpeechCamStream();
        setWebcamStream(speechCamStream);

        let mimeType = '';
        // iOS codec workaround disabled — iOS now uses same codec selection as other devices
        if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) mimeType = 'video/webm;codecs=vp9';
        else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) mimeType = 'video/webm;codecs=vp8';
        else mimeType = 'video/webm';

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
        appStore.getState().setSystemMessage({ type: 'alert', text: Strings.get('error_media_details', userData?.native_language) });
        setWebcamStream(null);
        safelyStopStream();
        throw err; // re-throw so the orchestrator can abort cleanly
    }
}

export function stopSpeechCamRecording({ download = true, persist = false, meta = {}, keepStreamAlive = false, playback = true, autoplay = false } = {}) {
    try {
        if (speechCamRecorder && speechCamRecorder.state !== 'inactive') {
            const recorder = speechCamRecorder;
            const chunks = speechCamChunks;
            const mime = recorder.mimeType || 'video/webm';

            speechCamRecorder = null;
            // Moved clearing of chunks to the finally block below to prevent race conditions

            return new Promise((resolve) => {
                recorder.onstop = async () => {
                    let blobToReturn = null;
                    try {
                        if (chunks.length === 0) { console.warn('[DBUG] chunks empty, resolving null'); resolve(null); return; }

                        const blob = new Blob(chunks, { type: mime });
                        blobToReturn = blob;
                        console.warn('[DBUG] blob created, size:', blob.size, 'playback:', playback);

                        if (playback && blob.size > 0) appStore.getState().setPlaybackBlob(blob, autoplay, chunks);

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
                        // Clear the array safely after processing
                        speechCamChunks = [];
                        
                        if (!keepStreamAlive) { setWebcamStream(null); safelyStopStream(); }
                        resolve(blobToReturn);
                    }
                };
                recorder.stop();
            });
        } else {
            speechCamRecorder = null;
            speechCamChunks = [];
            if (!keepStreamAlive) { setWebcamStream(null); safelyStopStream(); }
            else setWebcamStream(null);
            return Promise.resolve(null);
        }
    } catch (err) {
        speechCamRecorder = null;
        speechCamChunks = [];
        setWebcamStream(null); safelyStopStream();
        return Promise.resolve(null);
    }
}

export async function startLocalAudioTap(stream, onSpeechDetected = null) {
    localRawAudioChunks = [];

    if (!localAudioContext) {
        localAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    }

    if (localAudioContext.state === 'suspended') {
        await localAudioContext.resume();
    }

    // Load the worklet module if not already loaded
    try {
        const workletUrl = new URL('../../workers/whisper/audio-processor.js', import.meta.url);
        await localAudioContext.audioWorklet.addModule(workletUrl);
    } catch (e) {
        console.warn('[Speech] AudioWorklet module load note:', e.message);
    }

    const source = localAudioContext.createMediaStreamSource(stream);
    localAudioWorkletNode = new AudioWorkletNode(localAudioContext, 'audio-processor');

    let consecutiveSpeechChunks = 0;
    const tapStartTime = Date.now();
    const MIC_SETTLE_MS = 800; // ignore first 800ms to suppress mic pop/click

    localAudioWorkletNode.port.onmessage = (event) => {
        const chunk = new Float32Array(event.data); 
        localRawAudioChunks.push(chunk);
        
        // Skip amplitude check during mic startup settle period
        if (Date.now() - tapStartTime < MIC_SETTLE_MS) {
            return;
        }
        if (localRawAudioChunks.length === 9) {
            console.log('[Hesitation] Mic settle period ended, now monitoring for speech');
        }

        // Threshold check for real-time speech detection (ignoring transient clicks/pops)
        const maxVal = Math.max(...chunk);
        if (maxVal > 0.03) {
            consecutiveSpeechChunks++;
        } else {
            consecutiveSpeechChunks = 0;
        }

        if (consecutiveSpeechChunks >= 4 && onSpeechDetected) {
            onSpeechDetected(maxVal);
        }

        if (window.enabledLogs && window.enabledLogs.whisper && localRawAudioChunks.length % 40 === 0) {
            //console.log(`[Speech] Audio Worklet Flowing - Max Amplitude: ${maxVal.toFixed(4)}`);
        }
    };

    source.connect(localAudioWorkletNode);
    
    const silentGain = localAudioContext.createGain();
    silentGain.gain.value = 0;
    localAudioWorkletNode.connect(silentGain);
    silentGain.connect(localAudioContext.destination);
}

export function stopLocalAudioTap() {
    if (localAudioWorkletNode) {
        localAudioWorkletNode.disconnect();
        localAudioWorkletNode = null;
        // We keep the AudioContext alive but suspended to save resources 
        // and allow for faster re-initialization.
        if (localAudioContext) localAudioContext.suspend();
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

/* 
   --- WEB SPEECH API FUNCTIONS DISABLED ---
   Note: We are evaluating whether to remove Web Speech fallback completely.
   For now, these are commented out to ensure we only use Whisper.
*/

/*
export function isWebSpeechActive() {
    return !!recognition;
}

export function stopWebSpeech() {
    if (recognition) recognition.stop();
    clearTimeout(recognitionTimeout);
}

export function startWebSpeechRecognition({ lang = 'en-US', audioTrack = null, nativeLanguage = null } = {}) {
    // ... logic removed for brevity but functionally disabled
}
*/
