// Recovery after a capture that produced no usable audio.
//
// The original field bug (stories/087-no-audio-capture) left the learner on the
// "transcribing" phase with a flat waveform and a message that could not be
// acted on: `processing/transcribing` sets `bottomState: 'hidden'`, so no mic
// button was mounted. Recovery therefore has to do two things — clear the dead
// take and put the recording UI back.
//
// Pure and store-injected so both branches (`onNoAudioCaptured` and the
// empty-transcript `onStopEarly`) are unit-testable without mounting the lesson.

export const NO_AUDIO_MESSAGE_TYPE = 'no-audio';

/**
 * Return to the recording phase that mounts the mic button.
 *
 * Guarded because the callers can already be in this phase: `transitionTo`
 * only *warns* on an unexpected transition, and that warning would be noise
 * (and a false alarm in the phase-transition guards).
 */
export function returnToRecordingPhase(store) {
    if (store.getState().appPhase === 'recording/answering') return false;
    store.getState().transitionTo('recording/answering');
    return true;
}

/**
 * Produce the no-audio recovery state: no stale waveform, no silent replay, a
 * localized explanation, and the mic back. Deliberately does NOT touch the
 * score — an input that delivered no frames is a device/settings problem, not
 * a bad answer.
 */
export function applyNoAudioRecovery(store, { text } = {}) {
    const state = store.getState();
    state.setMicActive(false);
    state.clearRecordedAudioPeaks();
    state.clearPlaybackBlob();
    state.setMediaVisible(true);
    state.setSystemMessage({ type: NO_AUDIO_MESSAGE_TYPE, text: text ?? '' });
    returnToRecordingPhase(store);
}
