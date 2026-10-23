// modules/speech.web.js
// Web-only module — uses navigator.userAgent, navigator.platform, navigator.mediaDevices.
// React Native replaces this with speech.native.js via platform-specific file resolution.
import { saveSpeechRecording } from '../storage/storage.js';
import { appStore, setWebcamStream } from '../store/store.js';
import { DEFAULT_USER_AVATAR_URL } from '../user/tutor-config.js';
import { generateThumbFromBlob } from '../video/thumbnail.js';
import { isIOS } from '../../utils/detectIOS.js';
import {
    resolveCompositeDimensions,
    compositeCropRect,
    paintCompositeFrame,
    createLivenessCounter,
    shouldForceReleaseComposite,
    createFreezeReporter,
    resolveCompositeWatchdog,
    COMPOSITE_WATCHDOG_MS,
    // Recording privacy filters (stories/090 spike): `?filter=blur|mask`.
    resolveFilterModeFromSearch,
    shouldUsePortraitComposite,
    paintFilterEffect,
    createFaceBoxTracker,
} from './portrait-capture-logic.js';
import {
    shouldReleaseCaptureBeforePlayback,
    waitForAudioRouteSettle,
} from './capture-release-logic.js';
import {
    resampleTo16k,
    peakAmplitude,
    selectRecordingMimeType,
    WHISPER_SAMPLE_RATE,
} from './audio-resample-logic.js';
import Strings from '../../data/strings.js';
import { getAppLanguage } from '../bilingual/config-normalizer.js';
import { trackEvent } from '../utils/posthog.js';

export const isWindows = navigator.platform.indexOf('Win') > -1;
// Android is detected so the 9:16 canvas composite can be built LIGHTER on
// phones (see createPortraitCaptureStream). The composite is the only reliable
// way to guarantee a 9:16 recording: camera `aspectRatio` is advisory and is
// routinely ignored, and the recorded clip is reused verbatim (the recap and the
// published friend clips are cut from it), so the framing must be correct at
// capture time, not fixed later.
const isAndroid = /Android/i.test(navigator.userAgent);
const canvasCaptureSupported = typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function';

