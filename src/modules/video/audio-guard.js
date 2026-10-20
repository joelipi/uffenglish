// Browser adapter that keeps a lesson video audible for the first seconds of
// playback, and leaves a trace of the audio state when it cannot.
//
// The Android-only "video starts silent" bug (see
// stories/075-fix-android-silent-video-start/story.md) is output-level, so the
// app cannot always see the cause. What the app CAN see is whether the element
// ended up muted — and that it can repair. The guard also logs the audio state
// so the next field report names the mechanism instead of starting another
// round of theories.
//
// The rules live in audio-playback-logic.js (pure, unit-tested); this module is
// the thin timer around them.

import {
    AUDIO_GUARD_INTERVAL_MS,
    AUDIO_GUARD_WINDOW_MS,
    describeAudioState,
    isAudible,
    recoverAudio,
    shouldRepairAudio,
} from './audio-playback-logic.js';

/**
 * Create an audio guard for one media element.
 *
 * @param {object} deps
 * @param {() => (HTMLMediaElement|null)} deps.getElement  the element to watch
 * @param {() => boolean} [deps.isExpectedAudible]          false while the
 *        user muted the clip on purpose (the guard must not fight that)
 * @param {() => void} [deps.play]                          re-issues playback
 * @param {(msg: string, detail?: object) => void} [deps.log]
 * @param {number} [deps.intervalMs]
 * @param {number} [deps.windowMs]
 * @param {() => number} [deps.now]
 * @param {typeof setInterval} [deps.setTimer]
 * @param {typeof clearInterval} [deps.clearTimer]
 * @returns {{ start: () => void, stop: () => void, isRunning: () => boolean }}
 */
export function createAudioGuard({
    getElement,
    isExpectedAudible = () => true,
    play,
    log = (msg, detail) => console.log(msg, detail ?? ''),
    intervalMs = AUDIO_GUARD_INTERVAL_MS,
    windowMs = AUDIO_GUARD_WINDOW_MS,
    now = () => Date.now(),
    setTimer = setInterval,
    clearTimer = clearInterval,
} = {}) {
    let timer = null;
    let startedAt = 0;
    // Whether the element was audible at the previous tick. The "lost its
    // audio" line is logged on the transition only, so a clip that stays
    // muted produces one diagnosis line, not one per tick.
    let wasAudible = true;

    const isRunning = () => timer !== null;

    const stop = () => {
        if (timer !== null) {
            clearTimer(timer);
            timer = null;
        }
    };

    const tick = () => {
        const element = getElement ? getElement() : null;
        if (!element) {
            return;
        }

        const elapsedMs = now() - startedAt;

        // The window closes first: past it the guard neither repairs nor
        // logs, and it disarms itself so it cannot keep a clip unmuted for
        // the whole playback.
        if (elapsedMs > windowMs) {
            stop();
            log('[AudioGuard] audio state at ' + elapsedMs + 'ms', describeAudioState(element));
            return;
        }

        const expectedAudible = isExpectedAudible();
        if (!expectedAudible) {
            return;
        }

        const audible = isAudible(element);

        if (shouldRepairAudio({
            playing: element.paused !== true,
            expectedAudible,
            audible,
            elapsedMs,
            windowMs,
        })) {
            if (wasAudible) {
                log('[AudioGuard] muted during playback at ' + elapsedMs + 'ms', describeAudioState(element));
            }
            const repaired = recoverAudio(element, play);
            if (repaired && wasAudible) {
                log('[AudioGuard] repaired muted audio at ' + elapsedMs + 'ms');
            }
            wasAudible = repaired;
            return;
        }

        wasAudible = audible;
    };

    const start = () => {
        stop();
        startedAt = now();
        wasAudible = true;
        timer = setTimer(tick, intervalMs);
    };

    return { start, stop, isRunning };
}
