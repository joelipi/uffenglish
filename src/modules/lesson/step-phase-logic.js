// modules/lesson/step-phase-logic.js
// Pure phase resolver for a loaded step. No React, no DOM, no store — so the
// branch order (lessonIntro → success → firstResponse chooser → interactive
// video → viewAndContinue → simpleVideo → recording) can be unit-tested in
// isolation.
//
// The only behaviour added by story 029: the first response step of a friend
// lesson skips the `firstResponse` mode chooser and falls through to its normal
// per-video phase (simpleVideo / interactiveVideo+<type> / recording), matching
// every later question.
//
// Story 054: a `branching` step plays its simple clip (simpleVideo) and, with
// no clip, resolves straight to the branch overlay phase. Branching is checked
// before the interactive-video branch so a branching step can never be
// silently routed into an interactive response phase (the contract is
// simpleVideoUrl only).

import { isBranchingStep, BRANCH_OVERLAY_PHASE } from './branch-choice-logic.js';

const RESPONSE_TYPES = ['closedResponse', 'openResponse', 'friendClosedResponse'];

function interactivePhase(responseType) {
    return 'interactiveVideo+' + (
        responseType === 'openResponse' ? 'openResponse'
            : responseType === 'friendClosedResponse' ? 'friendClosedResponse'
                : 'closedResponse'
    );
}

/**
 * The phase that PLAYS an interactive response clip. Distinct from
 * `interactiveDecisionPhase` below, which is the decision screen the clip
 * raises when it reaches its overlay point.
 */
export function interactivePlaybackPhase(responseType) {
    return interactivePhase(responseType);
}

/**
 * The decision ("did you understand?" / "repeat exactly") phase for an
 * interactive response clip. One name per response type, because the decision
 * screen reads the phase to decide its label and icon: lumping
 * `friendClosedResponse` in with `closedResponse` showed the repeat-now
 * microphone instead of Continue (stories/092).
 */
export function interactiveDecisionPhase(responseType) {
    return 'interactiveVideo-decisionTime-' + (
        responseType === 'openResponse' ? 'openResponse'
            : responseType === 'friendClosedResponse' ? 'friendClosedResponse'
                : 'closedResponse'
    );
}

export function resolveStepPhase({ step, isFirstResponseStep = false, isRetry = false, isFriendLesson = false } = {}) {
    const responseType = step?.responseType;
    if (responseType === 'lessonIntro') return 'lessonIntro';
    if (responseType === 'success') return 'lessonSuccess';
    if (isBranchingStep(step)) return step?.simpleVideoUrl ? 'simpleVideo' : BRANCH_OVERLAY_PHASE;
    if (RESPONSE_TYPES.includes(responseType) && isFirstResponseStep && !isRetry && !isFriendLesson) return 'firstResponse';
    if (step?.interactiveVideoUrl && !isRetry) return interactivePhase(responseType);
    if (responseType === 'viewAndContinue' && step?.simpleVideoUrl) return 'viewAndContinueVideo';
    if (step?.simpleVideoUrl) return 'simpleVideo';
    return 'recording/answering';
}
