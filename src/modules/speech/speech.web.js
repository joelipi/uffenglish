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
} from './portrait-capture-logic.js';
import {
    shouldReleaseCaptureBeforePlayback,
    waitForAudioRouteSettle,
} from './capture-release-logic.js';
import { resampleTo16k, peakAmplitude, WHISPER_SAMPLE_RATE } from './audio-resample-logic.js';
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
export function shouldUsePortraitCapture() {
    return !isIOS();
}


let localRawAudioChunks = [];
let localAudioContext = null;
let localAudioWorkletNode = null;
let localAudioProbeTimer = null;
let localFallbackTimer = null;
let audioOnlyFallbackStream = null;
// Temporary capture instrumentation: logs what the source node emits and the
// rate the device actually provides. Flip to false once the field failure is
// identified.
const TAP_PROBE = true;

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

let recognition = null;
let recognitionTimeout = null;

function getMediaConstraints() {
    return {
        video: {
            // The composite (createPortraitCaptureStream) guarantees the 9:16
            // framing, so the camera is asked for a plain 16:9 source to crop.
            // Windows webcams report landscape regardless, so Windows still asks
            // for 9:16 directly (the composite crops either way).
            //
            // NOTE: on iOS the raw stream is used (no composite) while this still
            // asks for 16:9. Changing it to 9/16 on iOS was tried during the
            // silence investigation and made the framing worse — do not re-attempt
            // without measuring the captured track's real dimensions.
            aspectRatio: { ideal: 16 / 9 },
            facingMode: "user",
            ...(isWindows && { aspectRatio: { ideal: 9 / 16 } })
        },
        audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            // No sampleRate constraint: WebKit must hand back the microphone
            // at the hardware clock. Asking for 16 kHz made WebKit resample
            // the capture itself, which is the step observed to return a
            // silent signal from a live track (see audio-resample-logic.js);
            // the conversion to Whisper's 16 kHz now happens in JS.
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

    compositeLiveness = createLivenessCounter();
    compositeLastSourceTime = 0;

    function draw() {
        const rect = compositeCropRect({
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
        });
        const painted = paintCompositeFrame({ ctx, video, rect, canvasWidth: canvas.width, canvasHeight: canvas.height });
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
        const rect = compositeCropRect({
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
        });
        const painted2 = paintCompositeFrame({ ctx, video, rect, canvasWidth: canvas.width, canvasHeight: canvas.height });
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
            speechCamRecorder.start();
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
    // always closes it (the composite must not stay alive into Whisper);
    // everywhere else the caller decides via `keepStreamAlive`.
    const releaseAfterRecording = shouldForceReleaseComposite({ isAndroid, keepStreamAlive, recordingStarted: true });

    // ── iOS: close the capture before the clip plays (stories/087 follow-up) ──
    // iOS hands the audio session to playback when media starts while a
    // microphone capture is open. The capture is kept alive across takes
    // (`keepStreamAlive`), so playing the recorded clip left the mic track
    // alive but silent: the NEXT take then reported a live, unmuted track while
    // every sample was 0, and the poisoned session survived page reloads (field
    // case: iPadOS 27 + Chrome iOS — take 1 transcribed, take 2 and every take
    // after it were digital silence). Android already closes the capture here
    // for the mirror-image reason (its clip played silent); iOS needs the same
    // release so the next take re-acquires a healthy stream instead of reusing
    // a dead track.
    const releaseBeforePlayback = releaseAfterRecording || isIOS();
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
                            if (shouldReleaseCaptureBeforePlayback({ releaseAfterRecording: releaseBeforePlayback, playback: true })) {
                                releaseCapture();
                                if (isIOS()) {
                                    console.log('[Speech] iOS: released the capture before the clip plays — the next take re-acquires the mic');
                                }
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
    if (localAudioContext) {
        try {
            await localAudioContext.close();
        } catch (e) {
            console.warn('[Speech] Error closing previous AudioContext:', e.message);
        } finally {
            localAudioContext = null;
        }
    }

    // Create the AudioContext at the device's own rate.
    //
    // It used to be created with `{ sampleRate: 16000 }`. On iOS the hardware
    // clock is 48 kHz, so that request forced WebKit to resample the
    // microphone inside the audio graph — and the observed field failure is a
    // live, unmuted "iPad Microphone" track whose AudioWorklet delivers
    // nothing but zeros at exactly 16 kHz. Capturing at the native rate keeps
    // WebKit out of the conversion path; `stopLocalAudioTap` downsamples to
    // 16 kHz in JS for Whisper.
    localAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    console.log('[Speech] AudioContext created at native sampleRate:', localAudioContext.sampleRate);

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

    let source = localAudioContext.createMediaStreamSource(stream);
    localAudioWorkletNode = new AudioWorkletNode(localAudioContext, 'audio-processor');

    // Diagnostic: the capture track and the rate the graph actually runs at.
    // A live track that still delivers silence is the whole bug, so record the
    // device's own answer next to every take.
    try {
        const track = stream.getAudioTracks?.()[0];
        const settings = track?.getSettings?.() || {};
        console.log('[TAP] track:', track?.label, '| readyState:', track?.readyState, '| muted:', track?.muted,
            '| settings:', JSON.stringify({ sampleRate: settings.sampleRate, channelCount: settings.channelCount, latency: settings.latency }),
            '| contextRate:', localAudioContext.sampleRate);
    } catch (e) {
        console.warn('[TAP] could not read track settings:', e?.message);
    }
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

    // Keep the graph connected to the destination so the engine pulls it, but
    // at a gain low enough to be inaudible (~-60 dB). It used to be 0; a
    // completely silent branch is a shape engines are free to prune, and the
    // field symptom is a worklet that keeps ticking while receiving zeros.
    const silentGain = localAudioContext.createGain();
    silentGain.gain.value = 0.001;
    localAudioWorkletNode.connect(silentGain);
    silentGain.connect(localAudioContext.destination);

    // Diagnostic: measure what the SOURCE node itself emits, independently of
    // the worklet. If this probe sees signal while the worklet reports zeros,
    // the graph (not the microphone) is at fault, and vice versa.
    if (TAP_PROBE) {
        try {
            const probe = localAudioContext.createAnalyser();
            probe.fftSize = 2048;
            source.connect(probe);
            probe.connect(silentGain);
            const probeBuf = new Float32Array(probe.fftSize);
            let ticks = 0;
            localAudioProbeTimer = setInterval(() => {
                ticks++;
                try {
                    probe.getFloatTimeDomainData(probeBuf);
                    console.log(`[TAP-PROBE] tick ${ticks} peak ${peakAmplitude(probeBuf).toFixed(5)} ctx=${localAudioContext?.state} chunks=${localRawAudioChunks.length}`);
                } catch (e) {
                    console.warn('[TAP-PROBE] read failed:', e?.message);
                }
                if (ticks >= 8) {
                    clearInterval(localAudioProbeTimer);
                    localAudioProbeTimer = null;
                }
            }, 500);
        } catch (e) {
            console.warn('[TAP-PROBE] could not attach:', e?.message);
        }
    }

    // ── Silent camera-stream tap → retry on an audio-only capture ───────
    // Field finding: on iOS the AudioWorklet receives nothing but zeros from
    // the camera+microphone stream while the track reports live and unmuted —
    // yet a plain `getUserMedia({ audio })` capture in the same browser
    // records the learner's voice. If the first second of the tap is silent,
    // rebuild the source on a dedicated audio-only capture and keep it for the
    // rest of the take.
    localFallbackTimer = setTimeout(async () => {
        localFallbackTimer = null;
        const silent = localRawAudioChunks.every((chunk) => peakAmplitude(chunk) === 0);
        if (!silent) {
            console.log('[TAP] camera-stream tap is delivering audio; no fallback needed');
            return;
        }
        try {
            const audioOnly = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
            const track = audioOnly.getAudioTracks?.()[0];
            console.log('[TAP] camera-stream tap was silent → retrying on a dedicated audio-only capture:',
                track?.label, '| readyState:', track?.readyState, '| settings:', JSON.stringify(track?.getSettings?.() || {}));
            try { source.disconnect(); } catch (e) { /* already detached */ }
            const audioOnlySource = localAudioContext.createMediaStreamSource(audioOnly);
            audioOnlySource.connect(localAudioWorkletNode);
            audioOnlyFallbackStream = audioOnly;
            localRawAudioChunks = [];
            console.log('[TAP] audio-only tap attached; dropped the silent lead-in');
        } catch (e) {
            console.warn('[TAP] audio-only fallback failed:', e?.name, e?.message);
        }
    }, 900);
}

export async function stopLocalAudioTap() {
    if (localAudioProbeTimer) {
        clearInterval(localAudioProbeTimer);
        localAudioProbeTimer = null;
    }
    if (localFallbackTimer) {
        clearTimeout(localFallbackTimer);
        localFallbackTimer = null;
    }
    if (audioOnlyFallbackStream) {
        try {
            audioOnlyFallbackStream.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* ignore */ } });
            console.log('[TAP] released the audio-only fallback capture');
        } catch (e) {
            console.warn('[TAP] could not release the audio-only fallback capture:', e?.message);
        }
        audioOnlyFallbackStream = null;
    }
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

    // Whisper consumes 16 kHz mono. The graph runs at the device's rate, so the
    // conversion happens here (once, in JS) instead of inside WebKit's capture
    // path — the step that was observed to return silence on iOS.
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
   