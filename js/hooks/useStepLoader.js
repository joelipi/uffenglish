import { useCallback } from 'react';
import { createLoadStep } from '../modules/step-loader-execute.js';

export function useStepLoader() {
    const loadStep = useCallback((step, lesson, fluencyData, deps) => {
        const execute = createLoadStep(
            deps.submitAnswerPrecheck,
            deps.showFeedbackAndProceed,
            deps.handleHint
        );
        return execute(step, lesson, fluencyData);
    }, []);

    return { loadStep };
}
