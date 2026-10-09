// modules/video-processor.web.js
// Web-only module — uses navigator.userAgent, window.preloadedMedia, MediaRecorder.
// React Native replaces this with video-processor.native.js.
import { getAllSpeechRecordingsForLesson } from '../storage/storage.js';
import { shareVideo } from './video-share.js';
import { appStore } from '../store/store.js';
import videoHeaderEn from '../../assets/img/video-header-en.png';
import videoHeaderEs from '../../assets/img/video-header-es.png';
import videoHeaderBn from '../../assets/img/video-header-bn.png';
import videoHeaderFr from '../../assets/img/video-header-fr.png';
import { getVideoUrl, getUgcThumbKey, getCompleteVideoKey } from './video-url.js';
import { VideoRenderPlanner, TEXT_MODE_DURATION_MS, TAILING_DURATION_MS, resolveOverlayElements, resolveHeaderLayout, isShareCtaEnabled, isDroppedStep, markFirstRenderable, resolveSegmentBounds, STALL_GRACE_MS, assignSegmentTargets, buildUgcSegmentKey, isPublishableClip, calibrateSegmentRanges, SHARE_URL_BASE } from './video-processor-logic.js';
import { remoteSource } from './video-source.js';
import { DEFAULT_USER_AVATAR_URL } from '../user/tutor-config.js';
import { getAvatarBlobUrl } from '../avatar/avatar.service.js';
import { maybeAssignPosterAvatar } from '../avatar/poster-avatar.js';
import { supabase, getAccessToken } from '../api/supabase.js';
import { transcodeToMp4, verifyMp4, uploadWebmToCloudinary, transcodeRangeToMp4, probeClipDurationSec } from './transcode.js';
import { uploadSegmentToR2 } from './r2-upload.js';
import { MAX_R2_UPLOAD_BYTES } from './r2-upload-limits.js';
import { trackEvent } from '../utils/posthog.js';
import Strings from '../../data/strings.js';
import { resolveConfigLanguage } from '../bilingual/config-normalizer.js';

export { shareVideo };

// The recap header band paints an opaque water-gradient behind the banner so
// the video (and any burnt-on captions) can never show through it. Same blue as
// the app's `.water-surface`, but fully opaque.
const HEADER_GRADIENT_TOP = '#3a8fd5';
const HEADER_GRADIENT_BOTTOM = '#00c0d8';

// The header banner is localized by a two-letter language suffix
// (video-header-<lang>.png). A language with no art — and no language at all —
// falls back to English. The stored language may be uppercase or a full locale
// ('ES', 'en-US'), so normalize to the base code.
const HEADER_IMAGE_BY_LANG = {
    en: videoHeaderEn,
    es: videoHeaderEs,
    bn: videoHeaderBn,
    fr: videoHeaderFr,
};
const HEADER_IMAGE_FALLBACK = videoHeaderEn;
export function resolveHeaderImage(lang) {
    const code = String(lang || 'en').split('-')[0].toLowerCase();
    return HEADER_IMAGE_BY_LANG[code] || HEADER_IMAGE_FALLBACK;
}

