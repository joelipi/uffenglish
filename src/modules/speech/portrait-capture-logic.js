// Pure logic for the 9:16 portrait-capture composite in speech.web.js.
//
// Every decision rule that can be tested without a browser lives here so that
// speech.web.js stays a thin browser adapter. NO React, NO DOM, NO browser
// globals — vitest (jsdom) imports this module directly.
//
// See stories/072-fix-frozen-speech-capture/story.md.

export const COMPOSITE_STALL_MS = 2000;
export const COMPOSITE_FROZEN_MS = 3000;
export const COMPOSITE_WATCHDOG_MS = 1000;

export function resolveCompositeDimensions({ isAndroid, isIOS = false }) {
    // Every phone/tablet gets the light composite. The 1080×1920 canvas used to
    // be the "desktop" size, but an iPad composite painter is just as
    // constrained as an Android one: painting 2.25× the pixels per frame is how
    // the recorded picture fell behind the live microphone (A/V drift), and a
    // 720p canvas cuts that work by more than half while keeping the same 9:16
    // framing.
    const light = isAndroid === true || isIOS === true;
    return {
        width: light ? 720 : 1080,
        height: light ? 1280 : 1920,
        fps: light ? 24 : 30,
    };
}

/**
 * Whether this display tick should repaint the composite canvas.
 *
 * The recorded take's video is the composite canvas, and `captureStream`
 * timestamps a frame when the canvas is painted. Repainting on every display
 * tick (a 120 Hz iPad paints twice for every 24 fps camera frame) does not make
 * the picture any fresher — the source only has a new frame when it has one —
 * but it does spend main-thread time that the encoder and the camera pipeline
 * need, and that is what lets the recorded picture fall behind the live
 * microphone. With `requestVideoFrameCallback` a paint is due only when the
 * source signals a new frame; without it, every tick paints (the old path).
 *
 * @param {{ hasFrameCallback?: boolean, framePending?: boolean }} [input]
 * @returns {boolean}
 */
export function shouldPaintCompositeFrame({ hasFrameCallback = false, framePending = false } = {}) {
    if (!hasFrameCallback) return true;
    return framePending === true;
}

export function compositeCropRect({ videoWidth, videoHeight, canvasWidth, canvasHeight }) {
    if (!Number.isFinite(videoWidth) || videoWidth <= 0) return null;
    if (!Number.isFinite(videoHeight) || videoHeight <= 0) return null;
    if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) return null;
    if (!Number.isFinite(canvasHeight) || canvasHeight <= 0) return null;
    const canvasAspect = canvasWidth / canvasHeight;
    const videoAspect = videoWidth / videoHeight;
    if (videoAspect > canvasAspect) {
        const sh = videoHeight;
        const sw = videoHeight * canvasAspect;
        return { sx: (videoWidth - sw) / 2, sy: 0, sw, sh };
    }
    const sw = videoWidth;
    const sh = videoWidth / canvasAspect;
    return { sx: 0, sy: (videoHeight - sh) / 2, sw, sh };
}

export function paintCompositeFrame({ ctx, video, rect, canvasWidth, canvasHeight }) {
    if (rect === null) return false;
    try {
        ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, canvasWidth, canvasHeight);
        return true;
    } catch (e) {
        return false;
    }
}

export function createLivenessCounter() {
    let framesDrawn = 0;
    let sourceAdvances = 0;
    return {
        recordPaint() { framesDrawn += 1; },
        recordSourceAdvance() { sourceAdvances += 1; },
        snapshot() { return { framesDrawn, sourceAdvances }; },
        reset() { framesDrawn = 0; sourceAdvances = 0; },
    };
}

export function shouldForceReleaseComposite({ isAndroid, isIOS = false, keepStreamAlive, recordingStarted }) {
    if (keepStreamAlive === false) return true;
    if ((isAndroid || isIOS) && recordingStarted) return true;
    return false;
}

/**
 * Sync the `<video id="webcam-preview">` element with the active capture
 * stream and its visibility (`show`).
 *
 * When `setWebcamStream(stream)` runs inside `startSpeechCamRecording`, the
 * phase is still the pre-recording phase (`show === false`, wrapper has
 * `d-none`). On iOS WebKit, `<video autoPlay>` does not start while an
 * ancestor is `display: none`, so `video.play()` must be triggered once `show`
 * becomes `true` (`mediaState === 'webcamOrAvatar'`). Calling `play()` only
 * when `show` is `true` also keeps it out of the lesson-video phases.
 */
