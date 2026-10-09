// modules/speech/hesitation-logic.js
// Whether the live 100 ms hesitation timer is worth running for a step.
//
// The timer only feeds the feedback/scoring UI: the flow score and the
// "hesitation" stat bubble. Friend-challenge (`shareCta`) lessons and their
// `friendClosedResponse` steps skip that UI entirely — the answer pipeline only
// builds feedback/scoring for closed/open responses — so the timer, its
// per-tick store writes and its console logging are pure overhead there.
// Skipping it removes a 10 Hz interval (and its allocation churn) from the
// recording path on the memory-constrained devices these lessons run on.
//
// Pure: no React, no DOM, no store — unit-testable in isolation.
export function shouldTrackHesitation({ responseType, recapOverlay } = {}) {
    if (recapOverlay === 'shareCta') return false;
    if (responseType === 'friendClosedResponse') return false;
    return true;
}