// ---------------------------------------------------------------------------
// Instance factory — each processVideo call owns its own context.
// No module-level mutable state. Safe under HMR, Strict Mode double-invoke,
// and concurrent calls (though the UI prevents those via button state).
// ---------------------------------------------------------------------------
function createVideoProcessor() {
    let animationId = null;
    let fontReady = false;
    let audioContext = null;
    let audioSource = null;
    let audioDestination = null;
    let currentAudioSource = null;

    // The hidden video element is created and destroyed entirely within this
    // instance. Nothing is queried from the DOM by ID.
    const originalVideo = document.createElement('video');
    originalVideo.crossOrigin = 'anonymous';
    originalVideo.playsInline = true;
    // iPad/Safari require the legacy attribute in addition to the property to
    // permit inline (non-fullscreen) autoplay without a user gesture.
    originalVideo.setAttribute('webkit-playsinline', '');
    originalVideo.setAttribute('playsinline', '');
    originalVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(originalVideo);

    // Hidden render canvas — attached to the DOM (see process()) so iOS
    // captureStream can read its frames. Declared here so cleanup() can remove it.
    let videoCanvas = null;

    function cleanup() {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }

        if (currentAudioSource) {
            try { currentAudioSource.stop(); } catch (e) { /* ignore */ }
            currentAudioSource = null;
        }

        if (audioContext) {
            if (audioContext.state !== 'closed') {
                audioContext.close().catch(e =>
                    console.warn('[VideoProcessor] Error closing AudioContext:', e)
                );
            }
            audioContext = null;
        }
        audioSource = null;
        audioDestination = null;

        originalVideo.pause();
        originalVideo.src = '';
        originalVideo.load();
        if (originalVideo.parentNode) {
            originalVideo.parentNode.removeChild(originalVideo);
        }

        // Remove the hidden render canvas added in process().
        if (videoCanvas && videoCanvas.parentNode) {
            videoCanvas.parentNode.removeChild(videoCanvas);
        }
    }

    function initAudio() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioDestination = audioContext.createMediaStreamDestination();
        }

        if (!audioSource || audioSource.mediaElement !== originalVideo) {
            if (audioSource) audioSource.disconnect();
            audioSource = audioContext.createMediaElementSource(originalVideo);
            audioSource.connect(audioDestination);
            audioSource.connect(audioContext.destination);
        }
    }

    async function ensureFontsReady() {
        if (fontReady || !document.fonts) return;
        try {
            await Promise.all([
                document.fonts.load('700 24px "Orbitron"'),
                document.fonts.load('bold 24px "Plus Jakarta Sans"'),
            ]);
            fontReady = true;
        } catch (e) {
            console.warn('[VideoProcessor] Font load failed:', e);
        }
    }

    async function process(fluencyData = {}, lessonId = null, displayCanvas = null) {
        return new Promise(async (resolve, reject) => {
            try {
                console.log('[VideoProcessor] Starting live processing on screen...');

                // Resume the AudioContext as early as possible — ideally within
                // the user-gesture task that triggered generation. On iOS/Safari
                // the context (and therefore any unmuted playback) only unlocks
                // if resume() happens close to the tap; deferring it behind async
                // font/audio work can make the FIRST segment play silently.
                // Await it so the context is guaranteed running before playback.
                initAudio();
                if (audioContext.state === 'suspended') {
                    try {
                        await audioContext.resume();
                    } catch (e) {
                        console.warn('[VideoProcessor] AudioContext resume failed:', e);
                    }
                }

                const recordings = await getAllSpeechRecordingsForLesson(lessonId) || [];
                console.log('[VideoProcessor] processVideo called', {
                    lessonId,
                    fluencyData,
                    recordingsLength: recordings.length,
                });

                if (!recordings.length) {
                    console.warn('[VideoProcessor] No recordings found. Proceeding with text-mode/summary generation.');
                }

                videoCanvas = document.createElement('canvas');
                // iOS Safari only captures frames from a canvas that is part of
                // the rendered DOM tree; an offscreen canvas.captureStream() yields
                // a blank (gray) video track. Keep it in the DOM but hidden.
                videoCanvas.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:4px;opacity:0.01;pointer-events:none;';
                document.body.appendChild(videoCanvas);
                const overlayImage = new Image();

                // Probe dimensions from the first real recording blob
                const firstValidRec = recordings.find(r => r.blob);
                if (firstValidRec) {
                    originalVideo.src = URL.createObjectURL(firstValidRec.blob);
                    await new Promise(res => {
                        originalVideo.onloadedmetadata = res;
                        setTimeout(res, 2000);
                    });
                }

                const snapshot = appStore.getState();
                const configData = snapshot.configData || {};
                // Guest language wins over the profile language, exactly like
                // normalizeConfig (config-normalizer.js) and the rest of the app;
                // otherwise a guest who chose a language gets an English recap.
                const userLang = resolveConfigLanguage(snapshot.guestNativeLanguage, snapshot.userData?.native_language);
                // The banner is localized to the recap language.
                overlayImage.src = resolveHeaderImage(userLang);
                const shareCode = snapshot.userData?.shareCode || null;
                const planner = new VideoRenderPlanner(recordings, configData, fluencyData, userLang, shareCode);
                const plan = planner.generatePlan();

                // The lesson's recapOverlay mode decides the card: shareCta
                // recaps show the share code in the lower-right corner plus a
                // 4-line call to action over the tailing freeze-frame. The
                // header image carries the "Enter code" label, so only the code
                // itself is burned.
                const tailingStep = plan.find(s => s.type === 'tailing');
                const overlayVariant = tailingStep?.variant || 'fluency';
                const shareCta = isShareCtaEnabled(overlayVariant)
                    ? {
                        code: shareCode || SHARE_URL_BASE,
                        tailingLines: [
                            Strings.get('share_cta_respond_now', userLang),
                            Strings.get('share_cta_quick', userLang),
                            `${Strings.get('share_cta_go_to', userLang)} ${SHARE_URL_BASE}`,
                            `${Strings.get('share_cta_enter_code', userLang)} ${shareCode || SHARE_URL_BASE}`,
                        ],
                    }
                    : null;

                // Preload remote prompt clips (friend UGC) as local blobs BEFORE
                // rendering. R2 serves these without Cache-Control (and the edge
                // is DYNAMIC), so pointing a <video> at the URL per step re-fetches
                // over the network and stalls the canvas. Fetching once here — in
                // parallel, reusing the lesson's HTTP-cache entry when present —
                // lets the render loop play them from memory with zero per-step
                // network delay. A clip that cannot be fetched is dropped from the
                // plan rather than hanging the generator.
                await prefetchRemoteClips(plan, { audioContext, isSafari: detectSafari() });

                // A dropped friend prompt may have been the planned first
                // segment; re-mark the first renderable step so the fluency card
                // still opens the recap on non-shareCta lessons.
                markFirstRenderable(plan, 0);

                const dimensions = planner.getTargetDimensions(
                    originalVideo.videoWidth || 1080,
                    originalVideo.videoHeight || 1920
                );
                videoCanvas.width = dimensions.width;
                videoCanvas.height = dimensions.height;

                if (displayCanvas) {
                    displayCanvas.width = dimensions.width;
                    displayCanvas.height = dimensions.height;
                }

                const [profileImage] = await Promise.all([
                    loadProfileImage(),
                    ensureFontsReady()
                ]);

                // NOTE: webcam audio is no longer pre-decoded here. Decoding is
                // done lazily per-step inside the render loop (see executeRenderLoop)
                // so the first unmuted play happens as early as possible on iOS,
                // where a long async preamble before play() makes the OS treat the
                // first segment as autoplay-blocked and fall back to silent.

                if (typeof videoCanvas.captureStream !== 'function') {
                    throw new Error(
                        '[VideoProcessor] canvas.captureStream is not supported in this browser. ' +
                        'Ensure you are running a modern browser (Chrome 51+, Firefox 43+, Safari 11+, Edge 79+).'
                    );
                }
                const canvasStream = videoCanvas.captureStream(30);
                const combinedStream = new MediaStream([
                    ...canvasStream.getVideoTracks(),
                    ...audioDestination.stream.getAudioTracks(),
                ]);

                const mimeType = getSupportedMimeType();
                const recorder = new MediaRecorder(combinedStream, { mimeType });
                const chunks = [];

                // Per-segment publish: track each publishable step's wall-clock
                // range within this recording so exportSegmentsToR2 can trim the
                // clips out of the stitched blob (no second render pass).
                const rawRanges = [];
                let activeRange = null;
                let recordingStartAt = 0;
                const onStepStart = (step) => {
                    if (!isPublishableClip(step)) return;
                    activeRange = { step, startMs: performance.now() - recordingStartAt };
                };
                const onStepEnd = (step) => {
                    if (!activeRange || activeRange.step !== step) return;
                    rawRanges.push({ step, startMs: activeRange.startMs, endMs: performance.now() - recordingStartAt });
                    activeRange = null;
                };

                recorder.ondataavailable = e => {
                    if (e.data.size > 0) chunks.push(e.data);
                };

                recorder.onstop = async () => {
                    const blob = new Blob(chunks, { type: mimeType });
                    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
                    console.log('[VideoProcessor] recording stopped:', { size: blob.size, ext });
                    let segments = [];
                    try {
                        const elapsedMs = performance.now() - recordingStartAt;
                        if (activeRange) {
                            rawRanges.push({ step: activeRange.step, startMs: activeRange.startMs, endMs: elapsedMs });
                            activeRange = null;
                        }
                        // Header-only probe. A packet scan here would strand the
                        // recap's "Generating" state on long recordings (seen on
                        // iOS); the bogus MediaRecorder-mp4 metadata case is
                        // handled by calibrateSegmentRanges' offset sanity check.
                        let probedDurationSec = null;
                        try { probedDurationSec = await probeClipDurationSec(blob, { scan: false }); } catch (e) { /* probe is best-effort */ }
                        segments = calibrateSegmentRanges(rawRanges, elapsedMs, probedDurationSec);
                        console.log('[VideoProcessor] segment ranges:', { raw: rawRanges.length, probedDurationSec, kept: segments.length });
                    } catch (e) {
                        console.warn('[VideoProcessor] Segment range calibration failed:', e);
                        segments = [];
                    }
                    // Ride the overlay options along so the export fallback can
                    // match the recap's overlay when the trim path is unavailable.
                    segments.overlayVariant = overlayVariant;
                    segments.shareCta = shareCta;
                    try { cleanup(); } catch (e) { console.warn('[VideoProcessor] cleanup failed:', e); }
                    resolve({ blob, ext, segments });
                };

                recordingStartAt = performance.now();
                recorder.start(1000);

                await executeRenderLoop(
                    plan, originalVideo, videoCanvas, displayCanvas,
                    overlayImage, profileImage, fluencyData,
                    id => { animationId = id; },
                    audioContext, audioDestination,
                    { overlayVariant, shareCta, onStepStart, onStepEnd }
                );

                recorder.stop();

            } catch (e) {
                console.error('[VideoProcessor] Render failed:', e);
                cleanup();
                reject(e);
            }
        });
    }

    return { process, cleanup };
}

// ---------------------------------------------------------------------------
// Public API — matches the existing call site in SuccessButtons.jsx exactly:
//   const { processVideo, shareVideo } = await import('../../modules/video/video-processor.js');
//   const result = await processVideo(fluencyData, lessonId, canvas);
// ---------------------------------------------------------------------------
export async function processVideo(fluencyData = {}, lessonId = null, displayCanvas = null) {
    const processor = createVideoProcessor();
    return processor.process(fluencyData, lessonId, displayCanvas);
}

// ---------------------------------------------------------------------------
// Profile-image helpers for text-mode steps
// ---------------------------------------------------------------------------
async function loadProfileImage() {
    let src = appStore.getState().userData?.profilePictureUrl || DEFAULT_USER_AVATAR_URL;

    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => {
            console.warn('[VideoProcessor] Failed to load profile image; falling back to black background');
            resolve(null);
        };
        img.src = src;
    });
}

function drawProfileBackground(ctx, image, w, h) {
    ctx.fillStyle = '#111318';
    ctx.fillRect(0, 0, w, h);

    if (!image?.complete || image.naturalWidth <= 0) return;

    const imgAspect = image.naturalWidth / image.naturalHeight;
    const canvasAspect = w / h;
    let sx, sy, sw, sh;

    if (imgAspect > canvasAspect) {
        sh = image.naturalHeight;
        sw = sh * canvasAspect;
        sx = (image.naturalWidth - sw) / 2;
        sy = 0;
    } else {
        sw = image.naturalWidth;
        sh = sw / canvasAspect;
        sx = 0;
        sy = (image.naturalHeight - sh) / 2;
    }

    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, w, h);
}

