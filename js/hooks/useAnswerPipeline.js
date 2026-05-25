/**
 * useAnswerPipeline — React hook for answer processing pipeline
 *
 * Encapsulates the answer deps injection pattern that was previously
 * handled by app.js wrapper functions. Uses refs to break the circular
 * dependency between callLoadStep and the answer pipeline.
 */

import { useCallback, useMemo, useRef } from 'react';
import {
    handleHint as handleHintImpl,
    submitAnswerPrecheck as submitAnswerPrecheckImpl,
    handleAnswer as handleAnswerImpl,
    showFeedbackAndProceed as showFeedbackAndProceedImpl
} from '../modules/answer-pipeline.jsx';

export function useAnswerPipeline() {
    // Use refs to break circular dependency: callLoadStep needs answerPipeline,
    // and answerPipeline needs callLoadStep. Refs allow lazy resolution.
    const callLoadStepRef = useRef(null);
    const loadNextStepRef = useRef(null);

    const setCallLoadStep = useCallback((fn) => {
        callLoadStepRef.current = fn;
    }, []);

    const setLoadNextStep = useCallback((fn) => {
        loadNextStepRef.current = fn;
    }, []);

    const answerDeps = useMemo(() => ({
        get callLoadStep() { return callLoadStepRef.current; },
        get loadNextStep() { return loadNextStepRef.current; }
    }), []);

    const handleHint = useCallback((...args) => {
        return handleHintImpl(...args);
    }, []);

    const submitAnswerPrecheck = useCallback((...args) => {
        if (args.length < 11) {
            return submitAnswerPrecheckImpl(
                args[0], args[1], args[2], args[3], args[4], args[5], args[6],
                answerDeps,
                args[7], args[8], args[9]
            );
        }
        return submitAnswerPrecheckImpl(...args, answerDeps);
    }, [answerDeps]);

    const handleAnswer = useCallback((...args) => {
        if (args.length < 11) {
            return handleAnswerImpl(
                args[0], args[1], args[2], args[3], args[4], args[5], args[6],
                answerDeps,
                args[7], args[8], args[9]
            );
        }
        return handleAnswerImpl(...args, answerDeps);
    }, [answerDeps]);

    const showFeedbackAndProceed = useCallback((...args) => {
        return showFeedbackAndProceedImpl(...args, answerDeps);
    }, [answerDeps]);

    return {
        handleHint,
        submitAnswerPrecheck,
        handleAnswer,
        showFeedbackAndProceed,
        setCallLoadStep,
        setLoadNextStep
    };
}
