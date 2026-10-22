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