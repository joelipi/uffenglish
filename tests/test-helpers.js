/**
 * test-helpers.js — Test-only answer pipeline wrappers
 *
 * Provides submitAnswerPrecheck and handleAnswer with the answerDeps
 * injection pattern that the Playwright tests rely on.
 * Replaces the former app.js re-exports.
 */

import {
    handleHint as handleHintImpl,
    submitAnswerPrecheck as submitAnswerPrecheckImpl,
    handleAnswer as handleAnswerImpl,
    showFeedbackAndProceed as showFeedbackAndProceedImpl
} from './modules/answer-pipeline.jsx';

const answerDeps = { loadNextStep: null };

export async function submitAnswerPrecheck(...args) {
    if (args.length < 11) {
        return submitAnswerPrecheckImpl(
            args[0], args[1], args[2], args[3], args[4], args[5], args[6],
            answerDeps,
            args[7], args[8], args[9]
        );
    }
    return submitAnswerPrecheckImpl(...args, answerDeps);
}

export async function handleAnswer(...args) {
    if (args.length < 11) {
        return handleAnswerImpl(
            args[0], args[1], args[2], args[3], args[4], args[5], args[6],
            answerDeps,
            args[7], args[8], args[9]
        );
    }
    return handleAnswerImpl(...args, answerDeps);
}
