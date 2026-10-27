// Pure rules for STARTING the recorded take's playback.
//
// The take is the learner's own clip (PlaybackVideo), handed over right after the
// capture is released and while the step is already transcribing. It is meant to
// play on its own: audible for its first run, then looping silently
// (stories/075-fix-android-silent-video-start owns the audio contract).
//
// iPadOS Safari is the fragile case (stories/094-fix-ipad-recorded-take-autoplay):
//
//   1. An unmuted `play()` is refused (`NotAllowedError`) unless it runs in the
//      same task as a gesture. Our start runs from a media event, so on iPad the
//      muted fallback is not a fallback — it is the only path that ever works.
//   2. Muted inline playback is only allowed when the element carries the
//      `muted` ATTRIBUTE. A React `muted={...}` prop is a property write only,
//      so the attribute has to be set explicitly.
//   3. Some WebKit builds return `undefined` from `play()`. A direct
//      `video.play().catch(...)` then throws inside the event handler and the
//      start never happens — hence `playSafely`.
//
// NO React, NO DOM lookups, NO browser globals: the two element-touching helpers
// (`playSafely`, `setElementMuted`) work on the element they are handed, exactly
// like `recoverAudio` in audio-playback-logic.js.

/**
 * The start ladder. The first entry is the immediate attempt (audible); each
 * later entry is a delayed retry, started muted. A short ladder is deliberate:
 * the learner is watching a still frame, so an attempt that cannot work must
 * hand over to a tap quickly rather than keep the page busy.
 */
export const PLAYBACK_START_RETRY_DELAYS_MS = [0, 250, 750, 2000];

/** The key an unhandled/synchronous autoplay refusal is reported under. */
export const AUTOPLAY_ERROR_NAMES = ['NotAllowedError', 'AbortError'];

/**
 * The first attempt asks for sound on browsers that allow it; every retry
 * starts muted. On iPad/iPhone the unmuted start is always refused, so the
 * component asks for a muted start from the first attempt there
 * (`preferMutedStart`), then re-opens the audio after it is really playing. A
 * learner who muted the clip themselves is muted from the first attempt.
 *
 * @param {{ attempt?: number, muteIntent?: boolean, preferMutedStart?: boolean }} [input]
 * @returns {boolean}
 */
export function shouldStartMuted({ attempt = 0, muteIntent = false, preferMutedStart = false } = {}) {
    if (muteIntent === true) return true;
    if (preferMutedStart === true) return true;
    return Number(attempt) > 0;
}

/**
 * Whether a refused attempt is worth retrying. Retrying the same refusal forever
 * keeps the page scheduling timers while the learner stares at a still frame, so
 * the ladder is finite and only covers refusals a muted retry can actually fix
 * (or an error the browser did not name).
 *
 * @param {{ attempt?: number, errorName?: string|null, delays?: number[] }} [input]
 * @returns {boolean}
 */
export function shouldRetryStart({
    attempt = 0,
    errorName = null,
    delays = PLAYBACK_START_RETRY_DELAYS_MS,
} = {}) {
    if (!Number.isInteger(attempt) || attempt < 0) return false;
    if (attempt + 1 >= delays.length) return false;
    if (errorName === null || errorName === undefined || errorName === '') return true;
    return AUTOPLAY_ERROR_NAMES.includes(errorName);
}

/**
 * The delay before the next attempt, or null when the ladder is exhausted.
 *
 * @param {number} attempt the attempt that just failed
 * @param {number[]} [delays]
 * @returns {number|null}
 */
export function retryDelayMs(attempt, delays = PLAYBACK_START_RETRY_DELAYS_MS) {
    if (!Number.isInteger(attempt) || attempt < 0) return null;
    const next = attempt + 1;
    if (next >= delays.length) return null;
    return delays[next];
}

