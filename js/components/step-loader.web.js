// --- components/step-loader.web.js ---
// Thin wrapper — all logic moved to js/modules/step-loader-execute.js.
// This exists so non-React callers (app-infra.js) can import loadStep as before.

import { createLoadStep } from '../modules/step-loader-execute.js';

export function loadStep(step, lesson, fluencyData, deps) {
    const execute = createLoadStep(deps.submitAnswerPrecheck, deps.showFeedbackAndProceed, deps.handleHint);
    return execute(step, lesson, fluencyData);
}