// iOS cameras already deliver a portrait frame and their MediaRecorder path is
// fragile (it finally works — do not disturb it), so iOS keeps the raw camera
// stream. Every other platform (Windows / macOS / Linux / ChromeOS / Android)
// has its camera composited into a real 9:16 canvas for both the preview and the
// recording; otherwise the captured clip (and everything derived from it) comes
// out at whatever aspect the camera hands back (often 16:9/4:3) rather than
// Reels-size.
//
// Exception, spike-only (stories/090): when `?filter=` is in the URL a filter has
// to be painted into the frame, and only the composite canvas is captured — so
// iOS is opted INTO the composite for that take.
export function shouldUsePortraitCapture(options) {
    return shouldUsePortraitComposite(options);
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
let compositeRafId = null;
let compositeWatchdogTimer = null;
let compositeLiveness = null;
let compositeFreezeReporter = null;
let compositeFreezeTickTimer = null;
let compositeLastSourceTime = 0;
let compositeCanvasEl = null;

// ---------------------------------------------------------------------------
// Recording privacy filters — spike only (stories/090).
//
// Activated by a URL flag on the real lesson player (`?filter=blur` or
// `?filter=mask`) so the owner can test on their own devices with the whole
// pipeline (Whisper + MediaRecorder + the end-of-lesson render) running. With no
// flag the app behaves exactly as before: no tracker, no WebGL context, no
// filter paint.
// ---------------------------------------------------------------------------
let recordingFilterMode = 'none';
// The Jeeliz instance, its own small WebGL canvas, and the last tracking result.
let faceFilterInstance = null;
let faceFilterCanvasEl = null;
let faceFilterBox = null;
// Holds + eases the detected box so a detector drop-out cannot make the mask
// blink off (the light NN's confidence oscillates around the threshold).
let faceBoxTracker = null;
let faceFilterInitPromise = null;
// Bumped by every teardown. An init that is still awaiting the library/model
// compares against it and aborts, so a slow load can never resurrect the
// tracker after the capture was released (that would put a WebGL context and a
// camera reference back into the Whisper window).
let faceFilterGeneration = 0;
// Tiny offscreen canvas used for the downscale/upscale blur.
let filterScratchCanvas = null;

function readFilterModeFromUrl() {
    if (typeof window === 'undefined' || !window.location) return 'none';
    return resolveFilterModeFromSearch(window.location.search);
}

/**
 * Start face tracking for the filter take. Runs AFTER the camera grant and
 * after the source <video> has decoded (Jeeliz reports low `detected` values if
 * it starts before that). The library is loaded lazily so a lesson without a
 * filter never downloads it.
 *
 * `videoSettings.videoElement` hands Jeeliz the ALREADY-OPEN camera element, so
 * it never calls getUserMedia a second time (a second capture locks the camera
 * on Android/iOS).
 */
async function initFaceFilter(sourceVideoEl) {
    if (recordingFilterMode === 'none' || faceFilterInstance) return;
    if (faceFilterInitPromise) return faceFilterInitPromise;
    const generation = faceFilterGeneration;
    const isStale = () => generation !== faceFilterGeneration;
    faceFilterInitPromise = (async () => {
        try {
            const [{ default: faceFilter }, nnResponse] = await Promise.all([
                import(/* @vite-ignore */ '/vendor/jeeliz/jeelizFaceFilter.moduleES6.js'),
                fetch('/vendor/jeeliz/NN_VERYLIGHT_1.json'),
            ]);
            if (!nnResponse.ok) throw new Error(`NN model HTTP ${nnResponse.status}`);
            const NNC = await nnResponse.json();
            // The take was released while the library/model were loading.
            if (isStale()) {
                console.log('[Filter] capture released before the tracker loaded; not starting it');
                return;
            }

            const trackerCanvas = document.createElement('canvas');
            trackerCanvas.width = 256;
            trackerCanvas.height = 256;
            trackerCanvas.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
            document.body.appendChild(trackerCanvas);
            faceFilterCanvasEl = trackerCanvas;

            faceFilter.init({
                canvas: trackerCanvas,
                NNC,
                maxFacesDetected: 1,
                videoSettings: { videoElement: sourceVideoEl },
                callbackReady: (errCode) => {
                    if (errCode) {
                        console.warn('[Filter] face tracking unavailable:', errCode, '— recording unfiltered');
                        faceFilterInstance = null;
                        return;
                    }
                    // Same guard for the async ready callback: a release that
                    // happened during init must not leave the tracker running.
                    if (isStale()) {
                        try { Promise.resolve(faceFilter.destroy()).catch(() => {}); } catch (e) { /* ignore */ }
                        return;
                    }
                    faceFilterInstance = faceFilter;
                    console.log('[Filter] face tracking ready, mode:', recordingFilterMode);
                },
                callbackTrack: (detectState) => {
                    if (!detectState || !faceBoxTracker) return;
                    faceBoxTracker.update(detectState, performance.now());
                    faceFilterBox = faceBoxTracker.current(performance.now());
                },
            });
        } catch (e) {
            console.warn('[Filter] face tracking failed to start; recording unfiltered:', e?.message || e);
        }
    })();
    return faceFilterInitPromise;
}

function teardownFaceFilter() {
    faceFilterGeneration += 1;
    faceFilterBox = null;
    if (faceBoxTracker) { faceBoxTracker.reset(); faceBoxTracker = null; }
    faceFilterInitPromise = null;
    const instance = faceFilterInstance;
    faceFilterInstance = null;
    if (instance) {
        try { Promise.resolve(instance.destroy()).catch(() => {}); } catch (e) { /* ignore */ }
    }
    if (faceFilterCanvasEl) {
        if (faceFilterCanvasEl.parentNode) faceFilterCanvasEl.parentNode.removeChild(faceFilterCanvasEl);
        faceFilterCanvasEl = null;
    }
    filterScratchCanvas = null;
}

let recognition = null;
let recognitionTimeout = null;

function getMediaConstraints() {
    return {
        video: {
            // The composite (createPortraitCaptureStream) guarantees the 9:16
            // framing, so the camera is asked for a plain 16:9 source to crop.
            // Windows webcams report landscape regardless, so Windows still asks
            // for 9:16 directly (the composite crops either way).
            aspectRatio: { ideal: 16 / 9 },
            facingMode: "user",
            ...(isWindows && { aspectRatio: { ideal: 9 / 16 } })
        },
        audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
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
    appStore.getState().setRecordingCountdown(null);
}

/**
 * Release the camera/microphone capture completely.
 *
 * `setWebcamStream(null)` only clears the STORE's reference — the module-level
 * `speechCamStream` keeps its live tracks, so the capture stays open. On
 * Android an open capture holds the device in a communication audio mode,
 * which mutes media playback while it is open; that is the Android-only
 * "lesson video starts silent" symptom (stories/075).
 *
 * The release happens at a STEP BOUNDARY (before the next step's video plays),
 * never mid-flow, so story 072's mid-flow teardown-and-rebuild avoidance (and
 * its OOM rationale) is preserved.
 */
export function releaseSpeechCamStream() {
    setWebcamStream(null);
    safelyStopStream();
}

/**
 * Wraps a raw (usually 16:9) camera stream in a real 9:16 canvas so the preview
 * and the recorded clip are always Reels-size. Each frame is centre-cropped into
 * the canvas (the same cover-fill the placeholder uses), and the camera's own
 * audio track is carried through. Returns a new stream whose video track comes
 * from the canvas.
 *
 * Phones get a lighter composite (720×1280 @ 24 fps): a 1080×1920 canvas plus a
 * software MediaRecorder encode of it OOMs low-memory Android devices while the
 * Whisper model is resident, and the 720p canvas keeps the same 9:16 framing at
 * ~3× less encoder load. Desktops keep the full 1080×1920 @ 30 fps.
 */
function createPortraitCaptureStream(rawStream) {
    const dims = resolveCompositeDimensions({ isAndroid });
    const canvas = document.createElement('canvas');
    canvas.width = dims.width;
    canvas.height = dims.height;
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:4px;opacity:0.01;pointer-events:none;';
    document.body.appendChild(canvas);
    compositeCanvasEl = canvas;
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

    // Spike-only: start face tracking once the first frame is decodable, reusing
    // this element so no second camera capture is opened.
    if (recordingFilterMode !== 'none') {
        faceBoxTracker = createFaceBoxTracker();
        video.addEventListener('loadeddata', () => { initFaceFilter(video); }, { once: true });
    }

    compositeLiveness = createLivenessCounter();
    compositeLastSourceTime = 0;

    // One frame: crop the camera into the canvas, then paint the active filter
    // over it. Everything the captureStream sees goes through here, so the
    // recorded blob (and the preview) always agree.
    function paintFrame() {
        const rect = compositeCropRect({
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
        });
        const painted = paintCompositeFrame({ ctx, video, rect, canvasWidth: canvas.width, canvasHeight: canvas.height });
        if (painted && recordingFilterMode !== 'none') {
            if (!filterScratchCanvas) {
                filterScratchCanvas = document.createElement('canvas');
            }
            // Resolve the held box per frame so an expired hold actually hides.
            faceFilterBox = faceBoxTracker ? faceBoxTracker.current(performance.now()) : null;
            paintFilterEffect({
                ctx,
                source: canvas,
                filterMode: recordingFilterMode,
                faceBox: faceFilterBox,
                videoWidth: video.videoWidth,
                videoHeight: video.videoHeight,
                crop: rect,
                canvasWidth: canvas.width,
                canvasHeight: canvas.height,
                scratch: filterScratchCanvas,
            });
        }
        return painted;
    }

    function draw() {
        const painted = paintFrame();
        if (painted && compositeLiveness) compositeLiveness.recordPaint();
        if (video.currentTime > compositeLastSourceTime) {
            compositeLiveness.recordSourceAdvance();
            compositeLastSourceTime = video.currentTime;
        }
    }

    // The caller (`ensureSpeechCamStream`) only builds this when
    // `canvas.captureStream` is supported, so no in-function capability check.
    draw();
    compositeRawStream = rawStream;
    compositeVideoEl = video;
    // rAF loop (Phase 2 promoted): same scheduler as executeRenderLoop.
    // The no-throw invariant: tick() must never throw, or the loop dies.
    let lastSourceAdvanceAt = performance.now();
    function tick() {
        const prevSourceTime = compositeLastSourceTime;
        const painted2 = paintFrame();
        if (painted2 && compositeLiveness) compositeLiveness.recordPaint();
        if (video.currentTime > prevSourceTime) {
            if (compositeLiveness) compositeLiveness.recordSourceAdvance();
            compositeLastSourceTime = video.currentTime;
            lastSourceAdvanceAt = performance.now();
        }
        compositeRafId = requestAnimationFrame(tick);
    }
    compositeRafId = requestAnimationFrame(tick);

    // 1 Hz watchdog: resume a stalled source.
    compositeWatchdogTimer = setInterval(() => {
        if (!compositeVideoEl) return;
        const action = resolveCompositeWatchdog({
            hasEverHadMetadata: compositeLastSourceTime > 0,
            readyState: compositeVideoEl.readyState,
            paused: compositeVideoEl.paused,
            ended: compositeVideoEl.ended,
            lastSourceAdvanceAtMs: lastSourceAdvanceAt,
            nowMs: performance.now(),
        });
        if (action === 'resume') {
            console.warn('[Speech] composite source stalled; resuming');
            compositeVideoEl.play().catch((e) => {
                console.warn('[Speech] composite resume failed', e);
                compositeVideoEl.muted = true;
                compositeVideoEl.play().catch((fatal) => {
                    console.warn('[Speech] composite resume fatal', fatal);
                });
            });
        }
    }, COMPOSITE_WATCHDOG_MS);

    return new MediaStream([
        ...canvas.captureStream(dims.fps).getVideoTracks(),
        ...rawStream.getAudioTracks(),
    ]);
}

function teardownPortraitCapture() {
    // Free the filter's WebGL context + scratch canvas at the same moment as the
    // composite (i.e. before Whisper runs) so the OOM window stays closed.
    teardownFaceFilter();
    if (compositeRafId) {
        cancelAnimationFrame(compositeRafId);
        compositeRafId = null;
    }
    if (compositeWatchdogTimer) {
        clearInterval(compositeWatchdogTimer);
        compositeWatchdogTimer = null;
    }
    if (compositeLiveness) {
        compositeLiveness.reset();
        compositeLiveness = null;
    }
    if (compositeFreezeTickTimer) {
        clearInterval(compositeFreezeTickTimer);
        compositeFreezeTickTimer = null;
    }
    if (compositeFreezeReporter) {
        compositeFreezeReporter.reset();
        compositeFreezeReporter = null;
    }
    if (compositeVideoEl) {
        try { compositeVideoEl.pause(); } catch (e) { /* ignore */ }
        compositeVideoEl.srcObject = null;
        if (compositeVideoEl.parentNode) compositeVideoEl.parentNode.removeChild(compositeVideoEl);
        compositeVideoEl = null;
    }
    if (compositeCanvasEl) {
        if (compositeCanvasEl.parentNode) compositeCanvasEl.parentNode.removeChild(compositeCanvasEl);
        compositeCanvasEl = null;
    }
    if (compositeRawStream) {
        compositeRawStream.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* ignore */ } });
        compositeRawStream = null;
    }
}