/**
 * Start the take by itself only while it is paused, only when the step asked for
 * autoplay, and only before it has ever started. A clip the learner paused after
 * it played is theirs to resume, so a late `canplay` must not restart it.
 *
 * @param {{ paused?: boolean, hasStarted?: boolean, autoplay?: boolean }} [input]
 * @returns {boolean}
 */
export function shouldAttemptStart({ paused = false, hasStarted = false, autoplay = false } = {}) {
    if (autoplay !== true) return false;
    if (paused !== true) return false;
    return hasStarted !== true;
}

/**
 * The viewport observer may pause a clip that has already started (it played,
 * then scrolled away). Before the first start it must NOT: on iPad the observer
 * can report not-intersecting while the layout is still settling, and pausing
 * the take that was just started leaves the static frame the bug report
 * describes — with nothing left to resume it.
 *
 * @param {{ isIntersecting?: boolean, hasStarted?: boolean }} [input]
 * @returns {boolean}
 */
export function shouldPauseOffscreen({ isIntersecting = true, hasStarted = false } = {}) {
    if (isIntersecting === true) return false;
    return hasStarted === true;
}

/**
 * What a tap on the take means. A paused clip (autoplay refused, or the learner
 * paused it) must START on a tap: the whole 9:16 frame is the tap target, and a
 * tap that only flips the sound leaves the learner looking at a still image. Only
 * a playing clip toggles its sound.
 *
 * @param {{ paused?: boolean, muted?: boolean }} [input]
 * @returns {'play'|'unmute'|'mute'}
 */
export function resolveTapAction({ paused = false, muted = false } = {}) {
    if (paused === true) return 'play';
    if (muted === true) return 'unmute';
    return 'mute';
}

/**
 * Call `play()` without assuming its return shape. WebKit can return
 * `undefined`, and a direct `.catch` on that throws inside the handler that
 * started playback — which is how the take ended up frozen on its first frame.
 *
 * @param {HTMLMediaElement|null|undefined} element
 * @returns {{ promise: Promise<any>|null, error: Error|null }}
 */
export function playSafely(element) {
    if (!element || typeof element.play !== 'function') {
        return { promise: null, error: null };
    }
    try {
        const result = element.play();
        if (result && typeof result.then === 'function') {
            return { promise: result, error: null };
        }
        return { promise: null, error: null };
    } catch (error) {
        return { promise: null, error };
    }
}

/**
 * Set the element's mute state in the shape the browser actually honours.
 * Safari's muted-inline-autoplay allowance reads the `muted` ATTRIBUTE, so the
 * property write alone is not enough; `defaultMuted` keeps the attribute and the
 * property in step. Returns whether the element ends up muted as asked.
 *
 * @param {HTMLMediaElement|null|undefined} element
 * @param {boolean} muted
 * @returns {boolean}
 */
export function setElementMuted(element, muted) {
    if (!element) return false;
    const next = muted === true;
    try {
        element.muted = next;
    } catch (error) {
        return false;
    }
    try {
        element.defaultMuted = next;
        if (typeof element.setAttribute === 'function' && typeof element.removeAttribute === 'function') {
            if (next) element.setAttribute('muted', '');
            else element.removeAttribute('muted');
        }
    } catch (error) {
        // The property write is what playback honours; a missing attribute API
        // (a test fake, an exotic element) must not fail the mute itself.
        console.warn('[Playback] could not mirror the muted attribute:', error && error.message ? error.message : error);
    }
    return element.muted === next;
}

/**
 * A one-line description of an element for the field log: what the start path
 * saw when it gave up is the only way the next iPad report names the mechanism.
 *
 * @param {HTMLMediaElement|null|undefined} element
 * @returns {object}
 */
export function describeStartState(element) {
    if (!element) return { paused: null, readyState: null, muted: null, ended: null, networkState: null };
    return {
        paused: element.paused === true,
        readyState: typeof element.readyState === 'number' ? element.readyState : null,
        muted: element.muted === true,
        ended: element.ended === true,
        networkState: typeof element.networkState === 'number' ? element.networkState : null,
    };
}

