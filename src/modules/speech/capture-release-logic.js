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
