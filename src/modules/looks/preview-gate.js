// The friend-closed-response preview gate.
//
// The step's Continue button opens the camera preview and the recorder then
// waits here until the learner taps the microphone — that is what replaces the
// 3-2-1 countdown on that step (stories/092). Pure promise plumbing: no DOM, no
// React, so the orchestrator can await it and the UI can resolve it.
//
// A resolve that arrives before anyone is waiting is remembered, so a fast tap
// can never deadlock the take; `resetPreviewGate()` clears that state when a new
// preview opens.

let resolver = null;
let resolvedEarly = false;

export function waitForPreviewStart() {
    if (resolvedEarly) {
        resolvedEarly = false;
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        resolver = resolve;
    });
}

export function startRecordingFromPreview() {
    if (resolver) {
        const resolve = resolver;
        resolver = null;
        resolve();
        return true;
    }
    resolvedEarly = true;
    return false;
}

export function resetPreviewGate() {
    resolver = null;
    resolvedEarly = false;
}

export function isPreviewGateWaiting() {
    return resolver !== null;
}
