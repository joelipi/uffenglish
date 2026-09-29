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

const RESPONSE_TYPES = ['closedResponse', 'openResponse', 'friendClosedResponse'];

function interactivePhase(responseType) {
    return 'interactiveVideo+' + (
        responseType === 'openResponse' ? 'openResponse'
            : responseType === 'friendClosedResponse' ? 'friendClosedResponse'
                : 'closedResponse'
    );
}

export function resolveStepPhase({ step, isFirstResponseStep = false, isRetry = false, isFriendLesson = false } = {}) {
    const responseType = step?.responseType;
    if (responseType === 'lessonIntro') return 'lessonIntro';
    if (responseType === 'success') return 'lessonSuccess';
    if (RESPONSE_TYPES.includes(responseType) && isFirstResponseStep && !isRetry && !isFriendLesson) return 'firstResponse';
    if (step?.interactiveVideoUrl && !isRetry) return interactivePhase(responseType);
    if (responseType === 'viewAndContinue' && step?.simpleVideoUrl) return 'viewAndContinueVideo';
    if (step?.simpleVideoUrl) return 'simpleVideo';
    return 'recording/answering';
}