export function syncWebcamPreviewElement(video, stream, show) {
    if (!video) return;
    if (!stream) {
        video.pause();
        video.srcObject = null;
        return;
    }
    if (video.srcObject !== stream) {
        video.srcObject = stream;
    }
    if (show) {
        const playResult = video.play();
        if (playResult && typeof playResult.catch === 'function') {
            playResult.catch((e) => console.warn('[Webcam] play failed:', e));
        }
    }
}

export function isTakeFrozen({ framesDrawn, sourceAdvances, baselineFramesDrawn, baselineSourceAdvances, nowMs, recordingStartedAtMs }) {
    if (recordingStartedAtMs === null || recordingStartedAtMs === undefined) return false;
    if (framesDrawn !== baselineFramesDrawn) return false;
    if (sourceAdvances !== baselineSourceAdvances) return false;
    return (nowMs - recordingStartedAtMs) >= COMPOSITE_FROZEN_MS;
}

export function createFreezeReporter(deps) {
    const { snapshotCounter, nowMs, getMeta, getMessage, onConsoleError, onTrackEvent, onUserMessage } = deps;
    let armed = false;
    let startedAtMs = 0;
    let baseline = { framesDrawn: 0, sourceAdvances: 0 };
    let didReport = false;

    return {
        start() {
            armed = true;
            startedAtMs = nowMs();
            baseline = snapshotCounter();
            didReport = false;
        },
        tick() {
            if (!armed || didReport) return false;
            const snap = snapshotCounter();
            const frozen = isTakeFrozen({
                framesDrawn: snap.framesDrawn,
                sourceAdvances: snap.sourceAdvances,
                baselineFramesDrawn: baseline.framesDrawn,
                baselineSourceAdvances: baseline.sourceAdvances,
                nowMs: nowMs(),
                recordingStartedAtMs: startedAtMs,
            });
            if (!frozen) return false;
            didReport = true;
            const meta = getMeta();
            const elapsedMs = nowMs() - startedAtMs;
            onConsoleError('[Recording] take produced no camera frames — the clip will be frozen', {
                framesDrawn: snap.framesDrawn,
                sourceAdvances: snap.sourceAdvances,
                elapsedMs,
            });
            onTrackEvent('camera_frozen', {
                lessonId: meta.lessonId,
                stepIndex: meta.stepIndex,
                responseType: meta.responseType,
                elapsedMs,
            });
            onUserMessage(getMessage());
            return true;
        },
        reset() {
            armed = false;
            didReport = false;
        },
        didReport() {
            return didReport;
        },
    };
}

export function resolveCompositeWatchdog(snapshot) {
    const { hasEverHadMetadata, readyState, paused, ended, lastSourceAdvanceAtMs, nowMs } = snapshot;
    if (hasEverHadMetadata === false) return 'wait';
    if (paused && !ended && readyState >= 2) return 'resume';
    if (lastSourceAdvanceAtMs !== null && lastSourceAdvanceAtMs !== undefined && (nowMs - lastSourceAdvanceAtMs) >= COMPOSITE_STALL_MS) return 'resume';
    if (hasEverHadMetadata && readyState < 2) return 'resume';
    return 'idle';
}

// ---------------------------------------------------------------------------
// Recording looks (stories/091): `?beauty=` and `?overlay=`.
//
// Deliberately tracker-free. A beauty pass is a lighting/soft-focus recipe and a
// prop is a stationary PNG the learner frames themselves, so the whole feature is
// Canvas2D paint over the frame already being recorded: no model, no WebGL
// context, no per-frame inference — i.e. none of the low-memory-Android risk the
// parked Jeeliz spike (stories/090) carried.
// ---------------------------------------------------------------------------

export const BEAUTY_MODES = ['none', 'soft', 'glow', 'warm'];
export const OVERLAY_MODES = ['none', 'hat', 'desk', 'frame'];

/**
 * Which lever each look pulls, all 0..1 and all no-ops at 0:
 * - softFocus: downscale/upscale blend over the sharp frame (blemish softening)
 * - fillLight: screen-composited radial light above frame centre (kills the
 *   under-eye / nose shadows that read as tired)
 * - warmth: low-alpha warm screen lift
 * - vignette: gentle multiply at the edges so the room reads less
 */
