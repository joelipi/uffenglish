// --- components/step-loader.web.js ---
// Thin wrapper — all logic moved to js/modules/step-loader-execute.js.
// This exists so non-React callers (app-infra.js) can import loadStep as before.

import { createLoadStep } from '../modules/step-loader-execute.js';

let _deps = { submitAnswerPrecheck: null, showFeedbackAndProceed: null, handleHint: null };

export function setStepLoaderDeps(deps) {
    _deps = deps;
}

export function loadStep(step, lesson, fluencyData, deps) {
    const d = deps || _deps;
    const execute = createLoadStep(d.submitAnswerPrecheck, d.showFeedbackAndProceed, d.handleHint);
    return execute(step, lesson, fluencyData);
}