/**
 * What the take actually CONTAINS, as opposed to whether the start worked.
 *
 * A started take that still looks like a still frame has three shapes, and they
 * need different fixes: an audio-only recording (`videoWidth === 0`), a
 * recording whose video track carries one frozen frame (frames decode but the
 * picture never moves), or a file the device decodes but does not present. The
 * size/type of the recorded blob separates an encoder problem (video/mp4 from
 * iPadOS) from a container problem, so log both together.
 *
 * @param {HTMLMediaElement|null|undefined} element
 * @param {Blob|null|undefined} blob
 * @returns {object}
 */
export function describeTakeMedia(element, blob) {
    const videoWidth = typeof element?.videoWidth === 'number' ? element.videoWidth : null;
    const duration = element && typeof element.duration === 'number' && Number.isFinite(element.duration)
        ? Number(element.duration.toFixed(2))
        : null;
    return {
        videoWidth,
        videoHeight: typeof element?.videoHeight === 'number' ? element.videoHeight : null,
        hasVideoTrack: videoWidth === null ? null : videoWidth > 0,
        duration,
        blobSize: typeof blob?.size === 'number' ? blob.size : null,
        blobType: typeof blob?.type === 'string' ? blob.type : null,
    };
}

/**
 * How many frames the element has actually decoded, for the sample taken a
 * moment after playback started. A started take that has decoded 0 frames is a
 * decode/codec problem; one that decoded frames is a presentation problem (or a
 * recording that captured a single frame).
 *
 * @param {HTMLMediaElement|null|undefined} element
 * @returns {{decodedFrames: number|null, currentTime: number|null, videoWidth: number|null}}
 */
export function describePlaybackSample(element) {
    if (!element) return { decodedFrames: null, currentTime: null, videoWidth: null };
    let decodedFrames = null;
    try {
        if (typeof element.getVideoPlaybackQuality === 'function') {
            const quality = element.getVideoPlaybackQuality();
            if (quality && typeof quality.totalVideoFrames === 'number') decodedFrames = quality.totalVideoFrames;
        }
    } catch (error) {
        decodedFrames = null;
    }
    if (decodedFrames === null && typeof element.webkitDecodedFrameCount === 'number') {
        decodedFrames = element.webkitDecodedFrameCount;
    }
    return {
        decodedFrames,
        currentTime: typeof element.currentTime === 'number' ? Number(element.currentTime.toFixed(2)) : null,
        videoWidth: typeof element.videoWidth === 'number' ? element.videoWidth : null,
    };
}

// --- A take that starts but never advances (stories/094) ---------------------
//
// The iPad field log shows the element reporting `paused:false` and
// `readyState:4` while `currentTime` is still ~0 s more than a second after the
// `playing` event — a stalled renderer, not a frozen recording (the file decodes
// frames and the camera probe passes). Two rules cover it:
//
//   * do not ask a not-yet-ready element to play (WebKit can accept the call and
//     then sit at HAVE_NOTHING forever, which is how a take ends up on a still
//     frame with `paused:false`), and
//   * if a started element's clock has not moved after a short grace period,
//     kick it once by re-issuing playback.

/** Retry interval while waiting for the element to become ready. */
export const PLAYBACK_READINESS_RETRY_MS = 300;

/** Give up waiting for readiness after this long (the learner can tap instead). */
export const PLAYBACK_READINESS_MAX_WAIT_MS = 4000;

/**
 * How long a take may sit paused (or stalled) before it has ever played before
 * the start path restarts it. The start must not depend on one more media event
 * arriving: an element the browser paused after the muted start never fires one
 * again, and the take stays on its first frame (the field report where the take
 * only played when `?diag=1` changed the timing).
 */
export const PLAYBACK_START_WATCHDOG_MS = 400;


/** How long after `playing` the clock is checked for movement. */
export const PLAYBACK_STALL_CHECK_MS = 700;