export const BEAUTY_PRESETS = {
    none: { softFocus: 0, frost: 0, fillLight: 0, warmth: 0, vignette: 0 },
    soft: { softFocus: 0.45, frost: 0, fillLight: 0.12, warmth: 0.06, vignette: 0.10 },
    glow: { softFocus: 0.30, frost: 0, fillLight: 0.24, warmth: 0.10, vignette: 0.14 },
    warm: { softFocus: 0.14, frost: 0, fillLight: 0.10, warmth: 0.26, vignette: 0.08 },
    // Lens effects (stories/092): their own category, independent of the filter
    // presets above, so a learner can combine a grade with either of these.
    // Same levers, no new painters and no face tracking: the effect is centred
    // on the assumed face zone of the fixed 9:16 frame.
    //   softFocus  — a strong bloom over the whole frame, dreamy edges.
    //   chiaroscuro — a lit centre with the surround falling into shadow.
    lensSoftFocus: { softFocus: 0.62, frost: 0, fillLight: 0.14, warmth: 0.04, vignette: 0 },
    lensChiaroscuro: { softFocus: 0.06, frost: 0, fillLight: 0.34, warmth: 0.18, vignette: 0.78 },
    // Close-up: a frosted pane around the sharp oval — the soft-focus pass at
    // full strength plus a white veil over it (both cut around the same
    // `hole`), so what is behind the glass is still there but indistinct.
    lensCloseUp: { softFocus: 0.95, frost: 0.55, fillLight: 0, warmth: 0, vignette: 0 },
};

/** Placement is a rule, not baked pixel math: top / bottom / full cover-fit. */
export const OVERLAY_PLACEMENTS = {
    hat: 'top',
    desk: 'bottom',
    frame: 'full',
};

export const SOFT_FOCUS_DOWNSCALE = 12;

function readParam(search, name) {
    if (typeof search !== 'string' || search === '') return null;
    const query = search[0] === '?' ? search.slice(1) : search;
    try {
        const value = new URLSearchParams(query).get(name);
        return value === null ? null : String(value).toLowerCase();
    } catch (e) {
        return null;
    }
}

function resolveMode(search, name, allowed) {
    const value = readParam(search, name);
    if (!value || value === 'none') return 'none';
    return allowed.includes(value) ? value : 'none';
}

export function resolveBeautyModeFromSearch(search) {
    return resolveMode(search, 'beauty', BEAUTY_MODES);
}

export function resolveOverlayModeFromSearch(search) {
    return resolveMode(search, 'overlay', OVERLAY_MODES);
}

/**
 * iOS keeps the raw camera stream (its MediaRecorder path is fragile and
 * working) — but a look can only be baked into the take through the composite
 * canvas, so an active look opts iOS into it. No look → today's rule, exactly.
 */
export function shouldCompositeForLook({ isIOS = false, lookActive = false, beautyMode = 'none', overlayMode = 'none' } = {}) {
    if (lookActive || beautyMode !== 'none' || overlayMode !== 'none') return true;
    return !isIOS;
}

/**
 * Destination rect for a stationary prop. Aspect ratio is always preserved, and
 * `top`/`bottom` span the full canvas width (the art is authored at canvas width;
 * a taller-than-canvas image is clamped so it can never overflow).
 */
export function resolveOverlayDestRect({ imageWidth, imageHeight, canvasWidth, canvasHeight, placement }) {
    if (!Number.isFinite(imageWidth) || imageWidth <= 0) return null;
    if (!Number.isFinite(imageHeight) || imageHeight <= 0) return null;
    if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) return null;
    if (!Number.isFinite(canvasHeight) || canvasHeight <= 0) return null;

    if (placement === 'full') {
        const scale = Math.max(canvasWidth / imageWidth, canvasHeight / imageHeight);
        const dw = imageWidth * scale;
        const dh = imageHeight * scale;
        return {
            dx: Math.round((canvasWidth - dw) / 2),
            dy: Math.round((canvasHeight - dh) / 2),
            dw: Math.round(dw),
            dh: Math.round(dh),
        };
    }

    const scale = canvasWidth / imageWidth;
    const dh = Math.min(Math.round(imageHeight * scale), canvasHeight);
    if (placement === 'bottom') {
        return { dx: 0, dy: canvasHeight - dh, dw: Math.round(canvasWidth), dh };
    }
    // 'top' is the default anchor.
    return { dx: 0, dy: 0, dw: Math.round(canvasWidth), dh };
}

/**
 * Soften the frame by resampling it into a small scratch canvas and blending it
 * back at `strength`. Same downscale/upscale technique as the blur filter, which
 * is why it costs two drawImage calls and needs no shader.
 */
/** Fraction of the oval radius that stays fully sharp before the fade starts. */
export const CLOSE_UP_FEATHER_START = 0.84;

