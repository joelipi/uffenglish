// modules/video-processor.web.js
// Web-only module — uses navigator.userAgent, window.preloadedMedia, MediaRecorder.
// React Native replaces this with video-processor.native.js.
import { getAllSpeechRecordingsForLesson } from '../storage/storage.js';
import { shareVideo } from './video-share.js';
import { appStore } from '../store/store.js';
import headerImg from '../../assets/img/header.png';
import { getVideoUrl, getUgcThumbKey } from './video-url.js';
import { VideoRenderPlanner, TEXT_MODE_DURATION_MS, buildShareUrl, buildShareDeadline, resolveOverlayElements, isShareCtaEnabled, isDroppedStep, markFirstRenderable } from './video-processor-logic.js';
import { remoteSource } from './video-source.js';
import { DEFAULT_USER_AVATAR_URL } from '../user/tutor-config.js';
import { getAvatarBlobUrl } from '../avatar/avatar.service.js';
import { supabase, getAccessToken } from '../api/supabase.js';
import { transcodeToMp4, verifyMp4, uploadWebmToCloudinary } from './transcode.js';
import { uploadSegmentToR2 } from './r2-upload.js';
import { trackEvent } from '../utils/posthog.js';
import Strings from '../../data/strings.js';

export { shareVideo };

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
                overlayImage.src = headerImg;

                // Probe dimensions from the first real recording blob
                const firstValidRec = recordings.find(r => r.blob);
                if (firstValidRec) {
                    originalVideo.src = URL.createObjectURL(firstValidRec.blob);
                    await new Promise(res => {
                        originalVideo.onloadedmetadata = res;
                        setTimeout(res, 2000);
                    });
                }

                const configData = appStore.getState().configData || {};
                const userLang = appStore.getState().userData?.native_language;
                const shareCode = appStore.getState().userData?.shareCode || null;
                const planner = new VideoRenderPlanner(recordings, configData, fluencyData, userLang, shareCode);
                const plan = planner.generatePlan();

                // The lesson's recapOverlay mode decides the card: shareCta
                // recaps carry a share CTA instead of a fluency card. With no
                // shareCode the CTA still renders, using the bare host as the URL.
                const tailingStep = plan.find(s => s.type === 'tailing');
                const overlayVariant = tailingStep?.variant || 'fluency';
                const shareCta = isShareCtaEnabled(overlayVariant)
                    ? {
                        headline: Strings.get('share_cta_headline', userLang),
                        deadlinePrefix: Strings.get('share_cta_deadline', userLang),
                        deadline: buildShareDeadline(Date.now(), userLang),
                        url: buildShareUrl(shareCode),
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

                recorder.ondataavailable = e => {
                    if (e.data.size > 0) chunks.push(e.data);
                };

                recorder.onstop = () => {
                    const blob = new Blob(chunks, { type: mimeType });
                    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
                    cleanup();
                    resolve({ blob, ext });
                };

                recorder.start(1000);

                await executeRenderLoop(
                    plan, originalVideo, videoCanvas, displayCanvas,
                    overlayImage, profileImage, fluencyData,
                    id => { animationId = id; },
                    audioContext, audioDestination,
                    { overlayVariant, shareCta }
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
async function executeRenderLoop(plan, video, canvas, displayCanvas, overlayImage, profileImage, fluencyData, setAnimationId, audioContext, audioDestination, { silent = false, overlayVariant = 'fluency', shareCta = null } = {}) {
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

            if (overlayImage?.complete && overlayImage.naturalWidth > 0) {
                const x = (canvas.width - overlayImage.naturalWidth) / 2;
                ctx.drawImage(overlayImage, x, 0);
            }

            drawTextOverlay(
                ctx, canvas.width, canvas.height,
                isTailing, tailStart, fluencyData,
                step.isFirst, step.subtitle, displayCanvas,
                overlayVariant, shareCta
            );

            if (displayCanvas) {
                const dCtx = displayCanvas.getContext('2d');
                dCtx.drawImage(canvas, 0, 0, displayCanvas.width, displayCanvas.height);
            }

            let shouldAdvance = false;
            if (isTailing) {
                if (performance.now() - tailStart > 4000) finish();
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
                    const rawDuration = video.duration;
                    // A non-finite duration would disable both the end check and
                    // the stall fallback; fall back to the recorded clip length,
                    // or a hard cap, so the segment can never freeze forever.
                    const endTime = step.trim?.end
                        || (Number.isFinite(rawDuration) ? rawDuration : (step.duration || 60));

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
                    const plannedMs = (endTime - (step.trim?.start || 0)) * 1000;
                    const stalledTimeout =
                        stepPlayStart && plannedMs > 0 &&
                        performance.now() - stepPlayStart > plannedMs + 2000;
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
                // nextStep() swaps the element, and the same plan objects are
                // shared with the concurrent R2 export (renderStepToBlob spreads
                // the step). Mutating them drops clips from the recap/export.
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
function wrapText(context, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let line = '';

    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        if (context.measureText(testLine).width > maxWidth && n > 0) {
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
 * maxWidth. Never wraps — used for the share URL and deadline, which must stay
 * on one line.
 */
function drawFittedLine(context, text, centerX, y, { fontFamily, maxWidth, baseSize, minSize = 18, color = 'white' }) {
    let size = baseSize;
    context.font = `700 ${size}px ${fontFamily}`;
    // Measure the ink extent, not just the advance width: complex scripts
    // (e.g. Bengali) rendered through a fallback font can extend past the
    // reported advance, so a width-only fit under-shrinks and overflows the
    // frame. Take the larger of advance and bounding box.
    const inkWidth = (t) => {
        const m = context.measureText(t);
        const left = Math.abs(m.actualBoundingBoxLeft || 0);
        const right = Math.abs(m.actualBoundingBoxRight || 0);
        return Math.max(m.width || 0, left + right);
    };
    while (size > minSize && inkWidth(text) > maxWidth) {
        size -= 1;
        context.font = `700 ${size}px ${fontFamily}`;
    }
    context.fillStyle = color;
    context.strokeStyle = 'rgba(0,0,0,0.8)';
    context.lineWidth = Math.max(6, Math.round(size * 0.18));
    context.strokeText(text, centerX, y);
    context.fillText(text, centerX, y);
    return size;
}

function drawTextOverlay(context, canvasWidth, canvasHeight, tailing, tailStart, fluencyData, isFirst, subtitleText, displayCanvas, overlayVariant = 'fluency', shareCta = null) {
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

    // Share CTA — headline block in the top 25% for the whole recap, plus the
    // 3-line CTA card over the tailing freeze-frame. The URL is drawn with
    // drawFittedLine (never wrapText) so it always stays on one line.
    if (headlineBlock || tailingCard) {
        const centerX = Math.floor(canvasWidth / 2);
        const maxWidth = canvasWidth * 0.9;
        // Include Bengali-capable families so Bengali copy does not fall through
        // to an arbitrary system font with different metrics.
        const fontFamily = '"Plus Jakarta Sans", "Noto Sans Bengali", "Bangla Sangam MN", "Nirmala UI", sans-serif';

        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.shadowColor = 'rgba(0, 0, 0, 0.8)';
        context.shadowBlur = Math.max(8, Math.round(canvasWidth * 0.012));

        if (headlineBlock) {
            // Vertically centered within the top 25% band.
            const bandCenterY = canvasHeight * 0.125;
            const lineGap = Math.round(canvasHeight * 0.045);
            const headlineSize = drawFittedLine(context, shareCta.headline, centerX, bandCenterY - lineGap / 2, {
                fontFamily, maxWidth, baseSize: Math.round(canvasWidth * 0.055), color: 'white'
            });
            drawFittedLine(context, shareCta.url, centerX, bandCenterY + lineGap / 2, {
                fontFamily, maxWidth, baseSize: Math.round(headlineSize * 0.9), color: 'yellow'
            });
        }

        if (tailingCard) {
            const lineGap = Math.round(canvasHeight * 0.06);
            const centerY = canvasHeight * 0.5;
            const prefixSize = drawFittedLine(context, shareCta.deadlinePrefix, centerX, centerY - lineGap, {
                fontFamily, maxWidth, baseSize: Math.round(canvasWidth * 0.06), color: 'white'
            });
            drawFittedLine(context, shareCta.deadline, centerX, centerY, {
                fontFamily, maxWidth, baseSize: Math.round(prefixSize * 0.85), color: 'white'
            });
            drawFittedLine(context, shareCta.url, centerX, centerY + lineGap, {
                fontFamily, maxWidth, baseSize: Math.round(prefixSize * 0.95), color: 'yellow'
            });
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
        const totalEnHeight = enLines.length * enLineHeight;
        const totalTrHeight = trLines.length > 0
            ? gapBetween + trLines.length * trLineHeight
            : 0;
        const totalTextHeight = totalEnHeight + totalTrHeight;

        // Measure longest line across both English and translation
        let longestLineWidth = 0;
        context.font = `bold ${enFontSize}px "Plus Jakarta Sans", sans-serif`;
        enLines.forEach(l => {
            longestLineWidth = Math.max(longestLineWidth, context.measureText(l).width);
        });
        if (trLines.length > 0) {
            context.font = `${trFontSize}px "Plus Jakarta Sans", sans-serif`;
            trLines.forEach(l => {
                longestLineWidth = Math.max(longestLineWidth, context.measureText(l).width);
            });
        }

        const boxPadding = 10;

        // Match SimpleVideoPlayer's `bottom: 150px` clearance in real on-screen
        // pixels. The export canvas is scaled to the display canvas via CSS
        // (objectFit: contain), so `150` screen px must be converted into canvas
        // px using the actual draw scale. Without this, the margin shrinks with
        // the on-screen scale and the subtitles collide with the bottom buttons.
        const BOTTOM_OFFSET_PX = 150;
        let bottomMargin;
        if (displayCanvas && displayCanvas.getBoundingClientRect) {
            const rect = displayCanvas.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                const scale = Math.min(rect.width / canvasWidth, rect.height / canvasHeight);
                const drawnHeight = canvasHeight * scale; // on-screen bitmap height
                bottomMargin = BOTTOM_OFFSET_PX * (canvasHeight / drawnHeight);
            }
        }
        if (bottomMargin == null) {
            // Fallback (no display canvas measured yet): assume a 1920-tall frame.
            bottomMargin = canvasHeight * (BOTTOM_OFFSET_PX / 1920);
        }
        const blockBottomY = canvasHeight - bottomMargin;

        // Background box covering both English and translation lines
        context.fillStyle = 'rgba(0, 0, 0, 0.6)';
        context.fillRect(
            centerX - longestLineWidth / 2 - boxPadding,
            blockBottomY - totalTextHeight - boxPadding,
            longestLineWidth + boxPadding * 2,
            totalTextHeight + boxPadding * 2
        );

        context.fillStyle = 'white';
        context.shadowColor = 'black';
        context.shadowBlur = 4;

        // Draw from the bottom up so the block extends toward the top (matching
        // the SimpleVideoPlayer overlay, which grows upward from its anchor).
        let lineY = blockBottomY;
        if (trLines.length > 0) {
            context.font = `${trFontSize}px "Plus Jakarta Sans", sans-serif`;
            for (let i = trLines.length - 1; i >= 0; i--) {
                context.fillText(trLines[i], centerX, lineY);
                lineY -= trLineHeight;
            }
            lineY -= gapBetween;
        }
        context.font = `bold ${enFontSize}px "Plus Jakarta Sans", sans-serif`;
        for (let i = enLines.length - 1; i >= 0; i--) {
            context.fillText(enLines[i], centerX, lineY);
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

// Render a single plan step into a per-segment Blob by reusing executeRenderLoop
// with a single-step plan (isFirst:false) and the silent flag.
async function renderStepToBlob({ step, video, canvas, overlayImage, profileImage, fluencyData, audioContext }) {
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
            { silent: true }
        ).then(() => recorder.stop()).catch((e) => {
            try { recorder.stop(); } catch {}
            reject(e);
        });
    });
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    return { blob, ext };
}

export async function exportSegmentsToR2(lessonId) {
    if (!appStore.getState().isLoggedIn) {
        console.warn('[ExportSegments] Not logged in, aborting R2 publish');
        return;
    }

    const shareCode = appStore.getState().userData?.shareCode;
    if (!shareCode) {
        console.warn('[ExportSegments] No shareCode, aborting R2 publish');
        return;
    }

    trackEvent('publish_clips_batch_start', { lessonId });

    const recordings = await getAllSpeechRecordingsForLesson(lessonId) || [];
    const configData = appStore.getState().configData || {};
    const fluencyData = appStore.getState().successFluencyData;
    const userLang = appStore.getState().userData?.native_language;

    // No shareCode passed: only the tailing step consumes it, and tailing is
    // filtered out of the publishable set below.
    const planner = new VideoRenderPlanner(recordings, configData, fluencyData, userLang);
    const fullPlan = planner.generatePlan();
    // Only publish the user's own webcam responses. The `remote` steps are
    // system/model prompt clips — never user-generated, so we must not upload
    // them to the user's R2 namespace.
    const publishable = fullPlan.filter(s =>
        s.type === 'webcam' && s.blob && !s.isTextMode
    );

    if (publishable.length === 0) {
        console.log('[ExportSegments] No publishable segments');
        trackEvent('publish_clips_batch_done', { lessonId, count: 0, succeeded: 0 });
        return;
    }

    const audioContext = getOrCreateExportAudioContext();
    const video = getOrCreateExportVideoElement();
    const profileImage = await loadProfileImage();
    const overlayImage = new Image();
    overlayImage.src = headerImg;

    // Probe dimensions from the first webcam step (mirrors processVideo).
    const probeStep = publishable.find(s => s.type === 'webcam' && s.blob);
    if (probeStep) {
        video.src = URL.createObjectURL(probeStep.blob);
        await new Promise((res) => {
            video.onloadedmetadata = res;
            setTimeout(res, 2000);
        });
    }
    const dims = planner.getTargetDimensions(video.videoWidth || 1080, video.videoHeight || 1920);
    const videoCanvas = getOrCreateExportVideoCanvas(dims.width, dims.height);

    let succeeded = 0;
    for (let i = 0; i < publishable.length; i++) {
        const step = publishable[i];

        // 1) Render the step to a per-segment blob.
        let segBlob;
        try {
            const result = await renderStepToBlob({
                step, video, canvas: videoCanvas, overlayImage, profileImage, fluencyData, audioContext,
            });
            segBlob = result.blob;
        } catch (e) {
            console.error('[ExportSegments] renderStepToBlob failed:', e);
            trackEvent('publish_clips_segment_failed', { lessonId, index: i, error: 'render' });
            continue;
        }

        // 2) Transcode to mp4 (WebCodecs primary, Cloudinary fallback).
        let mp4 = null;
        let path = null;
        try {
            mp4 = await transcodeToMp4(segBlob);
            if (!await verifyMp4(mp4)) throw new Error('verify-failed');
            path = 'webcodecs';
        } catch (e) {
            if (e?.message === 'webcodecs-unavailable' || e?.message === 'verify-failed') {
                try {
                    mp4 = await uploadWebmToCloudinary(segBlob);
                    path = 'cloudinary';
                } catch (ce) {
                    console.error('[ExportSegments] Cloudinary fallback failed:', ce);
                }
            } else {
                console.error('[ExportSegments] transcodeToMp4 error:', e);
            }
        }

        if (!mp4) {
            trackEvent('publish_clips_segment_failed', { lessonId, index: i, error: 'transcode' });
            continue;
        }

        // 3) Upload to R2. Key includes the course id so each course's clips
        // are namespaced and won't collide across courses for the same user.
        // Also upload sibling jpg thumb derived from raw webcam blob (LQIP mandatory).
        const courseId = appStore.getState().courseId;
        const key = `videos/${shareCode}-${courseId}-${lessonId}-response-${String(i + 1).padStart(2, '0')}.mp4`;
        const thumbKey = getUgcThumbKey(key);
        let thumbBlob = step.thumbBlob || null;
        // thumb may be stored as ArrayBuffer sibling if restored from IDB; handle fallback
        if (!thumbBlob && step.thumbArrayBuffer) {
            try { thumbBlob = new Blob([step.thumbArrayBuffer], { type: 'image/jpeg' }); } catch {}
        }
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
            trackEvent('publish_clips_segment_success', { lessonId, index: i, path, url: videoRes.value?.url });
            succeeded++;
        } catch (e) {
            console.error('[ExportSegments] R2 upload failed:', e);
            trackEvent('publish_clips_segment_failed', { lessonId, index: i, error: 'upload' });
        }
    }

    trackEvent('publish_clips_batch_done', { lessonId, count: publishable.length, succeeded });

    // Clear the post-login pending publish so a refresh doesn't re-trigger.
    appStore.getState().setPendingPublishLessonId?.(null);
}
