// Pure logic for keeping a lesson video audible.
//
// A lesson video that starts playing silently is an Android-only field bug
// (stories/075-fix-android-silent-video-start/story.md). The symptom is
// output-level, so the app cannot always see the cause — but it CAN see
// whether the element ended up muted, and it can repair that. Every rule that
// can be tested without a browser lives here so the players stay thin adapters.
//
// NO React, NO DOM, NO browser globals — vitest (jsdom) imports this module
// directly. The single exception is `recoverAudio`, which touches the element
// it is handed; it is isolated and tested behind a fake, exactly like
// `paintCompositeFrame` in portrait-capture-logic.js.

/** How often the audio guard samples the element while playback is running. */
export const AUDIO_GUARD_INTERVAL_MS = 200;

/**
 * How long after playback starts the guard keeps watching. The field report
 * describes a one-to-two second gap, so five seconds comfortably covers it
 * while keeping the guard's lifetime short.
 */
export const AUDIO_GUARD_WINDOW_MS = 5000;

/**
 * A media element is audible only when it is not muted and its volume is not
 * zero. A muted element plays its video frames but emits no sound, which is
 * exactly the shape of the field bug.
 */
export function isAudible(element) {
    if (!element) return false;
    const muted = element.muted === true;
    const volume = typeof element.volume === 'number' ? element.volume : 1;
    return !muted && volume > 0;
}

/**
 * Decide whether the guard should try to restore the audio.
 *
 * The guard repairs only when the element is *playing*, is *supposed to be
 * audible*, is *not audible*, and is still inside the guard period. A paused
 * element is silent by definition and must not be touched.
 */
export function shouldRepairAudio({
    playing,
    expectedAudible,
    audible,
    elapsedMs,
    windowMs = AUDIO_GUARD_WINDOW_MS,
}) {
    if (!playing) return false;
    if (!expectedAudible) return false;
    if (audible) return false;
    if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs)) return false;
    if (elapsedMs < 0 || elapsedMs > windowMs) return false;
    return true;
}

/**
 * Restore audibility on a media element that lost it.
 *
 * Clearing `muted` is not enough on its own: a browser that muted the element
 * may have already torn the audio output down, so the playback is re-issued
 * as well — a fresh `play()` is what makes the browser re-open the audio
 * output. Returns whether the element is audible afterwards.
 */
export function recoverAudio(element, play) {
    if (!element) return false;

    try {
        element.muted = false;
    } catch (e) {
        // A media element that refuses the write cannot be repaired.
        return false;
    }

    try {
        element.volume = 1;
    } catch (e) {
        // Volume is advisory: a successful unmute is worth keeping even when
        // the volume write fails.
        console.warn('[AudioGuard] Could not restore volume:', e);
    }

    try {
        if (typeof play === 'function') play();
    } catch (e) {
        // play() is best effort — a rejected promise is handled by the caller.
        console.warn('[AudioGuard] Could not re-issue play():', e);
    }

    return isAudible(element);
}

/**
 * A one-line summary of an element's audio state, for the field log. This is
 * what separates "the element was muted" from "the audio data never arrived"
 * (or "the browser/OS muted the output") in a bug report.
 */
export function describeAudioState(element) {
    if (!element) {
        return { muted: null, volume: null, paused: null, readyState: null, audioBytes: null };
    }
    return {
        muted: element.muted === true,
        volume: typeof element.volume === 'number' ? element.volume : null,
        paused: element.paused === true,
        readyState: typeof element.readyState === 'number' ? element.readyState : null,
        audioBytes: typeof element.webkitAudioDecodedByteCount === 'number'
            ? element.webkitAudioDecodedByteCount
            : null,
    };
}
