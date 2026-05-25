/**
 * useStepLoader — React hook for step loading
 *
 * Creates the callLoadStep function that wraps loadStep with the
 * answer pipeline dependencies. Registers itself with the answer
 * pipeline via the setter callback to break circular dependency.
 */

import { useCallback, useEffect } from 'react';
import { loadStep } from '../components/step-loader.web.js';
import { loadNextStep as loadNextStepImpl } from '../modules/lesson-progression.js';

export function useStepLoader(submitAnswerPrecheck, showFeedbackAndProceed, handleHint, setCallLoadStep, setLoadNextStep) {
    const callLoadStep = useCallback((step, lesson, fluencyData) => {
        loadStep(step, lesson, fluencyData, {
            submitAnswerPrecheck,
            showFeedbackAndProceed,
            handleHint
        });
    }, [submitAnswerPrecheck, showFeedbackAndProceed, handleHint]);

    const loadNextStep = useCallback((currentStep, fluencyData) => {
        loadNextStepImpl(currentStep, fluencyData, { callLoadStep });
    }, [callLoadStep]);

    // Register callLoadStep and loadNextStep with the answer pipeline
    useEffect(() => {
        setCallLoadStep(callLoadStep);
        setLoadNextStep(loadNextStep);
    }, [callLoadStep, loadNextStep, setCallLoadStep, setLoadNextStep]);

    return { callLoadStep, loadNextStep };
}
