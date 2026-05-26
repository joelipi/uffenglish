// --- components/step-loader.web.js ---
// Thin wrapper that re-exports the hook-based loadStep for backward compatibility.
// All logic has been moved to js/hooks/useStepLoader.js.
// This file exists so that non-React callers (app-infra.js) can still import loadStep.

import { createLoadStep } from '../modules/step-loader-execute.js';

// Maintain a persistent set of current deps so callers don't need to track them.
let _currentDeps = { submitAnswerPrecheck: null, showFeedbackAndProceed: null, handleHint: null };

export function setStepLoaderDeps(deps) {
    _currentDeps = deps;
}

export function loadStep(step, lesson, fluencyData, deps) {
    const d = deps || _currentDeps;
    const execute = createLoadStep(d.submitAnswerPrecheck, d.showFeedbackAndProceed, d.handleHint);
    return execute(step, lesson, fluencyData);
}

// Re-export helper functions that are still referenced by step-loader-logic.js
export { clearWarningLater, cancelWarningClear } from '../modules/step-loader-logic.js';
