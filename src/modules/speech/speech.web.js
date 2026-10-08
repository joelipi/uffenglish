// modules/speech.web.js
// Web-only module — uses navigator.userAgent, navigator.platform, navigator.mediaDevices.
// React Native replaces this with speech.native.js via platform-specific file resolution.
import { saveSpeechRecording } from '../storage/storage.js';
import { appStore, setWebcamStream } from '../store/store.js';
import { DEFAULT_USER_AVATAR_URL } from '../user/tutor-config.js';
import { generateThumbFromBlob } from '../video/thumbnail.js';
import { isIOS } from '../../utils/detectIOS.js';

export const isWindows = navigator.platform.indexOf('Win') > -1;
const canvasCaptureSupported = typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function';

// iOS cameras already deliver a portrait frame and their MediaRecorder path is
// fragile (it finally works — do not disturb it), so iOS keeps the raw camera
// stream. Every other platform (Windows / macOS / Linux / ChromeOS / Android)
// has its camera composited into a real 9:16 canvas for both the preview and the
// recording; otherwise the captured clip (and the recap canvas that mirrors it)
// comes out at whatever aspect the camera hands back (often 16:9/4:3) rather
// than Reels-size.
export function shouldUsePortraitCapture() {
    return !isIOS();
}


let localRawAudioChunks = [];
let localAudioContext = null;
let localAudioWorkletNode = null;

export let speechCamStream = null;
let speechCamRecorder = null;
let speechCamChunks = [];
let isPlaceholderStream = false;

// Desktop portrait-capture state (see createPortraitCaptureStream). The raw
// 16:9 camera stream is kept alive behind a hidden <video> that feeds the 9:16
// canvas, so it must be torn down alongside speechCamStream.
let compositeRawStream = null;
let compositeVideoEl = null;
let compositeDrawTimer = null;

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
    teardownPortraitCapture();
    isPlaceholderStream = false;
}

/**
 * Wraps a raw (usually 16:9) camera stream in a real 1080×1920 canvas so the
 * preview and the recorded clip are always Reels-size. Each frame is
 * centre-cropped into the canvas (the same cover-fill the placeholder uses),
 * and the camera's own audio track is carried through. Returns a new stream
 * whose video track comes from the canvas.
 */
function createPortraitCaptureStream(rawStream) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');

    // Hidden element playing the raw camera stream; we sample it into the canvas.
    // Appended to the DOM (like the video processor) because Safari only renders
    // an in-DOM <video> into a canvas reliably.
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
    document.body.appendChild(video);
    video.srcObject = rawStream;
    video.play().catch((e) => console.warn('[Speech] portrait-capture playback failed:', e));

    function draw() {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return; // metadata not ready yet
        const canvasAspect = canvas.width / canvas.height;
        const videoAspect = vw / vh;
        let sx, sy, sw, sh;
        if (videoAspect > canvasAspect) {
            // Wider than 9:16 → keep full height, crop the sides.
            sh = vh;
            sw = vh * canvasAspect;
            sx = (vw - sw) / 2;
            sy = 0;
        } else {
            // Taller than 9:16 → keep full width, crop top/bottom.
            sw = vw;
            sh = vw / canvasAspect;
            sx = 0;
            sy = (vh - sh) / 2;
        }
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    }

    // The caller (`ensureSpeechCamStream`) only builds this when
    // `canvas.captureStream` is supported, so no in-function capability check.
    draw();
    compositeRawStream = rawStream;
    compositeVideoEl = video;
    compositeDrawTimer = setInterval(draw, 1000 / 30);

    return new MediaStream([
        ...canvas.captureStream(30).getVideoTracks(),
        ...rawStream.getAudioTracks(),
    ]);
}

function teardownPortraitCapture() {
    if (compositeDrawTimer) {
        clearInterval(compositeDrawTimer);
        compositeDrawTimer = null;
    }
    if (compositeVideoEl) {
        try { compositeVideoEl.pause(); } catch (e) { /* ignore */ }
        compositeVideoEl.srcObject = null;
        if (compositeVideoEl.parentNode) compositeVideoEl.parentNode.removeChild(compositeVideoEl);
        compositeVideoEl = null;
    }
    if (compositeRawStream) {
        compositeRawStream.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* ignore */ } });
        compositeRawStream = null;
    }
}

async function createPlaceholderStream() {
    const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: { ideal: 16000 } }
    });

    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');

    const profileUrl = appStore.getState().userData?.profilePictureUrl || DEFAULT_USER_AVATAR_URL;
    let profileImage = null;
    try {
        let src = profileUrl;
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
        const rawStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
        // Every platform except iOS wraps the camera in a 9:16 canvas so the
        // preview and recording are always Reels-size. iOS keeps the raw camera
        // stream unchanged (its MediaRecorder path is fragile).
        speechCamStream = shouldUsePortraitCapture() && canvasCaptureSupported
            ? createPortraitCaptureStream(rawStream)
            : rawStream;
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
        // Prefer mp4 (H.264/AAC) on Windows only. iOS Safari's MediaRecorder
        // produces mp4s with a known track-alignment bug (audio echo/desync
        // at the start), and iOS was already working fine via the original
        // webm fallthrough (browser default) — DO NOT change iOS behavior.
        // Android and Firefox still record webm reliably and fall through to
        // the webm chain below.
        const mp4Preferred = isWindows;
        if (mp4Preferred) {
            if (MediaRecorder.isTypeSupported('video/mp4;codecs=h264,aac')) mimeType = 'video/mp4;codecs=h264,aac';
            else if (MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';
        }
        if (!mimeType) {
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

        if (!deferStart) {
            speechCamRecorder.start();
        }
    } catch (err) {
        console.error('[Recording] startSpeechCamRecording FAILED:', err);
        // Recovery guidance is owned by the orchestrator/uiHooks so it can be
        // localized and kept on-screen. A blocking native alert here would
        // dead-end the user with no way back to the mode chooser.
        setWebcamStream(null);
        safelyStopStream();
        throw err; // re-throw so the orchestrator can surface guidance cleanly
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

                        if (playback && blob.size > 0) appStore.getState().setPlaybackBlob(blob, autoplay);

                        if (download && blob.size > 0) {
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = `speech_recording_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
                            document.body.appendChild(a); a.click(); a.remove();
                            setTimeout(() => URL.revokeObjectURL(url), 10000);
                        } else if (persist && blob.size > 0) {
                            let thumb = null;
                            try {
                                thumb = await generateThumbFromBlob(blob, { atSeconds: 0.2, width: 320, quality: 0.7 });
                            } catch (e) {
                                console.warn('[Thumbnail] raw webcam thumb failed:', e?.message || e);
                            }
                            await saveSpeechRecording(blob, meta, thumb);
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