// ---------------------------------------------------------------------------
// Render loop — receives an animationId setter so the instance can cancel it
// ---------------------------------------------------------------------------
async function executeRenderLoop(plan, video, canvas, displayCanvas, overlayImage, profileImage, fluencyData, setAnimationId, audioContext, audioDestination, { silent = false, overlayVariant = 'fluency', shareCta = null, onStepStart = null, onStepEnd = null } = {}) {
    const ctx = canvas.getContext('2d');
    const planner = new VideoRenderPlanner();
    let currentAudioSource = null;

    function stopDecodedAudio() {
        if (currentAudioSource) {
            try { currentAudioSource.stop(); } catch (e) { /* ignore */ }
            currentAudioSource = null;
        }
    }

    return new Promise(async (resolve) => {
        let stepIndex = 0;
        // Object URL of the clip currently loaded into `video`; revoked when the
        // next step loads (or on finish) so blobs are not pinned for the page life.
        let currentObjectUrl = null;
        const finish = () => {
            // Close any still-open step range (a publishable clip that never
            // advanced, e.g. the loop ended on its last step).
            onStepEnd?.(plan[stepIndex]);
            if (currentObjectUrl) {
                URL.revokeObjectURL(currentObjectUrl);
                currentObjectUrl = null;
            }
            video.onerror = null;
            video.onloadedmetadata = null;
            resolve();
        };
        let isTailing = false;
        let tailStart = 0;
        let lastFrameCanvas = null;
        // Wall-clock start of the current video step, used as a safety net so a
        // stalled video can never permanently hang the generator on iPad/Safari.
        let stepPlayStart = 0;
        // True only once the current step's video has actually begun playback.
        // Guards the resume logic so it cannot fire during a source swap
        // between steps (where the previous frame is still buffered and the
        // element is momentarily paused), which would restart the wrong segment.
        let stepStartedPlaying = false;

        // Safari/iPadOS can't capture audio from blob-URL <video> via
        // createMediaElementSource, so webcam audio is decoded and played
        // directly as a buffer source. Detect once.
        const isSafari = detectSafari();

        const nextStep = async () => {
            // Drop any remote clip that could not be prefetched or that failed to
            // load (missing/expired friend UGC) rather than stalling on it.
            while (stepIndex < plan.length && isDroppedStep(plan[stepIndex])) {
                stepIndex++;
            }
            if (stepIndex >= plan.length) {
                finish();
                return;
            }

            stopDecodedAudio();

            const step = plan[stepIndex];

            // True once the loop has advanced past this step (e.g. the 3s
            // metadata timeout won the race) — late async media handlers must
            // not touch the element, which then holds the next step's clip.
            const stale = () => plan[stepIndex] !== step;

            if (step.type === 'tailing') {
                isTailing = true;
                tailStart = performance.now();

                lastFrameCanvas = document.createElement('canvas');
                lastFrameCanvas.width = canvas.width;
                lastFrameCanvas.height = canvas.height;

                if (video.readyState >= 2) {
                    lastFrameCanvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
                } else {
                    const lCtx = lastFrameCanvas.getContext('2d');
                    lCtx.fillStyle = '#111318';
                    lCtx.fillRect(0, 0, canvas.width, canvas.height);
                }
                return;
            }

            if (step.type === 'webcam' && (!step.blob || step.isTextMode)) {
                video.src = '';
                step.textModeStartTime = performance.now();
                return;
            }

            video.crossOrigin = 'anonymous';
            // Reset per-step playback health tracking before (re)starting.
            step.resumeAttempted = false;
            stepStartedPlaying = false;
            stepPlayStart = 0;
            step.loadFailed = false;
            step.playFatal = false;
            step.mediaDurationSec = undefined;
            if (currentObjectUrl) {
                URL.revokeObjectURL(currentObjectUrl);
                currentObjectUrl = null;
            }
            let sourceUrl;
            try {
                if (step.type === 'remote') {
                    sourceUrl = step.remoteBlob
                        ? (currentObjectUrl = URL.createObjectURL(step.remoteBlob))
                        : await resolveRemoteUrl(step.targetId);
                } else {
                    sourceUrl = currentObjectUrl = URL.createObjectURL(step.blob);
                }
            } catch (e) {
                // Could not resolve the clip source at all — drop the step rather
                // than leaving the draw loop waiting on a clip that never loads.
                console.warn('[VideoProcessor] Clip source resolution failed; dropping step:', e);
                step.loadFailed = true;
                return;
            }
            video.src = sourceUrl;
            video.load();

            // `metadataLoaded` flips synchronously when metadata arrives. A step
            // whose metadata never arrives (3s timeout) or whose playback fails
            // fatally is dropped; a clip that loaded but is still buffering is NOT
            // dropped — the draw loop's stall guard covers that case.
            let metadataLoaded = false;
            await new Promise(res => {
                video.onerror = () => {
                    step.loadFailed = true;
                    res();
                };
                video.onloadedmetadata = async () => {
                    metadataLoaded = true;

                    // A MediaRecorder blob (iOS WebM) can report a non-finite
                    // duration; force it before anything relies on it, or the
                    // draw loop's advance check can never fire.
                    if (!Number.isFinite(video.duration)) {
                        step.resolvingDuration = true;
                        await forceVideoDuration(video);
                        // The seek used to force the duration parks the element
                        // at the end (and can leave it `ended`), which would make
                        // the draw loop skip the clip instantly. Rewind to the
                        // trim start before playback.
                        try {
                            video.currentTime = step.trim?.start || 0;
                        } catch (e) {
                            console.warn('[VideoProcessor] Rewind after duration probe failed:', e);
                        }
                        // If the element still cannot report a length (iPad
                        // MediaRecorder WebM), read the real container duration
                        // directly. The segment then advances on its actual
                        // length rather than its net speaking time.
                        //
                        // Await the probe directly — no timeout race. The
                        // step.resolvingDuration hold keeps the draw loop on
                        // this frame, and the probe always settles (finite
                        // in-memory Blob + skipLiveWait, errors caught), so a
                        // short race would only risk truncating a valid clip.
                        if (!Number.isFinite(video.duration)) {
                            step.mediaDurationSec = await probeClipDurationSec(step.blob || step.remoteBlob);
                            console.log('[VideoProcessor] Probed clip duration:', step.mediaDurationSec, 'step', stepIndex);
                        }
                        step.resolvingDuration = false;
                    }
                    if (step.trim?.start) video.currentTime = step.trim.start;

                    // On Safari/iPadOS, createMediaElementSource delivers no audio
                    // from a <video>, AND playing a clip unmuted through the element
                    // double-outputs (element + graph). So ALL clips are decoded and
                    // played via a buffer source with the element muted — a single,
                    // reliable audio path. Decoding is lazy per step.
                    const needsDecodedAudio = isSafari && (
                        (step.type === 'webcam' && step.blob && !step.isTextMode) ||
                        step.type === 'remote'
                    );
                    if (needsDecodedAudio && !step.decodedAudio) {
                        try {
                            let buf;
                            if (step.type === 'webcam') {
                                buf = await step.blob.arrayBuffer();
                            } else if (step.remoteBlob) {
                                buf = await step.remoteBlob.arrayBuffer();
                            } else {
                                const url = await resolveRemoteUrl(step.targetId);
                                const resp = await fetch(url);
                                buf = await resp.arrayBuffer();
                            }
                            step.decodedAudio = await audioContext.decodeAudioData(buf);
                        } catch (e) {
                            console.warn('[VideoProcessor] Audio decode failed:', e);
                            step.decodedAudio = null;
                        }
                    }

                    // Start the decoded-audio buffer source. Must run on BOTH the
                    // normal and the autoplay-blocked (muted retry) paths, or a
                    // blocked step would play with no audio. Audio begins exactly
                    // when the <video> fires 'playing' so it stays locked to the
                    // picture (no lead/lag).
                    const startDecodedAudio = () => {
                        if (currentAudioSource || !step.decodedAudio || !audioContext) return;
                        const begin = () => {
                            if (currentAudioSource) return;
                            if (audioContext.state === 'suspended') audioContext.resume();
                            const source = audioContext.createBufferSource();
                            source.buffer = step.decodedAudio;
                            source.connect(audioDestination);
                            // Also connect to speakers so the user hears the clip —
                            // unless `silent` is true (background export, which
                            // would blast every clip through the speakers).
                            if (!silent) source.connect(audioContext.destination);
                            const offset = Math.max(0, (video.currentTime || 0) - (step.trim?.start || 0));
                            source.start(audioContext.currentTime, offset);
                            currentAudioSource = source;
                        };
                        if (video.paused) video.addEventListener('playing', begin, { once: true });
                        else begin();
                    };

                    // If the loop already advanced (e.g. the 3s timeout won the
                    // race while this async body was decoding/awaiting play), do
                    // not touch the element — it now holds the next step's clip.
                    if (stale()) {
                        res();
                        return;
                    }

                    // Decide the audio path BEFORE play. On iPad an unmuted
                    // element routed through createMediaElementSource
                    // double-outputs into the recording (echo) until the mute
                    // lands, so mute up front and let the decoded buffer be the
                    // single audio source.
                    const useDecodedAudio = !!(step.decodedAudio && audioContext);
                    video.muted = useDecodedAudio;

                    try {
                        await video.play();
                        if (stale()) {
                            res();
                            return;
                        }
                        if (useDecodedAudio) startDecodedAudio();
                        // Record when playback actually (re)started so the draw
                        // loop can detect stalls and apply a wall-clock fallback.
                        stepStartedPlaying = true;
                        stepPlayStart = performance.now();
                        onStepStart?.(step);
                    } catch (err) {
                        console.warn('[VideoProcessor] Browser blocked autoplay. Retrying muted.', err);
                        if (stale()) {
                            res();
                            return;
                        }
                        video.muted = true;
                        try {
                            await video.play();
                            if (stale()) {
                                res();
                                return;
                            }
                            // Even on the muted-retry path, start decoded audio so
                            // the clip is not silent.
                            startDecodedAudio();
                            // Non-Safari relies on the element's own audio, so
                            // restore it after a blocked-autoplay mute — otherwise
                            // every remaining step records silence.
                            if (!useDecodedAudio) video.muted = false;
                            stepStartedPlaying = true;
                            stepPlayStart = performance.now();
                            onStepStart?.(step);
                        } catch (fatalErr) {
                            console.error('[VideoProcessor] Fatal play error', fatalErr);
                            step.playFatal = true;
                            // Draw reads loadFailed every frame, so this still
                            // advances even if the 3s timeout already resolved.
                            step.loadFailed = true;
                        }
                    }
                    res();
                };
                setTimeout(res, 3000);
            });

            // Metadata never arrived, or playback failed on both attempts →
            // advance instead of waiting forever. A clip that loaded but is still
            // buffering is not dropped; instead arm the wall clock from here so a
            // silent stall (play() never settles) still advances via the draw
            // loop's stalledTimeout.
            if (!metadataLoaded || step.playFatal) {
                step.loadFailed = true;
            } else if (!stepStartedPlaying) {
                stepPlayStart = performance.now();
            }
        };

        const draw = () => {
            const step = plan[stepIndex];
            if (!step) return;

            if (isTailing && lastFrameCanvas) {
                ctx.fillStyle = '#111318';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(lastFrameCanvas, 0, 0);
            } else if (step.type === 'webcam' && (!step.blob || step.isTextMode)) {
                drawProfileBackground(ctx, profileImage, canvas.width, canvas.height);
            } else if (video.readyState >= 2) {
                const layout = planner.calculateLayout(
                    video.videoWidth, video.videoHeight, canvas.width, canvas.height
                );
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(video, layout.x, layout.y, layout.width, layout.height);
            } else if (lastFrameCanvas) {
                // Video is buffering — show the last captured frame to avoid
                // a black flash during the transition between segments.
                ctx.fillStyle = '#111318';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(lastFrameCanvas, 0, 0);
            } else {
                // Video is buffering and no freeze-frame is available yet.
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            const headerLayout = overlayImage?.complete && overlayImage.naturalWidth > 0
                ? resolveHeaderLayout({
                    naturalWidth: overlayImage.naturalWidth,
                    naturalHeight: overlayImage.naturalHeight,
                    canvasWidth: canvas.width,
                    canvasHeight: canvas.height,
                })
                : null;
            if (headerLayout) {
                // 100% opaque gradient header band, so the video (and any burnt
                // captions) can never show through the banner or the prompt.
                const headerGradient = ctx.createLinearGradient(0, 0, 0, headerLayout.headerBottom);
                headerGradient.addColorStop(0, HEADER_GRADIENT_TOP);
                headerGradient.addColorStop(1, HEADER_GRADIENT_BOTTOM);
                ctx.fillStyle = headerGradient;
                ctx.fillRect(0, 0, canvas.width, headerLayout.headerBottom);
                ctx.drawImage(
                    overlayImage,
                    headerLayout.x, headerLayout.y,
                    headerLayout.width, headerLayout.height
                );
            }

            drawTextOverlay(
                ctx, canvas.width, canvas.height,
                isTailing, tailStart, fluencyData,
                step.isFirst, step.subtitle,
                overlayVariant, shareCta
            );

            if (displayCanvas) {
                const dCtx = displayCanvas.getContext('2d');
                dCtx.drawImage(canvas, 0, 0, displayCanvas.width, displayCanvas.height);
            }

            let shouldAdvance = false;
            if (isTailing) {
                if (performance.now() - tailStart > TAILING_DURATION_MS) finish();
            } else if (step.loadFailed) {
                // The clip never loaded — advance instead of waiting forever.
                shouldAdvance = true;
                // If the opening step failed, pass "first" to the next
                // renderable step so the fluency card still opens the recap.
                if (step.isFirst) markFirstRenderable(plan, stepIndex + 1);
            } else {
                if (step.resolvingDuration) {
                    // Duration is still being resolved (MediaRecorder blob);
                    // hold this frame rather than risk a premature advance.
                } else if (step.isTextMode || (step.type === 'webcam' && !step.blob)) {
                    const elapsed = performance.now() - (step.textModeStartTime || performance.now());
                    const holdMs = step.duration != null ? step.duration * 1000 : TEXT_MODE_DURATION_MS;
                    if (elapsed >= holdMs) shouldAdvance = true;
                } else {
                    // Resolve the segment's end from, in order: the explicit
                    // trim, the element's real media length, or the probed
                    // container duration. Net speaking time is never a media
                    // length, so it is not consulted.
                    const { endTime, wallClockCapMs } = resolveSegmentBounds({
                        trimEnd: step.trim?.end,
                        rawDuration: video.duration,
                        fallbackDurationSec: step.mediaDurationSec,
                        start: step.trim?.start || 0,
                    });

                    // On iPad/Safari the OS can silently pause inline video
                    // (autoplay/interruption). If that happens, resume it so the
                    // video does not freeze and the step can still complete.
                    if (stepStartedPlaying && video.paused && !video.ended && video.readyState >= 2) {
                        if (!step.resumeAttempted) {
                            step.resumeAttempted = true;
                            console.warn('[VideoProcessor] Video paused by OS; resuming playback.');
                            video.play().catch(retryErr => {
                                console.warn('[VideoProcessor] Resume blocked; retrying muted.', retryErr);
                                video.muted = true;
                                video.play().catch(fatalErr =>
                                    console.error('[VideoProcessor] Resume fatal error', fatalErr)
                                );
                            });
                        }
                    }

                    // Advance on natural end, or on a wall-clock fallback. The
                    // fallback guarantees a stalled/non-ending video can never
                    // leave the generator stuck on "Generating" indefinitely.
                    const stalledTimeout =
                        stepPlayStart && wallClockCapMs > 0 &&
                        performance.now() - stepPlayStart > wallClockCapMs + STALL_GRACE_MS;
                    // `video.ended` is only meaningful once this step has actually
                    // played — the duration probe seeks to the end and can leave
                    // the element `ended` before playback starts, which would skip
                    // the clip entirely.
                    const endedNaturally = stepStartedPlaying && video.ended;
                    if (endedNaturally || video.currentTime >= endTime || stalledTimeout) {
                        shouldAdvance = true;
                    }
                }
            }

            if (shouldAdvance) {
                // Capture the last frame as a freeze-frame so the next
                // segment shows something while its video loads.
                if (video.readyState >= 2) {
                    if (!lastFrameCanvas) {
                        lastFrameCanvas = document.createElement('canvas');
                        lastFrameCanvas.width = canvas.width;
                        lastFrameCanvas.height = canvas.height;
                    }
                    lastFrameCanvas.getContext('2d').drawImage(
                        video, 0, 0, lastFrameCanvas.width, lastFrameCanvas.height
                    );
                } else if (step.type === 'webcam' && step.isTextMode) {
                    // Text-mode steps have no <video> frame; freeze the rendered canvas.
                    if (!lastFrameCanvas) {
                        lastFrameCanvas = document.createElement('canvas');
                        lastFrameCanvas.width = canvas.width;
                        lastFrameCanvas.height = canvas.height;
                    }
                    lastFrameCanvas.getContext('2d').drawImage(
                        canvas, 0, 0, lastFrameCanvas.width, lastFrameCanvas.height
                    );
                }
                stopDecodedAudio();
                // NOTE: do NOT null step.remoteBlob/decodedAudio here. `draw`
                // runs every frame and `shouldAdvance` stays true until
                // nextStep() swaps the element; the plan objects are reused by
                // the per-segment export fallback (renderStepToBlob spreads the
                // step), so mutating them can drop clips.
                onStepEnd?.(step);
                stepIndex++;
                nextStep();
            }

            if (stepIndex < plan.length || isTailing) {
                setAnimationId(requestAnimationFrame(draw));
            }
        };

        await nextStep();
        draw();
    });
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/**
 * Word-wrap a string into lines that fit within maxWidth when rendered
 * with the current font on the given context.
 */
// ---------------------------------------------------------------------------
// Complex-script text measurement
//
// Canvas 2D `measureText` is unreliable for complex scripts on WebKit: when a
// glyph is supplied by a fallback font (any Bengali/Hindi text, since the
// primary family has no such glyphs), iPadOS Safari can under-report — or
// return ~0 for — the advance. `drawFittedLine` then never shrinks and
// `textAlign='center'` centres on the ~0 advance, so the text is drawn at full
// size from the centre outward and overflows the frame (the recap share-CTA
// headline/deadline bug). The DOM lays complex scripts out correctly, so
// measure through a hidden <span> with the same font and take the larger of the
// two. Results are cached per (font, text) so the per-frame render loop does no
// repeated layout work.
// ---------------------------------------------------------------------------
const textMeasureCache = new Map();

function measureTextWidthDom(text, font) {
    if (typeof document === 'undefined' || !text) return 0;
    const key = `${font}\u0000${text}`;
    const cached = textMeasureCache.get(key);
    if (cached !== undefined) return cached;

    let width = 0;
    try {
        const span = document.createElement('span');
        span.textContent = text;
        span.style.cssText =
            `position:absolute;left:-9999px;top:-9999px;visibility:hidden;white-space:pre;font:${font};`;
        document.body.appendChild(span);
        width = span.getBoundingClientRect().width;
        span.remove();
    } catch (e) {
        width = 0;
    }

    // Bound the cache; a long session with many cues should not grow unbounded.
    if (textMeasureCache.size > 4000) textMeasureCache.clear();
    textMeasureCache.set(key, width);
    return width;
}

/** The widest of the canvas advance, the canvas ink box, and the DOM layout. */
function measureTextWidth(context, text) {
    const m = context.measureText(text);
    const canvasInk = Math.max(
        m.width || 0,
        Math.abs(m.actualBoundingBoxLeft || 0) + Math.abs(m.actualBoundingBoxRight || 0)
    );
    return Math.max(canvasInk, measureTextWidthDom(text, context.font));
}

function wrapText(context, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let line = '';

    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        if (measureTextWidth(context, testLine) > maxWidth && n > 0) {
            lines.push(line.trim());
            line = words[n] + ' ';
        } else {
            line = testLine;
        }
    }
    lines.push(line.trim());
    return lines;
}

/**
 * Draws a single line of text, shrinking the font until it fits within
 * maxWidth. Never wraps — used for the share code and the call-to-action lines,
 * which must each stay on one line. `align` anchors the text on `centerX`
 * ('center') or sets `centerX` as its right edge ('right').
 */
function drawFittedLine(context, text, centerX, y, { fontFamily, maxWidth, baseSize, minSize = 18, color = 'white', align = 'center' }) {
    let size = baseSize;
    context.font = `700 ${size}px ${fontFamily}`;
    while (size > minSize && measureTextWidth(context, text) > maxWidth) {
        size -= 1;
        context.font = `700 ${size}px ${fontFamily}`;
    }
    // Draw left-aligned from an explicitly anchored origin. `centerX` is the
    // centre for align='center' or the right edge for align='right'.
    // `textAlign='center'` aligns on the canvas advance width, which WebKit
    // under-reports for complex scripts, so the ink is pushed to the right; the
    // DOM-measured width used here is correct for the same font.
    const width = measureTextWidth(context, text);
    const x = align === 'right' ? centerX - width : centerX - width / 2;
    context.fillStyle = color;
    context.strokeStyle = 'rgba(0,0,0,0.8)';
    context.lineWidth = Math.max(6, Math.round(size * 0.18));
    const prevAlign = context.textAlign;
    context.textAlign = 'left';
    context.strokeText(text, x, y);
    context.fillText(text, x, y);
    context.textAlign = prevAlign;
    return size;
}

/**
 * Draws a single line of already-positioned text horizontally centred on
 * `centerX`, using the DOM-measured width so complex scripts centre correctly
 * (see measureTextWidth). Assumes context.fillStyle/font are already set.
 */
function drawCenteredLine(context, text, centerX, y, { stroke = null, strokeWidth = 0 } = {}) {
    const width = measureTextWidth(context, text);
    const prevAlign = context.textAlign;
    context.textAlign = 'left';
    if (stroke && strokeWidth > 0) {
        // A thick outline (like the burned lesson subtitles' -webkit-text-stroke)
        // keeps the glyphs readable over any footage without a background box.
        const prevJoin = context.lineJoin;
        context.lineJoin = 'round';
        context.lineWidth = strokeWidth;
        context.strokeStyle = stroke;
        context.strokeText(text, centerX - width / 2, y);
        context.lineJoin = prevJoin;
    }
    context.fillText(text, centerX - width / 2, y);
    context.textAlign = prevAlign;
}

function drawTextOverlay(context, canvasWidth, canvasHeight, tailing, tailStart, fluencyData, isFirst, subtitleText, overlayVariant = 'fluency', shareCta = null) {
    const now = performance.now();
    const blinkOn = Math.floor(now / 500) % 2 === 0;
    context.save();

    const { fluencyCard, headlineBlock, tailingCard } = resolveOverlayElements({
        variant: overlayVariant,
        isFirst,
        tailing
    });

    if (fluencyCard) {
        const yFromBottom = canvasHeight * 0.20;
        const baseY = canvasHeight - yFromBottom;
        const lineGap = Math.max(5, Math.round(canvasHeight * 0.03));

        context.textAlign = 'center';
        context.textBaseline = 'top';
        context.fillStyle = 'yellow';
        const centerX = Math.floor(canvasWidth / 2);

        const data = tailing
            ? [
                { text: 'FLUENCY SCORE', mult: 1.35, blink: false },
                { text: `${fluencyData.total || 'NA'}%`, mult: 1.8, blink: true },
              ]
            : [
                { text: 'CALCULATING', mult: 1.0, blink: true },
                { text: 'FLUENCY', mult: 1.0, blink: true },
              ];

        const baseSize = 30;
        context.font = `700 ${baseSize}px "Orbitron", sans-serif`;

        const longestWidth = Math.max(
            context.measureText(data[0].text).width,
            context.measureText(data[1].text).width
        );

        const desiredWidth = canvasWidth * 0.7;
        const scale = desiredWidth / (longestWidth || 1);
        const baseFontSize = Math.max(18, Math.floor(baseSize * scale));

        const heights = data.map(d => {
            const size = Math.floor(baseFontSize * d.mult);
            context.font = `700 ${size}px "Orbitron", sans-serif`;
            const m = context.measureText(d.text);
            return (m.actualBoundingBoxAscent || size * 0.7) + (m.actualBoundingBoxDescent || size * 0.3);
        });

        const totalHeight = heights.reduce((a, b) => a + b, 0) + (data.length - 1) * lineGap;
        const startY = baseY - totalHeight - Math.max(20, Math.floor(canvasHeight * 0.1));

        context.shadowColor = 'rgba(0, 0, 0, 0.8)';
        context.shadowBlur = Math.max(8, Math.round(baseFontSize * 0.3));

        let y = startY;
        data.forEach((d, i) => {
            const fontSize = Math.floor(baseFontSize * d.mult);
            context.font = `700 ${fontSize}px "Orbitron", sans-serif`;
            if (!d.blink || blinkOn) {
                context.strokeStyle = 'rgba(0,0,0,0.8)';
                context.lineWidth = Math.max(6, Math.round(fontSize * 0.18));
                context.strokeText(d.text, centerX, y);
                context.fillText(d.text, centerX, y);
            }
            y += heights[i] + lineGap;
        });
    }

    // Share CTA. The header image already carries the "Enter code" label, so
    // only the code is burned — in the lower-right corner with a healthy margin.
    // The 4-line call to action shows over the tailing freeze-frame. Each line
    // is drawn with drawFittedLine (never wrapText) so it stays on one line.
    const ctaFontFamily = '"Plus Jakarta Sans", "Noto Sans Bengali", "Bangla Sangam MN", "Nirmala UI", sans-serif';

    if (headlineBlock && shareCta) {
        const marginX = Math.round(canvasWidth * 0.06);
        const marginY = Math.round(canvasHeight * 0.06);
        context.textAlign = 'right';
        context.textBaseline = 'bottom';
        context.shadowColor = 'rgba(0, 0, 0, 0.8)';
        context.shadowBlur = Math.max(6, Math.round(canvasWidth * 0.01));
        drawFittedLine(context, shareCta.code, canvasWidth - marginX, canvasHeight - marginY, {
            fontFamily: ctaFontFamily,
            maxWidth: canvasWidth * 0.6,
            baseSize: Math.max(16, Math.round(canvasWidth * 0.05)),
            minSize: 12,
            color: 'white',
            align: 'right',
        });
    }

    if (tailingCard && shareCta) {
        const centerX = Math.floor(canvasWidth / 2);
        const maxWidth = canvasWidth * 0.9;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.shadowColor = 'rgba(0, 0, 0, 0.8)';
        context.shadowBlur = Math.max(8, Math.round(canvasWidth * 0.012));
        // One uniform size for all lines: shrink to the longest so the block
        // reads evenly instead of each line scaling on its own.
        const lines = shareCta.tailingLines;
        let size = Math.round(canvasWidth * 0.055);
        context.font = `700 ${size}px ${ctaFontFamily}`;
        while (size > 14 && lines.some(l => measureTextWidth(context, l) > maxWidth)) {
            size -= 1;
            context.font = `700 ${size}px ${ctaFontFamily}`;
        }
        const lineGap = Math.round(canvasHeight * 0.06);
        let y = canvasHeight * 0.5 - (lineGap * (lines.length - 1)) / 2;
        for (const line of lines) {
            drawFittedLine(context, line, centerX, y, { fontFamily: ctaFontFamily, maxWidth, baseSize: size, color: 'white' });
            y += lineGap;
        }
    }

    // Unpack subtitle — support legacy string and new { en, translation } object
    let enText = '';
    let translationText = null;
    if (typeof subtitleText === 'string') {
        enText = subtitleText;
    } else if (subtitleText && typeof subtitleText === 'object') {
        enText = subtitleText.en || '';
        translationText = subtitleText.translation || null;
    }

    if (enText.trim() !== '') {
        context.textAlign = 'center';
        context.textBaseline = 'bottom';
        const centerX = Math.floor(canvasWidth / 2);

        const enFontSize = Math.max(16, Math.round(canvasWidth * 0.05));
        const maxSubtitleWidth = canvasWidth * 0.9;

        // Word-wrap English text
        context.font = `bold ${enFontSize}px "Plus Jakarta Sans", sans-serif`;
        const enLines = wrapText(context, enText, maxSubtitleWidth);

        // Word-wrap translation text (if present)
        let trLines = [];
        const trFontSize = Math.round(enFontSize * 0.85);
        if (translationText && translationText.trim() !== '') {
            context.font = `${trFontSize}px "Plus Jakarta Sans", sans-serif`;
            trLines = wrapText(context, translationText, maxSubtitleWidth);
        }

        const enLineHeight = enFontSize * 1.2;
        const trLineHeight = trFontSize * 1.3;
        const gapBetween = Math.round(enFontSize * 0.15);

        // Anchor the block 20% of the height up from the bottom and grow upward.
        // A fixed fraction (not an on-screen pixel clearance) keeps it in exactly
        // the same place on every export and clear of the speaker's face.
        const SUBTITLE_BOTTOM_RATIO = 0.20;
        const blockBottomY = canvasHeight * (1 - SUBTITLE_BOTTOM_RATIO);

        // No background box: a thick black outline (like the burned lesson
        // subtitles' -webkit-text-stroke) plus a soft shadow keeps the letters
        // readable over any footage.
        const enStroke = Math.max(4, Math.round(enFontSize * 0.16));
        const trStroke = Math.max(3, Math.round(trFontSize * 0.16));
        context.fillStyle = 'white';
        context.shadowColor = 'rgba(0, 0, 0, 0.6)';
        context.shadowBlur = Math.max(4, Math.round(enFontSize * 0.12));
        context.shadowOffsetY = Math.max(1, Math.round(enFontSize * 0.04));

        // Draw from the bottom up so the block extends toward the top (matching
        // the SimpleVideoPlayer overlay, which grows upward from its anchor).
        let lineY = blockBottomY;
        if (trLines.length > 0) {
            context.font = `${trFontSize}px "Plus Jakarta Sans", sans-serif`;
            for (let i = trLines.length - 1; i >= 0; i--) {
                drawCenteredLine(context, trLines[i], centerX, lineY, { stroke: 'black', strokeWidth: trStroke });
                lineY -= trLineHeight;
            }
            lineY -= gapBetween;
        }
        context.font = `bold ${enFontSize}px "Plus Jakarta Sans", sans-serif`;
        for (let i = enLines.length - 1; i >= 0; i--) {
            drawCenteredLine(context, enLines[i], centerX, lineY, { stroke: 'black', strokeWidth: enStroke });
            lineY -= enLineHeight;
        }
    }

    context.restore();
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
async function resolveRemoteUrl(vUrl) {
    return getVideoUrl(vUrl);
}

// iPadOS/Safari cannot play a <video>'s audio through createMediaElementSource
// (it delivers nothing), and an unmuted element double-outputs (element + graph).
// The recap therefore mutes the element and plays a decoded buffer instead.
function detectSafari() {
    return /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
        || /iPad|iPhone|iPod/.test(navigator.userAgent);
}

// MediaRecorder blobs — iOS WebM in particular — report a non-finite `duration`
// until the browser has read to the end of the file. The draw loop advances on
// `currentTime >= duration`, so a non-finite duration freezes the segment
// forever. Seeking past the end forces the browser to compute it.
function forceVideoDuration(video) {
    return new Promise((resolve) => {
        if (Number.isFinite(video.duration)) {
            resolve();
            return;
        }
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            video.removeEventListener('durationchange', done);
            video.removeEventListener('timeupdate', done);
            resolve();
        };
        video.addEventListener('durationchange', done);
        video.addEventListener('timeupdate', done);
        setTimeout(done, 2000);
        try {
            video.currentTime = 1e7;
        } catch (e) {
            done();
        }
    });
}

// Fetch every friend (UGC) prompt clip into memory before the canvas render
// loop starts. R2 serves these without Cache-Control and the edge cache is
// DYNAMIC, so a per-step <video src=url> re-downloads over the network and
// stalls. Fetching once here — in parallel, and reusing the lesson's HTTP-cache
// entry when the upload carries Cache-Control — means the loop plays from a
// local blob with no network wait. Clips that fail are marked so the loop skips
// them instead of hanging. Scoped to friend slugs (not system prompts) to bound
// memory, since a lesson's friend clips are the ones that stall the recap.
// On Safari the clip's audio is also decoded here, so the render loop never
// blocks on decodeAudioData mid-segment.
async function prefetchRemoteClips(plan, { audioContext, isSafari } = {}) {
    const remoteSteps = plan.filter(s => s.type === 'remote' && remoteSource(s.targetId) === 'friend');
    await Promise.all(remoteSteps.map(async (step) => {
        try {
            const url = await resolveRemoteUrl(step.targetId);
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            step.remoteBlob = await resp.blob();
            if (isSafari && audioContext) {
                try {
                    step.decodedAudio = await audioContext.decodeAudioData(await step.remoteBlob.arrayBuffer());
                } catch (e) {
                    console.warn('[VideoProcessor] Remote clip audio pre-decode failed:', step.targetId, e);
                    step.decodedAudio = null;
                }
            }
        } catch (e) {
            console.warn('[VideoProcessor] Remote clip prefetch failed; dropping step:', step.targetId, e);
            step.remoteFailed = true;
        }
    }));
}

function getSupportedMimeType() {
    const isIOSDevice =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    const types = isIOSDevice
        ? [
            'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
            'video/mp4;codecs=avc1.42E01E',
            'video/mp4',
            'video/webm;codecs=vp8,opus',
          ]
        : [
            'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
            'video/mp4',
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm',
          ];

    return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}


// ---------------------------------------------------------------------------
// Per-segment R2 export pipeline (background, fire-and-forget)
//
// Reuses the module-level executeRenderLoop (with isFirst:false per step and
// the new `silent` flag) to render each publishable segment, transcodes to
// mp4 via the transcode layer, and uploads to R2. Login-gated; shareCode is
// read from the store. All work is non-blocking — the caller (SuccessButtons)
// does NOT await this.
// ---------------------------------------------------------------------------

// Module-level singletons reused across all export runs in the session.
// The AudioContext MUST be created+resumed inside a user gesture; the
// recap "Generate" click IS that gesture, so lazy-creating on the first
// export call is correct. It is intentionally never closed.
let exportAudioContext = null;
let exportVideoCanvas = null;
let exportVideoElement = null;
let exportAudioSource = null;

function getOrCreateExportAudioContext() {
    if (!exportAudioContext) {
        exportAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (exportAudioContext.state === 'suspended') {
        exportAudioContext.resume().catch(() => {});
    }
    return exportAudioContext;
}

function getOrCreateExportVideoCanvas(width, height) {
    if (!exportVideoCanvas) {
        exportVideoCanvas = document.createElement('canvas');
        // iOS Safari only captures frames from a canvas that is part of
        // the rendered DOM tree; an offscreen canvas.captureStream() yields
        // a blank (gray) video track. Keep it in the DOM but hidden.
        exportVideoCanvas.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:4px;opacity:0.01;pointer-events:none;';
        document.body.appendChild(exportVideoCanvas);
    }
    exportVideoCanvas.width = width;
    exportVideoCanvas.height = height;
    return exportVideoCanvas;
}

function getOrCreateExportVideoElement() {
    if (!exportVideoElement) {
        exportVideoElement = document.createElement('video');
        exportVideoElement.crossOrigin = 'anonymous';
        exportVideoElement.playsInline = true;
        exportVideoElement.setAttribute('webkit-playsinline', '');
        exportVideoElement.setAttribute('playsinline', '');
        exportVideoElement.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
        document.body.appendChild(exportVideoElement);
    }
    return exportVideoElement;
}

// Transcode a blob to mp4 with the shared fallback contract: WebCodecs first,
// then Cloudinary when the browser cannot encode H.264/AAC (or the result fails
// the mp4 shape check). Returns { mp4, path } where path is 'webcodecs' |
// 'cloudinary', or { mp4: null, path: null } when both paths fail. Never throws.
// Single source of truth for the fallback chain used by both the per-segment
// export and the concatenated-recap upload.
async function transcodeToMp4WithFallback(blob) {
    try {
        const mp4 = await transcodeToMp4(blob);
        if (!await verifyMp4(mp4)) throw new Error('verify-failed');
        return { mp4, path: 'webcodecs' };
    } catch (e) {
        if (e?.message === 'webcodecs-unavailable' || e?.message === 'verify-failed') {
            try {
                const mp4 = await uploadWebmToCloudinary(blob);
                return { mp4, path: 'cloudinary' };
            } catch (ce) {
                console.error('[Transcode] Cloudinary fallback failed:', ce);
            }
        } else {
            console.error('[Transcode] transcodeToMp4 error:', e);
        }
        return { mp4: null, path: null };
    }
}

// Render a single plan step into a per-segment Blob by reusing executeRenderLoop
// with a single-step plan (isFirst:false) and the silent flag. This is the
// fallback used only when the primary trim path cannot run (no WebCodecs); the
// step is rendered with the recap's overlay so the clip matches the trimmed one.
async function renderStepToBlob({ step, video, canvas, overlayImage, profileImage, fluencyData, audioContext, overlayVariant = 'fluency', shareCta = null }) {
    const audioDestination = audioContext.createMediaStreamDestination();

    // Route the webcam <video> element's audio into the recording graph. On
    // non-Safari browsers executeRenderLoop does NOT decode audio (it relies on
    // this createMediaElementSource path, exactly like the main process() path
    // via initAudio). Without it the recorded segment is silent. We connect only
    // to audioDestination (not speakers) because this is a background export and
    // `silent` is true. createMediaElementSource can be called only once per
    // element, so lazily create and cache it on the export video element.
    if (!exportAudioSource) {
        exportAudioSource = audioContext.createMediaElementSource(video);
    }
    exportAudioSource.connect(audioDestination);

    const canvasStream = canvas.captureStream(30);
    const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks(),
    ]);
    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(combinedStream, mimeType ? { mimeType } : {});
    const chunks = [];
    recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const blob = await new Promise((resolve, reject) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || 'video/webm' }));
        recorder.onerror = (e) => reject(e.error || new Error('MediaRecorder error'));
        recorder.start(1000);
        executeRenderLoop(
            [{ ...step, isFirst: false }],
            video, canvas, null,
            overlayImage, profileImage, fluencyData,
            () => {},
            audioContext, audioDestination,
            { silent: true, overlayVariant, shareCta }
        ).then(() => recorder.stop()).catch((e) => {
            try { recorder.stop(); } catch {}
            reject(e);
        });
    });
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    return { blob, ext };
}