async function createPlaceholderStream() {
    const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
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
    // Resolve the spike flag once per acquisition (the URL does not change while
    // a take runs). `none` keeps today's behaviour byte-for-byte.
    recordingFilterMode = readFilterModeFromUrl();
    if (recordingFilterMode !== 'none') {
        console.log('[Filter] recording filter active:', recordingFilterMode);
    }
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
        // stream unchanged (its MediaRecorder path is fragile) — unless a
        // recording filter is active, which can only be painted into the canvas.
        const useComposite = shouldUsePortraitCapture({ isIOS: isIOS(), filterMode: recordingFilterMode });
        speechCamStream = useComposite && canvasCaptureSupported
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
        // Create and resume the AudioContext inside the user tap gesture BEFORE
        // opening the camera/mic capture, matching the exact sequence that
        // passed on-device in /audio-lab5 (freshContext -> getUserMedia ->
        // MediaRecorder.start -> buildTap).
        if (localAudioContext) {
            try {
                await localAudioContext.close();
            } catch (e) {
                console.warn('[Speech] Error closing previous AudioContext:', e.message);
            } finally {
                localAudioContext = null;
            }
        }
        if (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
            try {
                localAudioContext = new (window.AudioContext || window.webkitAudioContext)();
                if (localAudioContext.state === 'suspended' && typeof localAudioContext.resume === 'function') {
                    await localAudioContext.resume();
                }
            } catch (e) {
                console.warn('[Speech] Could not pre-create AudioContext in tap gesture:', e.message);
                localAudioContext = null;
            }
        }

        await ensureSpeechCamStream();
        setWebcamStream(speechCamStream);

        const mimeType = selectRecordingMimeType({
            isWindows,
            isIOS: isIOS(),
            isTypeSupported: (t) => typeof MediaRecorder !== 'undefined'
                && typeof MediaRecorder.isTypeSupported === 'function'
                && MediaRecorder.isTypeSupported(t),
        });

        const options = mimeType ? { mimeType } : {};
        if (!mimeType) console.warn('[Recording] No preferred MIME type supported; using browser default');
        else console.log('[Recording] MediaRecorder mimeType selected:', mimeType);

        speechCamChunks = [];
        speechCamRecorder = new MediaRecorder(speechCamStream, options);

        speechCamRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) speechCamChunks.push(e.data);
        };

        if (!deferStart) {
            speechCamRecorder.start(250);
        }
    } catch (err) {
        console.error('[Recording] startSpeechCamRecording FAILED:', err);
        if (localAudioContext) {
            try { await localAudioContext.close(); } catch (e) { /* ignore */ }
            localAudioContext = null;
        }
        // Recovery guidance is owned by the orchestrator/uiHooks so it can be
        // localized and kept on-screen. A blocking native alert here would
        // dead-end the user with no way back to the mode chooser.
        setWebcamStream(null);
        safelyStopStream();
        appStore.getState().setRecordingCountdown(null);
        throw err; // re-throw so the orchestrator can surface guidance cleanly
    }
}

