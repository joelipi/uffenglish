/**
 * useStepLoader — React hook for step loading
 *
 * Creates the callLoadStep function that wraps loadStep with the
 * answer pipeline dependencies. This replaces the callLoadStep
 * function that was previously in app.js.
 */

import { useCallback } from 'react';
import { loadStep } from '../components/step-loader.web.js';

export function useStepLoader(submitAnswerPrecheck, showFeedbackAndProceed, handleHint) {
    const callLoadStep = useCallback((step, lesson, fluencyData) => {
        loadStep(step, lesson, fluencyData, {
            submitAnswerPrecheck,
            showFeedbackAndProceed,
            handleHint
        });
    }, [submitAnswerPrecheck, showFeedbackAndProceed, handleHint]);

    return callLoadStep;
}
