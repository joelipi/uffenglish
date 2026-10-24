// Pure logic for releasing the camera/microphone capture around the playback
// of a freshly recorded clip.
//
// The Android-only "the clip starts silent / very quiet" bug
// (stories/075-fix-android-silent-video-start) has one app-level cause the app
// CAN control: on Android an open capture holds the device in a communication
// audio mode, and the media route then ducks (or mutes) whatever plays next.
// The capture used to be released only AFTER the clip had been handed to the
// player — and after the thumbnail generation and the database write, which
// together take long enough to cover the first second of the clip.
//
// These rules decide WHEN the capture must be closed and how long the audio
// route needs before the clip may start.
//
// NO React, NO DOM, NO browser globals — vitest (jsdom) imports this module
// directly. The only browser-ish thing here is the injected `sleep`, so the
// settle can be asserted without waiting in real time.

/**
 * How long the audio route needs after the capture is released before the
 * clip may start.
 *
 * Stopping the microphone track hands the device back from the communication
 * audio mode to the normal media mode, but the switch is not instantaneous:
 * the media AudioTrack created in the same tick can still be created on the
 * outgoing route and then be re-routed, which is what the learner hears as a
 * quiet or missing first second.
 *
 * The wait only happens when a capture was actually released, so the desktop
 * warm-up path (the capture stays alive) is not delayed at all.
 */
export const CAPTURE_RELEASE_SETTLE_MS = 500;

/**
 * Must the capture be closed BEFORE the clip is handed to the player?
 *
 * `releaseAfterRecording` is the answer to "is the capture closed when the
 * recording ends anyway?" (`shouldForceReleaseComposite`). When it is, the
 * release is moved earlier — before the hand-over — so the clip never plays
 * with an open capture behind it.
 *
 * @param {object} params
 * @param {boolean} params.releaseAfterRecording  the capture is closed at the
 *        end of the recording anyway (Android always; anywhere when the
 *        caller asked for a full teardown)
 * @param {boolean} params.playback              a clip is about to be played
 * @returns {boolean}
 */
export function shouldReleaseCaptureBeforePlayback({ releaseAfterRecording, playback }) {
    if (playback !== true) return false;
    return releaseAfterRecording === true;
}

/**
 * Wait for the audio route to settle after the capture was released.
 *
 * The sleep is injectable so the caller (and the tests) decide how the wait
 * is performed. A non-positive delay resolves immediately.
 *
 * @param {number} [delayMs]
 * @param {(ms: number) => Promise<void>} [sleep]
 * @returns {Promise<void>}
 */
export function waitForAudioRouteSettle(
    delayMs = CAPTURE_RELEASE_SETTLE_MS,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
    if (!(delayMs > 0)) return Promise.resolve();
    return Promise.resolve(sleep(delayMs));
}

/**
 * What the capture handed to MediaRecorder actually looks like.
 *
 * A take that plays as a still frame has a capture-side shape too: a video track
 * that is already `ended` (the recorder then writes an audio-only file), one
 * that is `muted` (the camera delivers no frames), or a live one whose settings
 * are not what the recorder expects. A RE-RECORD on iPadOS re-acquires the camera
 * after the previous capture was released, and that re-acquisition is the step
 * that differs between the first (working) take and the second (frozen) one — so
 * log the take index, the track states and the stream shape together.
 *
 * @param {MediaStream|null|undefined} stream
 * @param {{ take?: number, isComposite?: boolean, mimeType?: string|null }} [context]
 * @returns {object}
 */
export function describeCaptureStream(stream, { take = null, isComposite = false, mimeType = null } = {}) {
    const tracks = stream && typeof stream.getTracks === 'function' ? stream.getTracks() : [];
    const describe = (kind) => {
        const track = tracks.find((t) => t && t.kind === kind) || null;
        if (!track) return null;
        let settings = null;
        try {
            settings = typeof track.getSettings === 'function' ? track.getSettings() : null;
        } catch (error) {
            settings = null;
        }
        return {
            readyState: typeof track.readyState === 'string' ? track.readyState : null,
            enabled: track.enabled !== false,
            muted: track.muted === true,
            settings,
        };
    };
    return {
        take,
        mimeType,
        isComposite: isComposite === true,
        trackCount: tracks.length,
        video: describe('video'),
        audio: describe('audio'),
    };
}

/**
 * The recorded file as handed to the player, for the same field report.
 *
 * @param {Blob|null|undefined} blob
 * @param {{ take?: number, mimeType?: string|null }} [context]
 * @returns {object}
 */