export async function startDeferredSpeechCamRecording() {
    if (speechCamRecorder && speechCamRecorder.state === 'inactive') {
        // Gate recording on the composite producing at least one frame, so a
        // cold camera / slow first paint cannot freeze the take on frame 0.
        // Timeout after 2s so a permanently dead composite doesn't hang.
        if (compositeLiveness) {
            const deadline = performance.now() + 2000;
            while (compositeLiveness.snapshot().framesDrawn === 0 && performance.now() < deadline) {
                await new Promise((r) => setTimeout(r, 50));
            }
        }
        if (speechCamRecorder && speechCamRecorder.state === 'inactive') {
            speechCamRecorder.start(250);
            console.log('[Recording] MediaRecorder started, state:', speechCamRecorder.state, 'mimeType:', speechCamRecorder.mimeType);
        }
        // Frozen-take detection: report once if the composite stops producing
        // frames. Sinks are logging + telemetry only (no user-facing copy in
        // Phase 1). Meta is derived from appStore at tick time.
        if (compositeLiveness) {
            compositeFreezeReporter = createFreezeReporter({
                snapshotCounter: () => compositeLiveness.snapshot(),
                nowMs: () => performance.now(),
                getMeta: () => {
                    const state = appStore.getState();
                    const lesson = state.configData?.lessons?.[state.currentLessonIndex];
                    const step = lesson?.steps?.[state.currentStepIndex];
                    return {
                        lessonId: lesson?.lessonId || null,
                        stepIndex: state.currentStepIndex ?? null,
                        responseType: step?.responseType || null,
                    };
                },
                getMessage: () => Strings.get('error_speech_generic', getAppLanguage()),
                onConsoleError: (msg, detail) => console.error(msg, detail),
                onTrackEvent: (name, props) => trackEvent(name, props),
                onUserMessage: () => { /* Phase 2: user-facing banner */ },
            });
            compositeFreezeReporter.start();
            // Tick at 1 Hz.
            compositeFreezeTickTimer = setInterval(() => {
                if (compositeFreezeReporter) compositeFreezeReporter.tick();
            }, 1000);
        }
    }
}

