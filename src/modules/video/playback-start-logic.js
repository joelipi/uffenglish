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
 * The first attempt asks for sound; every retry starts muted. A learner who
 * muted the clip themselves is muted from the first attempt.
 *
 * @param {{ attempt?: number, muteIntent?: boolean }} [input]
 * @returns {boolean}
 */
export function shouldStartMuted({ attempt = 0, muteIntent = false } = {}) {
    if (muteIntent === true) return true;
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