export function describeRecordingBlob(blob, { take = null, mimeType = null } = {}) {
    return {
        take,
        mimeType,
        size: typeof blob?.size === 'number' ? blob.size : null,
        type: typeof blob?.type === 'string' ? blob.type : null,
    };
}

// --- Re-acquiring the camera for a re-record (stories/094) -------------------
//
// On iPadOS a re-record releases the previous capture and re-acquires the camera.
// The re-acquired stream can report a live, unmuted 30 fps track while delivering
// the SAME image for the whole take: MediaRecorder then encodes a valid file
// (frames decode, duration counts) whose picture never moves — the field symptom
// "the playback video is just a still image" on the SECOND take only.
//
// The composite path already has a liveness counter; iOS records the raw camera
// and had none. These rules decide when to wait after a release, how long to
// sample the camera before starting the take, and when a frozen camera is worth
// re-acquiring once.

/** How long the camera needs after its previous capture was stopped. */
export const CAPTURE_REACQUIRE_SETTLE_MS = 500;

/** How long the camera gets to deliver MOVING frames before the take starts. */
export const CAMERA_FRAME_PROBE_TIMEOUT_MS = 900;

/** How often the probe samples the camera's clock. */
export const CAMERA_FRAME_PROBE_SAMPLE_MS = 200;

/** One re-acquire is allowed: a second dead camera is the device, not a race. */
export const MAX_CAPTURE_PROBE_ATTEMPTS = 2;

/** A camera clock that moves less than this during the probe is frozen. */
export const CAMERA_FRAME_MIN_ADVANCE_S = 0.03;

/**
 * Did the camera's clock move between two samples?
 *
 * @param {{ firstCurrentTime?: number, secondCurrentTime?: number, minDeltaS?: number }} [input]
 * @returns {boolean}
 */
export function isCameraFrameAdvanced({
    firstCurrentTime,
    secondCurrentTime,
    minDeltaS = CAMERA_FRAME_MIN_ADVANCE_S,
} = {}) {
    if (!Number.isFinite(firstCurrentTime) || !Number.isFinite(secondCurrentTime)) return false;
    return secondCurrentTime - firstCurrentTime >= minDeltaS;
}

/**
 * Re-acquire the camera once when it delivered no moving frames. A camera that
 * is frozen because its previous capture is still shutting down recovers on the
 * retry; a device that is genuinely stuck does not, and the second attempt is
 * reported instead of retried forever.
 *
 * @param {{ attempt?: number, framesAdvanced?: boolean, attempts?: number }} [input]
 * @returns {boolean}
 */
export function shouldReacquireCapture({
    attempt = 0,
    framesAdvanced = false,
    attempts = MAX_CAPTURE_PROBE_ATTEMPTS,
} = {}) {
    if (framesAdvanced === true) return false;
    if (!Number.isInteger(attempt) || attempt < 0) return false;
    return attempt + 1 < attempts;
}

/**
 * How long to wait before re-acquiring the camera, given when the previous
 * capture was stopped. 0 when nothing was released or the settle already passed.
 *
 * @param {{ releasedAtMs?: number, nowMs?: number, settleMs?: number }} [input]
 * @returns {number}
 */
export function resolveCaptureReacquireDelay({
    releasedAtMs,
    nowMs,
    settleMs = CAPTURE_REACQUIRE_SETTLE_MS,
} = {}) {
    if (!Number.isFinite(releasedAtMs) || releasedAtMs <= 0) return 0;
    if (!Number.isFinite(nowMs)) return 0;
    if (!(settleMs > 0)) return 0;
    const elapsedMs = nowMs - releasedAtMs;
    if (elapsedMs < 0) return settleMs;
    if (elapsedMs >= settleMs) return 0;
    return settleMs - elapsedMs;
}

/**
 * Does this take need the camera frame probe?
 *
 * The probe costs an extra `<video>` consumer of the camera for ~400 ms, and it
 * exists for ONE failure: a re-record, where iPadOS re-acquires the camera after
 * the previous capture was released and can hand back a frozen feed. The first
 * take always uses a fresh camera and has never shown that failure, so it is left
 * as light as it was before the probe existed — the first take is also the
 * coldest one (camera acquisition + Whisper warm-up share the device).
 *
 * @param {{ takeIndex?: number, hasCompositeLiveness?: boolean, isPlaceholder?: boolean }} [input]
 * @returns {boolean}
 */
export function shouldProbeCamera({
    takeIndex = 0,
    hasCompositeLiveness = false,
    isPlaceholder = false,
} = {}) {
    if (hasCompositeLiveness === true) return false;
    if (isPlaceholder === true) return false;
    return Number(takeIndex) > 0;
}