export async function exportSegmentsToR2(lessonId, segments = [], stitchedBlob = null) {
    if (!appStore.getState().isLoggedIn) {
        console.warn('[ExportSegments] Not logged in, aborting R2 publish');
        return { count: 0, succeeded: 0, askPublished: false };
    }

    const shareCode = appStore.getState().userData?.shareCode;
    if (!shareCode) {
        console.warn('[ExportSegments] No shareCode, aborting R2 publish');
        return { count: 0, succeeded: 0, askPublished: false };
    }

    // `segments` is the range list captured by processVideo; the recap's overlay
    // options ride along as array properties so the re-render fallback can match
    // the trimmed clips when the trim path is unavailable.
    const overlayVariant = segments?.overlayVariant || 'fluency';
    const shareCta = segments?.shareCta || null;

    // Only publish the user's own webcam responses. `remote` steps are
    // system/model prompt clips — never user-generated.
    const publishable = (segments || [])
        .filter(({ step }) => isPublishableClip(step))
        .map(({ step, startSec, endSec }) => ({ ...step, rangeStartSec: startSec, rangeEndSec: endSec }));

    if (publishable.length === 0) {
        console.log('[ExportSegments] No publishable segments');
        trackEvent('publish_clips_batch_done', { lessonId, count: 0, succeeded: 0 });
        return { count: 0, succeeded: 0, askPublished: false };
    }

    trackEvent('publish_clips_batch_start', { lessonId });

    const snapshot = appStore.getState();
    const courseId = snapshot.courseId;
    const fluencyData = snapshot.successFluencyData;

    // Which lesson each segment publishes under, numbered per target. Ask steps
    // embedded in an answer lesson carry `publishLessonId` so their clips land
    // under the ask lesson (where a friend's 'b' lesson fetches them).
    const targets = assignSegmentTargets(publishable, lessonId);

    // Lazy fallback context — only built if a trim fails (no WebCodecs, or an
    // unreadable source range). The re-render path is the pre-existing one.
    let fallback = null;
    const getFallback = async () => {
        if (fallback) return fallback;
        const audioContext = getOrCreateExportAudioContext();
        const video = getOrCreateExportVideoElement();
        const profileImage = await loadProfileImage();
        const overlayImage = new Image();
        const storeState = appStore.getState();
        const lang = resolveConfigLanguage(storeState.guestNativeLanguage, storeState.userData?.native_language);
        overlayImage.src = resolveHeaderImage(lang);
        fallback = { audioContext, video, profileImage, overlayImage };
        return fallback;
    };

    const renderFallbackSegment = async (step) => {
        const { audioContext, video, profileImage, overlayImage } = await getFallback();
        const url = URL.createObjectURL(step.blob);
        video.src = url;
        await new Promise((res) => {
            video.onloadedmetadata = res;
            setTimeout(res, 2000);
        });
        const dims = new VideoRenderPlanner().getTargetDimensions(
            video.videoWidth || 1080, video.videoHeight || 1920
        );
        const canvas = getOrCreateExportVideoCanvas(dims.width, dims.height);
        URL.revokeObjectURL(url);
        const rendered = await renderStepToBlob({
            step, video, canvas, overlayImage, profileImage, fluencyData, audioContext,
            overlayVariant, shareCta,
        });
        return transcodeToMp4WithFallback(rendered.blob);
    };

    let askPublished = false;
    let succeeded = 0;
    for (let i = 0; i < publishable.length; i++) {
        const step = publishable[i];

        // 1) Primary: trim the step's range out of the stitched recording.
        // 2) Fallback: re-render the step (no WebCodecs, or trim failure).
        let mp4 = null;
        let path = null;
        if (stitchedBlob) {
            try {
                mp4 = await transcodeRangeToMp4(stitchedBlob, step.rangeStartSec, step.rangeEndSec);
                path = 'trim';
            } catch (e) {
                console.warn('[ExportSegments] trim failed; falling back to re-render:', e?.message || e);
            }
        }
        if (!mp4) {
            try {
                const rendered = await renderFallbackSegment(step);
                mp4 = rendered.mp4;
                path = rendered.path;
            } catch (e) {
                console.error('[ExportSegments] fallback render failed:', e);
            }
        }

        if (!mp4) {
            trackEvent('publish_clips_segment_failed', { lessonId, index: i, error: 'transcode' });
            continue;
        }

        // 3) Upload to R2. The key's lesson id is the step's publish target
        // (`publishLessonId` or the exported lesson) and the number restarts per
        // target, so clips land where a friend's lesson looks for them. Also
        // upload the sibling jpg thumb generated from the raw webcam blob.
        const { lessonId: targetLessonId, index: segmentIndex } = targets[i];
        const key = buildUgcSegmentKey({ shareCode, courseId, lessonId: targetLessonId, index: segmentIndex });
        const thumbKey = getUgcThumbKey(key);
        const thumbBlob = step.thumbBlob || null;
        try {
            const jwt = (await getAccessToken()) || '';
            const results = await Promise.allSettled([
                uploadSegmentToR2({ blob: mp4, key, jwt, shareCode, contentType: 'video/mp4' }),
                thumbBlob ? uploadSegmentToR2({ blob: thumbBlob, key: thumbKey, jwt, shareCode, contentType: 'image/jpeg' }) : Promise.resolve({ url: null }),
            ]);
            const videoRes = results[0];
            const thumbRes = results[1];
            if (videoRes.status === 'rejected') throw videoRes.reason;
            if (thumbRes.status === 'rejected') {
                console.warn('[ExportSegments] thumb upload failed (non-fatal):', thumbRes.reason);
            }
            trackEvent('publish_clips_segment_success', { lessonId, targetLessonId, index: segmentIndex, path, url: videoRes.value?.url });
            if (targetLessonId !== lessonId) askPublished = true;
            succeeded++;
        } catch (e) {
            console.error('[ExportSegments] R2 upload failed:', e);
            trackEvent('publish_clips_segment_failed', { lessonId, index: i, error: 'upload' });
        }
    }

    // Assign the lesson poster as the profile picture when the user has none.
    // The same bytes as the R2 sibling .jpg, copied into the persistent avatars
    // bucket (R2 videos/ has a 48h TTL). Fire-and-forget: a slow or failed
    // avatar upload must never delay or fail the publish.
    maybeAssignPosterAvatar({
        publishable,
        succeeded,
        userData: appStore.getState().userData,
    }).catch((e) => console.error('[ExportSegments] poster→avatar failed (non-fatal):', e));

    trackEvent('publish_clips_batch_done', { lessonId, count: publishable.length, succeeded, askPublished });

    // Clear the post-login pending publish so a refresh doesn't re-trigger.
    appStore.getState().setPendingPublishLessonId?.(null);

    return { count: publishable.length, succeeded, askPublished };
}

