// src/modules/speech/rerecord-logic.js
// Decision for the Whisper review "record again" (✕) button.
//
// Rejecting a transcript must behave exactly like a first mic press: one tap
// re-enters the recording path — camera preview → 3-2-1 countdown → take.
// Historically reject only called the `onTranscriptRejected` UI hook, which
// parked the learner on an *idle* `recording/answering` screen (no countdown,
// no rolling take), so they had to press the mic a second time.
//
// Pure module: no React, no DOM, no store. The orchestrator owns the take and
// asks this module whether the take can be re-entered right now.

export const RERECORD_DECISIONS = {
    restart: 'restart',
    alreadyRecording: 'already-recording',
    transitioning: 'transitioning',
};

// listeningActive — a take is still rolling in the orchestrator. Re-entering
//   `toggleSpeechRecognition` would run its STOP branch and immediately abort
//   the very take the learner is trying to redo.
// transitioning  — the orchestrator's own start/stop mutex is still held (its
//   `finally` has not released it yet), so a re-entry would be refused anyway.
//   A real review tap lands in a later task and never hits this; the guard is
//   there so the refusal is explicit and loggable instead of a silent no-op.
//
// Both gates are defence in depth: the shipped UI cannot show the ✕ while a
// take is rolling (in `review` the bottom band shows the review buttons, not the
// mic) nor while the mutex is held. They become reachable if a future UI keeps
// the mic mounted behind the review overlay.
export function decideRerecordAction({ listeningActive = false, transitioning = false } = {}) {
    if (listeningActive) {
        return { restart: false, decision: RERECORD_DECISIONS.alreadyRecording };
    }
    if (transitioning) {
        return { restart: false, decision: RERECORD_DECISIONS.transitioning };
    }
    return { restart: true, decision: RERECORD_DECISIONS.restart };
}
