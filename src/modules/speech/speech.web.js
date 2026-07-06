// modules/speech.web.js
// Web-only module — uses navigator.userAgent, navigator.platform, navigator.mediaDevices.
// React Native replaces this with speech.native.js via platform-specific file resolution.
import Strings from '../../data/strings.js';
import { saveSpeechRecording } from '../storage/storage.js';
import { appStore, setWebcamStream } from '../store/store.js';
import { DEFAULT_USER_AVATAR_URL } from '../user/tutor-config.js';

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
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');

    // Load the user's profile picture (or default) for drawing on the canvas
    const profileUrl = appStore.getState().userData?.profilePictureUrl || DEFAULT_USER_AVATAR_URL;
    let profileImage = null;
    try {
        let src = profileUrl;
        // Resolve Appwrite URLs by fetching with credentials
        if (profileUrl.includes('appwrite.io')) {
            const resp = await fetch(profileUrl, { credentials: 'include' });
            if (resp.ok) {
                const blob = await resp.blob();
                src = URL.createObjectURL(blob);
            }
        }
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = reject;
            i.src = src;
        });
        profileImage = img;
    } catch (e) {
        console.warn('[Speech] Failed to load profile image for placeholder:', e);
    }

    function draw() {
        // Dark background
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (profileImage) {
            // Draw profile image cover-fill (center-crop to fill canvas)
            const imgAspect = profileImage.width / profileImage.height;
            const canvasAspect = canvas.width / canvas.height;
            let sx, sy, sw, sh;
            if (imgAspect > canvasAspect) {
                sh = profileImage.height;
                sw = profileImage.height * canvasAspect;
                sx = (profileImage.width - sw) / 2;
                sy = 0;
            } else {
                sw = profileImage.width;
                sh = profileImage.width / canvasAspect;
                sx = 0;
                sy = (profileImage.height - sh) / 2;
            }
            ctx.drawImage(profileImage, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        }
    }

    draw();
    if (typeof canvas.captureStream !== 'function') {
        throw new Error(
            '[Speech] canvas.captureStream is not supported in this browser. ' +
            'Ensure you are running a modern browser (Chrome 51+, Firefox 43+, Safari 11+, Edge 79+).'
        );
    }
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

export async function startSpeechCamRecording(micStatusText, userData, { deferStart = false } = {}) {
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

        if (!deferStart) {
            speechCamRecorder.start();
        }
    } catch (err) {
        console.error('[Recording] startSpeechCamRecording FAILED:', err);
        alert(Strings.get('alert_media_error', userData?.native_language));
        appStore.getState().setSystemMessage({ type: 'alert', text: Strings.get('error_media_details', userData?.native_language) });
        setWebcamStream(null);
        safelyStopStream();
        throw err; // re-throw so the orchestrator can abort cleanly
    }
}

export function startDeferredSpeechCamRecording() {
    if (speechCamRecorder && speechCamRecorder.state === 'inactive') {
        speechCamRecorder.start();
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

    // ── Fresh AudioContext every cycle ──────────────────────────────────
    //
    // Previously we held a single AudioContext across recordings,
    // suspending it between taps.  This caused a persistent bug on
    // iOS Safari: WebKit's AudioWorkletProcessor silently degrades
    // after repeated suspend/resume cycles, eventually returning
    // corrupted PCM (all-zeros, wrong sample-rate data, or garbage).
    // Whisper hallucinates text like "music" from that bad input and
    // keeps doing so until the page is reloaded (which destroys the
    // AudioContext).
    //
    // The fix is to close and discard the old AudioContext after every
    // recording and create a brand-new one here.  This ensures the
    // worklet thread starts with a clean clock, a fresh ring buffer,
    // and no accumulated state.  The small latency cost of creating a
    // new AudioContext is acceptable for the reliability gain.
    //
    if (localAudioContext) {
        try {
            await localAudioContext.close();
        } catch (e) {
            console.warn('[Speech] Error closing previous AudioContext:', e.message);
        } finally {
            localAudioContext = null;
        }
    }

    // Create a new AudioContext at 16 kHz.  Note: on iOS Safari the
    // hardware runs at 48 kHz and WebKit may silently resample; we
    // log the actual sample rate so we can spot a mismatch in diags.
    localAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    console.log('[Speech] AudioContext created, actual sampleRate:', localAudioContext.sampleRate);

    // ── AudioWorklet module ────────────────────────────────────────────
    // Even if the same URL was loaded on a previous AudioContext, we
    // must call addModule() again — the processor registration is
    // per-context.  The browser may serve the module script from its
    // internal cache so the second load is typically instant.
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
    const MIC_SETTLE_MS = 300; // ignore first 300ms to suppress mic pop/click

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

export async function stopLocalAudioTap() {
    // ── Tear down the worklet node ─────────────────────────────────────
    // Disconnect before closing the AudioContext so the worklet's
    // process() method is no longer called while we finalise audio.
    if (localAudioWorkletNode) {
        localAudioWorkletNode.disconnect();
        localAudioWorkletNode = null;
    }

    // ── Close (don't suspend) the AudioContext ─────────────────────────
    // Previously we suspended the AudioContext to save creation cost on
    // the next tap.  This caused iOS Safari's AudioWorkletProcessor to
    // silently degrade after a few cycles (see startLocalAudioTap for
    // the full explanation).  Closing it completely destroys the
    // worklet thread and frees all associated memory, guaranteeing a
    // clean slate when the next recording starts.
    //
    // AudioContext.close() is async per spec (returns a Promise).  We
    // await it so the caller knows the context is fully torn down
    // before proceeding.
    //
    // Capture the sampleRate *before* close() since we null the ref
    // in the finally block and still want it for the diagnostic log.
    const closedSampleRate = localAudioContext?.sampleRate;
    if (localAudioContext) {
        try {
            await localAudioContext.close();
        } catch (e) {
            console.warn('[Speech] Error closing AudioContext:', e.message);
        } finally {
            localAudioContext = null;
        }
    }

    // ── Flatten audio chunks into a single Float32Array for Whisper ────
    const totalLength = localRawAudioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const flattenedAudio = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of localRawAudioChunks) {
        flattenedAudio.set(chunk, offset);
        offset += chunk.length;
    }

    // Diagnostic: log amplitude stats for the captured audio.
    // If maxAmp stays near 0.0 it suggests the AudioWorklet produced
    // silence or garbage (the iOS degradation symptom).  This lets us
    // confirm the fix is working or detect new failures in the field
    // without relying on user reports.
    let maxAmp = 0;
    for (let i = 0; i < flattenedAudio.length; i++) {
        const abs = Math.abs(flattenedAudio[i]);
        if (abs > maxAmp) maxAmp = abs;
    }
    console.log(`[Speech] Captured ${flattenedAudio.length} samples, max amplitude: ${maxAmp.toFixed(4)}, sampleRate: ${closedSampleRate ?? 'N/A'}`);

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