/** The oval's pixel bounding box, clamped to the frame. */
export function resolveCloseUpBox({ hole, canvasWidth, canvasHeight }) {
    if (!hole) return null;
    const x = Math.max(0, Math.round(hole.cx - hole.rx));
    const y = Math.max(0, Math.round(hole.cy - hole.ry));
    const w = Math.min(canvasWidth - x, Math.round(hole.rx * 2));
    const h = Math.min(canvasHeight - y, Math.round(hole.ry * 2));
    if (!(w > 1) || !(h > 1)) return null;
    return { x, y, w, h };
}

/**
 * Snapshot the oval's region BEFORE the blur is painted and give it a feathered
 * elliptical alpha mask (opaque centre, transparent rim). Drawing that layer
 * back over the blurred frame is what makes the close-up lens fade into the
 * frost instead of being cut out of it with a crisp edge.
 */
export function prepareCloseUpMask({ source, maskCanvas, hole, canvasWidth, canvasHeight }) {
    if (!source || !maskCanvas || !hole) return false;
    const box = resolveCloseUpBox({ hole, canvasWidth, canvasHeight });
    if (!box) return false;
    try {
        if (maskCanvas.width !== box.w) maskCanvas.width = box.w;
        if (maskCanvas.height !== box.h) maskCanvas.height = box.h;
        const mctx = maskCanvas.getContext('2d');
        if (!mctx) return false;
        mctx.globalCompositeOperation = 'source-over';
        mctx.clearRect(0, 0, box.w, box.h);
        mctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
        // `destination-in` multiplies the copied pixels' alpha by the gradient's,
        // so the rim fades to nothing and the layer has no hard edge.
        const lcx = hole.cx - box.x;
        const lcy = hole.cy - box.y;
        const verticalScale = hole.ry / hole.rx;
        mctx.globalCompositeOperation = 'destination-in';
        mctx.save();
        mctx.translate(lcx, lcy);
        mctx.scale(1, verticalScale);
        const gradient = mctx.createRadialGradient(0, 0, hole.rx * CLOSE_UP_FEATHER_START, 0, 0, hole.rx);
        gradient.addColorStop(0, 'rgba(0,0,0,1)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        mctx.fillStyle = gradient;
        mctx.fillRect(-lcx, -lcy / verticalScale, box.w, box.h / verticalScale);
        mctx.restore();
        mctx.globalCompositeOperation = 'source-over';
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Bleed the sharpest texture out of the frame for a soft-focus look.
 *
 * `sourceDraw(ctx, width, height)` is an optional cheaper way to obtain the
 * frame at a small size. The recording composite paints the camera into the
 * canvas it is about to read back; on a phone/tablet that readback is the most
 * expensive part of the pass, and the same pixels can be drawn straight from
 * the camera <video> into the scratch. Callers that only have a canvas (the
 * tests, the look preview) omit it.
 */
export function paintSoftFocus({ ctx, source, scratch, canvasWidth, canvasHeight, strength, sourceDraw = null }) {
    if (!ctx || (!source && typeof sourceDraw !== 'function') || !scratch) return false;
    if (!(strength > 0)) return false;
    const sw = Math.max(1, Math.round(canvasWidth / SOFT_FOCUS_DOWNSCALE));
    const sh = Math.max(1, Math.round(canvasHeight / SOFT_FOCUS_DOWNSCALE));
    try {
        if (scratch.width !== sw) scratch.width = sw;
        if (scratch.height !== sh) scratch.height = sh;
        const sctx = scratch.getContext('2d');
        if (!sctx) return false;
        sctx.imageSmoothingEnabled = true;
        if (typeof sourceDraw === 'function') sourceDraw(sctx, sw, sh);
        else sctx.drawImage(source, 0, 0, canvasWidth, canvasHeight, 0, 0, sw, sh);
        ctx.save();
        ctx.globalAlpha = Math.min(1, Math.max(0, strength));
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(scratch, 0, 0, sw, sh, 0, 0, canvasWidth, canvasHeight);
        ctx.restore();
        return true;
    } catch (e) {
        return false;
    }
}

/** Draw the masked sharp region back over the blurred/frosted frame. */
export function paintCloseUpSharp({ ctx, maskCanvas, hole, canvasWidth, canvasHeight }) {
    if (!ctx || !maskCanvas || !hole) return false;
    const box = resolveCloseUpBox({ hole, canvasWidth, canvasHeight });
    if (!box) return false;
    if (!(maskCanvas.width > 0) || !(maskCanvas.height > 0)) return false;
    try {
        ctx.drawImage(maskCanvas, box.x, box.y);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * White frost over the frame. Sits on top of the blur: the shapes behind it
 * stay visible, but as a frosted pane rather than a smeared one. The close-up
 * lens then draws its masked sharp region back over this, so the frost only
 * survives outside that fade.
 */
export function paintFrost({ ctx, canvasWidth, canvasHeight, alpha }) {
    if (!ctx) return false;
    if (!(alpha > 0)) return false;
    try {
        ctx.save();
        ctx.fillStyle = 'rgb(255, 255, 255)';
        ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.restore();
        return true;
    } catch (e) {
        return false;
    }
}

/** Screen-composited radial light above frame centre. */
export function paintFillLight({ ctx, canvasWidth, canvasHeight, strength }) {
    if (!ctx || !(strength > 0)) return false;
    try {
        const cx = canvasWidth / 2;
        const cy = canvasHeight * 0.38;
        const radius = Math.max(canvasWidth, canvasHeight) * 0.6;
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, 'rgba(255, 246, 232, 1)');
        gradient.addColorStop(0.55, 'rgba(255, 240, 220, 0.45)');
        gradient.addColorStop(1, 'rgba(255, 235, 210, 0)');
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = Math.min(1, Math.max(0, strength));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.restore();
        return true;
    } catch (e) {
        return false;
    }
}

/** Warm screen lift + edge vignette. */
export function paintTone({ ctx, canvasWidth, canvasHeight, warmth, vignette }) {
    if (!ctx) return false;
    let painted = false;
    try {
        if (warmth > 0) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = Math.min(1, Math.max(0, warmth));
            ctx.fillStyle = 'rgb(255, 196, 138)';
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            ctx.restore();
            painted = true;
        }
        if (vignette > 0) {
            const cx = canvasWidth / 2;
            const cy = canvasHeight / 2;
            const inner = Math.min(canvasWidth, canvasHeight) * 0.45;
            const outer = Math.max(canvasWidth, canvasHeight) * 0.78;
            const gradient = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
            gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
            ctx.save();
            ctx.globalCompositeOperation = 'multiply';
            ctx.globalAlpha = Math.min(1, Math.max(0, vignette));
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            ctx.restore();
            painted = true;
        }
        return painted;
    } catch (e) {
        return false;
    }
}

/**
 * The whole look, in a fixed order: soften, then light, then tone. Returns the
 * mode that was actually painted ('none' for an unknown mode or a painter that
 * threw), so the adapter can log it.
 */
export function paintBeautyPass({
    ctx,
    source,
    scratch,
    maskCanvas = null,
    canvasWidth,
    canvasHeight,
    mode,
    hole = null,
    sourceDraw = null,
}) {
    const preset = BEAUTY_PRESETS[mode];
    if (!preset || mode === 'none') return 'none';
    const painted = [];
    // Snapshot the sharp oval FIRST: after the blur is painted there is nothing
    // sharp left to restore.
    if (hole && maskCanvas) {
        painted.push(prepareCloseUpMask({ source, maskCanvas, hole, canvasWidth, canvasHeight }));
    }
    painted.push(paintSoftFocus({ ctx, source, scratch, canvasWidth, canvasHeight, strength: preset.softFocus, sourceDraw }));
    painted.push(paintFrost({ ctx, canvasWidth, canvasHeight, alpha: preset.frost }));
    if (hole && maskCanvas) {
        painted.push(paintCloseUpSharp({ ctx, maskCanvas, hole, canvasWidth, canvasHeight }));
    }
    painted.push(paintFillLight({ ctx, canvasWidth, canvasHeight, strength: preset.fillLight }));
    painted.push(paintTone({ ctx, canvasWidth, canvasHeight, warmth: preset.warmth, vignette: preset.vignette }));
    return painted.some(Boolean) ? mode : 'none';
}

/** A stationary prop: one drawImage, no tracking, no drift. */
export function paintStationaryOverlay({ ctx, image, imageWidth, imageHeight, canvasWidth, canvasHeight, placement }) {
    if (!ctx || !image) return false;
    const rect = resolveOverlayDestRect({ imageWidth, imageHeight, canvasWidth, canvasHeight, placement });
    if (!rect) return false;
    try {
        ctx.drawImage(image, rect.dx, rect.dy, rect.dw, rect.dh);
        return true;
    } catch (e) {
        return false;
    }
}