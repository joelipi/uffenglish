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

export function resolveCompositeDimensions({ isAndroid }) {
    return {
        width: isAndroid ? 720 : 1080,
        height: isAndroid ? 1280 : 1920,
        fps: isAndroid ? 24 : 30,
    };
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

// ---------------------------------------------------------------------------
// Privacy filters (spike, stories/090): `?filter=blur` / `?filter=mask`.
//
// The recording canvas is the ONE frame the learner's clip is cut from, so the
// effect is painted between the camera frame and the capture stream — the
// recorded blob carries it with no change to the trim/concat/publish pipeline.
//
// Deliberately not `ctx.filter = 'blur(...)'`: Canvas2D filters are a silent
// no-op in iOS WebKit, so the blur is a downscale/upscale resample, which works
// on every browser and costs no shader.
// ---------------------------------------------------------------------------

export const RECORDING_FILTERS = ['none', 'blur', 'mask'];
export const FILTER_BLUR_DOWNSCALE = 16;
export const FACE_BOX_PADDING = 1.2;
export const FACE_DETECTED_THRESHOLD = 0.5;

/** `?filter=blur|mask` → mode. Anything else (absent, unknown) is 'none'. */
export function resolveFilterModeFromSearch(search) {
    if (typeof search !== 'string' || search === '') return 'none';
    const query = search[0] === '?' ? search.slice(1) : search;
    let value = null;
    try {
        value = new URLSearchParams(query).get('filter');
    } catch (e) {
        return 'none';
    }
    const mode = String(value || '').toLowerCase();
    return RECORDING_FILTERS.includes(mode) && mode !== 'none' ? mode : 'none';
}

/**
 * iOS keeps the raw camera stream (its MediaRecorder path is fragile and
 * working) unless a filter is on: the filter can only be painted into the
 * composite canvas, so a spike take opts iOS into it. No filter → today's rule.
 */
export function shouldUsePortraitComposite({ isIOS = false, filterMode = 'none' } = {}) {
    if (filterMode !== 'none') return true;
    return !isIOS;
}

/**
 * Jeeliz detectState → a pixel rect on the composite canvas.
 * `x`/`y` are in [-1, 1] with y measured from the BOTTOM; `s` is the square
 * detection frame's width as a fraction of the viewport width.
 */
export function faceBoxToCanvasRect(faceBox, canvasWidth, canvasHeight) {
    if (!faceBox || !Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight)) return null;
    const { x, y, s, detected } = faceBox;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(s)) return null;
    if (Number.isFinite(detected) && detected < FACE_DETECTED_THRESHOLD) return null;
    const cx = ((x + 1) / 2) * canvasWidth;
    const cy = ((1 - y) / 2) * canvasHeight;
    const size = Math.abs(s) * canvasWidth * FACE_BOX_PADDING;
    if (size <= 0) return null;
    return { rx: cx - size / 2, ry: cy - size / 2, rw: size, rh: size };
}

/**
 * Blur `region` (canvas pixels) by resampling through a tiny scratch canvas.
 * `source` is the composite canvas itself — the base camera frame is already
 * painted into it by the time this runs.
 */
export function paintBlurRegion({ ctx, source, region, scratch }) {
    if (!ctx || !source || !scratch || !region) return false;
    const rw = Math.max(1, Math.round(region.rw));
    const rh = Math.max(1, Math.round(region.rh));
    const sw = Math.max(1, Math.round(rw / FILTER_BLUR_DOWNSCALE));
    const sh = Math.max(1, Math.round(rh / FILTER_BLUR_DOWNSCALE));
    try {
        if (scratch.width !== sw) scratch.width = sw;
        if (scratch.height !== sh) scratch.height = sh;
        const sctx = scratch.getContext('2d');
        if (!sctx) return false;
        sctx.imageSmoothingEnabled = true;
        sctx.drawImage(source, region.rx, region.ry, rw, rh, 0, 0, sw, sh);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(scratch, 0, 0, sw, sh, region.rx, region.ry, rw, rh);
        return true;
    } catch (e) {
        return false;
    }
}

/** A flat carnival-mask shape over the face box — opaque enough to hide it. */
export function paintFaceMask({ ctx, box }) {
    if (!ctx || !box) return false;
    const { rx, ry, rw, rh } = box;
    if (!(rw > 0) || !(rh > 0)) return false;
    try {
        // Mask body: the upper two thirds of the detection box.
        const bodyH = rh * 0.62;
        ctx.save();
        ctx.fillStyle = '#12121a';
        ctx.beginPath();
        ctx.ellipse(rx + rw / 2, ry + bodyH / 2, rw / 2, bodyH / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        // Eye openings, so the mask reads as a mask rather than a censor bar.
        ctx.fillStyle = '#f5f5f5';
        const eyeW = rw * 0.26;
        const eyeH = bodyH * 0.26;
        const eyeY = ry + bodyH * 0.42;
        ctx.beginPath();
        ctx.ellipse(rx + rw * 0.29, eyeY, eyeW / 2, eyeH / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(rx + rw * 0.71, eyeY, eyeW / 2, eyeH / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Paint the active filter over the frame already drawn on the canvas.
 * Returns the effect that was actually painted ('none' when nothing applied —
 * no face yet, unknown mode, or a drawing failure), so the caller can log it.
 */
export function paintFilterEffect({ ctx, source, filterMode, faceBox, canvasWidth, canvasHeight, scratch }) {
    if (filterMode !== 'blur' && filterMode !== 'mask') return 'none';
    const box = faceBoxToCanvasRect(faceBox, canvasWidth, canvasHeight);
    if (filterMode === 'blur') {
        // A face-less frame falls back to a full-frame soft focus: the learner
        // asked for privacy, so never leave the raw frame visible.
        const region = box || { rx: 0, ry: 0, rw: canvasWidth, rh: canvasHeight };
        return paintBlurRegion({ ctx, source, region, scratch }) ? 'blur' : 'none';
    }
    return box && paintFaceMask({ ctx, box }) ? 'mask' : 'none';
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