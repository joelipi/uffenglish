// Where an incorrect answer sends the learner back.
//
// Most steps retry straight on the recording screen: the learner is already
// framed and only the words were wrong. A `friendClosedResponse` step is
// different (stories/092): every attempt goes through the preview screen, which
// is entered from the decision screen's Continue button. Returning such a step
// to `recording/answering` skipped the Continue button and dropped the learner
// on the bare microphone again, so the retry lands on the decision screen and
// the two-step Continue → preview → microphone flow runs again.
//
// Pure and store-free so the rule is unit-testable.

import { isPreviewGateStep } from '../looks/recording-looks-logic.js';
import { interactiveDecisionPhase } from './step-phase-logic.js';

/** The plain recording screen — the retry destination for every other step. */
export const MIC_RETRY_PHASE = 'recording/answering';

/**
 * @param {object} step the config step that was just answered incorrectly
 * @returns {string} the phase to enter for the next attempt
 */
export function resolveRetryPhase(step) {
    // Only the preview-gated (friendClosedResponse) step has a Continue screen
    // to return to; everything else keeps its existing retry.
    if (!isPreviewGateStep(step)) return MIC_RETRY_PHASE;
    // The decision screen only exists when a clip precedes the response. A
    // video-less response step (the closing lesson's) has no decision overlay,
    // so it retries on the recording/preview screen as before.
    if (step.simpleVideoUrl) return 'simpleVideo-decisionTime-response';
    if (step.interactiveVideoUrl) return interactiveDecisionPhase(step.responseType);
    return MIC_RETRY_PHASE;
}