// Shared with functions/api/upload-segment.js (single source of truth). The
// Function rejects any object over this size with a 413, so the client checks
// first and skips the request rather than sending one that is guaranteed to fail.
export { MAX_R2_UPLOAD_BYTES };

// Uploads the concatenated end-of-lesson recap to R2 under the same `videos/`
// namespace as the per-segment clips, so it inherits the 48h lifecycle. Key:
// the complete-video key from video-url.js (never "concatenated").
//
// Best-effort: never throws, and skips the request when the transcoded blob
// exceeds the Function's 50 MB cap. A failure here must never fail the publish
// or the recap UI.
export async function uploadCompleteVideoToR2(blob, lessonId) {
    if (!blob) {
        console.log('[CompleteVideo] skipped — no blob');
        return { uploaded: false, reason: 'no-blob' };
    }
    if (!appStore.getState().isLoggedIn) {
        console.warn('[CompleteVideo] Not logged in, skipping complete-video upload');
        return { uploaded: false, reason: 'not-logged-in' };
    }

    const { userData, courseId } = appStore.getState();
    const shareCode = userData?.shareCode;
    const key = getCompleteVideoKey({ shareCode, courseId, lessonId });
    if (!key) {
        console.warn('[CompleteVideo] Missing shareCode/courseId/lessonId, skipping upload');
        return { uploaded: false, reason: 'missing-key-parts' };
    }

    // Uploads an already-mp4 blob under the complete key, after the size gate.
    const uploadMp4 = async (mp4) => {
        if (mp4.size > MAX_R2_UPLOAD_BYTES) {
            console.warn('[CompleteVideo] over 50 MB cap, skipping upload:', mp4.size);
            trackEvent('publish_complete_video_skipped', { lessonId, bytes: mp4.size });
            return { uploaded: false, reason: 'too-large' };
        }
        const jwt = (await getAccessToken()) || '';
        const { url } = await uploadSegmentToR2({ blob: mp4, key, jwt, shareCode, contentType: 'video/mp4' });
        trackEvent('publish_complete_video_success', { lessonId, url });
        console.log('[CompleteVideo] uploaded', key, '→', url);
        return { uploaded: true, url };
    };

    try {
        // The recap may be WebM (iOS/older browsers); R2 only accepts .mp4.
        // Shared WebCodecs → Cloudinary fallback (same as the per-segment path).
        const { mp4 } = await transcodeToMp4WithFallback(blob);
        if (!mp4) {
            trackEvent('publish_complete_video_failed', { lessonId });
            return { uploaded: false, reason: 'error' };
        }
        return await uploadMp4(mp4);
    } catch (e) {
        console.error('[CompleteVideo] upload failed (non-fatal):', e);
        trackEvent('publish_complete_video_failed', { lessonId });
        return { uploaded: false, reason: 'error' };
    }
}