/** Less than this much progress means the renderer is stalled. */
export const PLAYBACK_STALL_MIN_ADVANCE_S = 0.05;

/**
 * A media element is ready to start at HAVE_CURRENT_DATA (2) or better. Asking
 * for playback earlier is what leaves WebKit at `paused:false` with a frozen
 * first frame.
 *
 * @param {number} [readyState]
 * @returns {boolean}
 */
export function shouldWaitForReadiness(readyState) {
    if (!Number.isFinite(readyState)) return true;
    return readyState < 2;
}

/**
 * Should playback be kicked (pause + play) because the clock never moved?
 *
 * @param {{ paused?: boolean, currentTime?: number, elapsedSinceStartMs?: number,
 *           checkAfterMs?: number, minAdvanceS?: number }} [input]
 * @returns {boolean}
 */
export function shouldKickStalledPlayback({
    paused,
    currentTime,
    elapsedSinceStartMs,
    checkAfterMs = PLAYBACK_STALL_CHECK_MS,
    minAdvanceS = PLAYBACK_STALL_MIN_ADVANCE_S,
} = {}) {
    if (paused !== false) return false;
    if (!Number.isFinite(currentTime)) return false;
    if (!Number.isFinite(elapsedSinceStartMs)) return false;
    if (elapsedSinceStartMs < checkAfterMs) return false;
    return currentTime < minAdvanceS;
}

// --- A take the element left unplayed before it ever started -----------------
//
// The `playing` event is the only confirmation that a start really happened, and
// the start path used to treat "play() resolved" as good enough. On a device the
// element can be left PAUSED (or `paused:false` with a clock that never moves)
// without ever firing `playing`: that is the field report where the recorded
// take never played, and the take only played with `?diag=1` because the panel's
// extra work happened to make another readiness event arrive after the element
// paused. A readiness event is a coincidence, not a recovery — the start path
// has to look at the element and restart it.

/**
 * What the start watchdog should do about a take that has not started yet:
 *
 *   * `'restart'` — the element is paused. Ask it to play again (this is the
 *     shape the field log shows: a start succeeded, then the element paused and
 *     nothing was left to resume it).
 *   * `'kick'` — `paused:false` but the clock did not move since the previous
 *     look: the renderer is stalled, so pause and re-issue playback (the same
 *     repair as `shouldKickStalledPlayback`, but before the first `playing`).
 *   * `'none'` — leave it alone (not an autoplay step, already started, the
 *     ladder gave up, past the maximum wait, or nothing observed yet).
 *
 * `settled` is the outcome the start path is actually after, not just a flag: the
 * take has played WITH SOUND (or the learner asked for silence). `playing` alone
 * is not enough — the muted lead-in is still open when it fires, so a take the
 * browser pauses or leaves muted during the hand-off must still be repaired.
 *
 * @param {{ paused?: boolean, movedS?: number|null, settled?: boolean,
 *           autoplay?: boolean, gaveUp?: boolean, waitedMs?: number,
 *           maxWaitMs?: number, minAdvanceS?: number }} [input]
 * @returns {'restart'|'kick'|'none'}
 */
export function resolveStartRecovery({
    paused,
    movedS = null,
    settled = false,
    autoplay = false,
    gaveUp = false,
    waitedMs = 0,
    maxWaitMs = PLAYBACK_READINESS_MAX_WAIT_MS,
    minAdvanceS = PLAYBACK_STALL_MIN_ADVANCE_S,
} = {}) {
    if (autoplay !== true) return 'none';
    if (settled === true) return 'none';
    if (gaveUp === true) return 'none';
    if (!Number.isFinite(waitedMs) || waitedMs > maxWaitMs) return 'none';
    if (paused === true) return 'restart';
    // Nothing to compare against on the first look: record and look again.
    if (!Number.isFinite(movedS)) return 'none';
    return movedS < minAdvanceS ? 'kick' : 'none';
}