// On phones, always release the camera composite when recording ends — it must
// not stay alive into transcription/Whisper (canvas + software encoder +
// recorded blob + Whisper WASM is what OOM'd Android). `keepStreamAlive` is only
// a warmup optimisation; the next step rebuilds the stream via warmUp.
export function stopSpeechCamRecording({ download = true, persist = false, meta = {}, keepStreamAlive = false, playback = true, autoplay = false } = {}) {
    // The capture may be closed twice — once before the clip is handed to the
    // player and once in the finally block — so the release is idempotent.
    let captureReleased = false;
    const releaseCapture = () => {
        if (captureReleased) return;
        captureReleased = true;
        setWebcamStream(null);
        safelyStopStream();
    };
    // Whether the capture is closed when the recording ends anyway. Android
    // and iOS always close it (Android so the composite does not stay alive
    // into Whisper; iOS so playback never mutes a still-open mic track and the
    // next take acquires a fresh stream); everywhere else the caller decides
    // via `keepStreamAlive`.
    const releaseAfterRecording = shouldForceReleaseComposite({ isAndroid, isIOS: isIOS(), keepStreamAlive, recordingStarted: true });
    try {
        if (speechCamRecorder && speechCamRecorder.state !== 'inactive') {
            const recorder = speechCamRecorder;
            const chunks = speechCamChunks;
            const mime = recorder.mimeType || (isIOS() ? 'video/mp4' : 'video/webm');

            speechCamRecorder = null;
            // Moved clearing of chunks to the finally block below to prevent race conditions

            return new Promise((resolve) => {
                let settled = false;
                const stopTimer = setTimeout(() => {
                    if (settled) return;
                    console.warn('[Recording] MediaRecorder.onstop timed out after 1500ms; forcing cleanup (chunks:', chunks.length, ')');
                    if (typeof recorder.onstop === 'function') {
                        recorder.onstop();
                    }
                }, 1500);

                recorder.onstop = async () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(stopTimer);
                    let blobToReturn = null;
                    try {
                        if (chunks.length === 0) { console.warn('[DBUG] chunks empty, resolving null'); resolve(null); return; }

                        const blob = new Blob(chunks, { type: mime });
                        blobToReturn = blob;
                        console.warn('[DBUG] blob created, size:', blob.size, 'playback:', playback);

                        if (playback && blob.size > 0) {
                            // The capture must be closed BEFORE the clip reaches the
                            // player. On Android an open capture holds the device in a
                            // communication audio mode, and the media route then ducks
                            // (or mutes) the clip's own audio — the learner hears a
                            // quiet or missing first second of their own recording
                            // (stories/075-fix-android-silent-video-start).
                            //
                            // The capture used to be released in the finally block, i.e.
                            // AFTER the hand-over and after the thumbnail generation
                            // and the database write — so the capture was still open
                            // for the whole first second of the clip.
                            if (shouldReleaseCaptureBeforePlayback({ releaseAfterRecording, playback: true })) {
                                releaseCapture();
                                // The audio route needs a moment to hand back from the
                                // communication mode to the media mode. The wait only
                                // happens when a capture was actually released, so the
                                // desktop warm-up path is not delayed at all.
                                await waitForAudioRouteSettle();
                            }
                            appStore.getState().setPlaybackBlob(blob, autoplay);
                        }

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

                        // Clear frozen-take reporter + tick timer.
                        if (compositeFreezeTickTimer) {
                            clearInterval(compositeFreezeTickTimer);
                            compositeFreezeTickTimer = null;
                        }
                        if (compositeFreezeReporter) {
                            compositeFreezeReporter.reset();
                            compositeFreezeReporter = null;
                        }
                        if (releaseAfterRecording) { releaseCapture(); }
                        resolve(blobToReturn);
                    }
                };
                recorder.stop();
            });
        } else {
            speechCamRecorder = null;
            speechCamChunks = [];
            if (localAudioContext && !localAudioWorkletNode) {
                try { localAudioContext.close().catch(() => {}); } catch (e) { /* ignore */ }
                localAudioContext = null;
            }
            // Clear frozen-take reporter + tick timer.
            if (compositeFreezeTickTimer) {
                clearInterval(compositeFreezeTickTimer);
                compositeFreezeTickTimer = null;
            }
            if (compositeFreezeReporter) {
                compositeFreezeReporter.reset();
                compositeFreezeReporter = null;
            }
            if (shouldForceReleaseComposite({ isAndroid, keepStreamAlive, recordingStarted: false })) { releaseCapture(); }
            else setWebcamStream(null);
            return Promise.resolve(null);
        }
    } catch (err) {
        speechCamRecorder = null;
        speechCamChunks = [];
        if (localAudioContext && !localAudioWorkletNode) {
            try { localAudioContext.close().catch(() => {}); } catch (e) { /* ignore */ }
            localAudioContext = null;
        }
        if (compositeFreezeTickTimer) {
            clearInterval(compositeFreezeTickTimer);
            compositeFreezeTickTimer = null;
        }
        compositeFreezeReporter = null;
        releaseCapture();
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
    // Reuse the AudioContext pre-created and resumed during the user tap
    // gesture in `startSpeechCamRecording` when available; otherwise create a
    // fresh native-rate context here.
    if (!localAudioContext || localAudioContext.state === 'closed') {
        localAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (localAudioContext.state === 'suspended' && typeof localAudioContext.resume === 'function') {
        try {
            await localAudioContext.resume();
        } catch (e) {
            console.warn('[Speech] AudioContext resume note:', e.message);
        }
    }
    console.log('[Speech] AudioContext ready, actual sampleRate:', localAudioContext.sampleRate, 'state:', localAudioContext.state);

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
    silentGain.gain.value = 0.001;
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
    const maxAmp = peakAmplitude(flattenedAudio);
    console.log(`[Speech] Captured ${flattenedAudio.length} samples, max amplitude: ${maxAmp.toFixed(4)}, sampleRate: ${closedSampleRate ?? 'N/A'}`);

    const audioForWhisper = resampleTo16k(flattenedAudio, closedSampleRate);
    if (audioForWhisper.length !== flattenedAudio.length) {
        console.log(`[Speech] Resampled ${flattenedAudio.length} frames @ ${closedSampleRate} Hz → ${audioForWhisper.length} frames @ ${WHISPER_SAMPLE_RATE} Hz, max amplitude: ${peakAmplitude(audioForWhisper).toFixed(4)}`);
    }

    localRawAudioChunks = [];
    return audioForWhisper;
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
