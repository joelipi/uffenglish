// Where an incorrect answer sends the learner back.
//
// Most steps retry straight on the recording screen: the learner is already
// framed and only the words were wrong. A `friendClosedResponse` step is
// different (stories/092): every attempt goes through the decision screen's
// Continue button, and that decision screen is only supposed to appear AFTER
// the clip has finished playing.
//
// So a retry replays the step's clip and lets the existing end-of-clip
// transition raise the decision screen. Returning the DECISION phase directly
// put the gradient overlay on top of a clip that was still playing.
//
// Pure and store-free so the rule is unit-testable.

import { isPreviewGateStep } from '../looks/recording-looks-logic.js';
import { interactivePlaybackPhase } from './step-phase-logic.js';

/** The plain recording screen — the retry destination for every other step. */
export const MIC_RETRY_PHASE = 'recording/answering';

/**
 * @param {object} step the config step that was just answered incorrectly
 * @returns {string} the phase to enter for the next attempt
 */
export function resolveRetryPhase(step) {
    // Only the preview-gated (friendClosedResponse) step has a Continue screen;
    // everything else keeps its existing retry.
    if (!isPreviewGateStep(step)) return MIC_RETRY_PHASE;
    // The decision screen is raised by the clip's own end-of-playback
    // transition, so the retry replays the clip rather than jumping to it. A
    // video-less response step (the closing lesson's) has no clip to replay and
    // already opens on the preview screen.
    if (step.simpleVideoUrl) return 'simpleVideo';
    if (step.interactiveVideoUrl) return interactivePlaybackPhase(step.responseType);
    return MIC_RETRY_PHASE;
}
