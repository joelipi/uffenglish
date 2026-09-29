// src/modules/lesson/recordable-phases.js
// Single source of truth for the phases that mount a mic-initiating control.
// Recording may only enter recording/answering from these; onRecordingStart
// fires after the mic stream is live, so any other phase (or a failed
// getUserMedia) must be left intact.

export const RECORDABLE_PHASES = [
    'simpleVideo',
    'simpleVideo-decisionTime-response',
    'firstResponse',
    'interactiveVideo-decisionTime-closedResponse',
    'interactiveVideo-decisionTime-openResponse',
    'interactiveVideo-decisionTime-friendClosedResponse',
];

export function isRecordablePhase(phase) {
    return RECORDABLE_PHASES.includes(phase);
}
