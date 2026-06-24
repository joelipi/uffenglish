/**
 * Step Loader - Platform-Agnostic Orchestration
 *
 * This module provides the core step-loading orchestration logic that is
 * shared between web (React) and React Native implementations.
 *
 * It contains NO DOM manipulation and NO platform-specific imports.
 * All platform-specific operations are injected via the `deps` parameter.
 *
 * Architecture:
 * - Web (current): step-loader.web.js provides DOM-heavy render functions
 * - React (future): StepLoader.jsx provides React component rendering
 * - React Native (future): StepLoader.native.jsx provides native rendering
 *
 * All implementations share this module's orchestration logic.
 */

import {
    handleStepCore,
    handleTextStep,
    handleLessonComplete,
    handleUnitComplete,
    handleSuccessStep
} from './step-loader-logic.js';

/**
 * Platform-agnostic step loader orchestration.
 *
 * This function coordinates step loading without any DOM manipulation.
 * All platform-specific behavior is injected through `deps`.
 *
 * @param {object} step - The step data to load
 * @param {object} lesson - The lesson containing the step
 * @param {object|null} fluencyData - Fluency data for the current session
 * @param {object} deps - Platform-specific dependencies
 * @param {Function} deps.submitAnswerPrecheck - Answer precheck handler
 * @param {Function} deps.showFeedbackAndProceed - Feedback and progression handler
 * @param {Function} [deps.onStepLoaded] - Called after core step logic, before step-type dispatch
 * @param {Function} [deps.onResponseStep] - Called for response-type steps (openResponse, closedResponse)
 * @param {Function} [deps.onTextStep] - Called for text-type steps
 * @param {Function} [deps.onLessonIntro] - Called for lesson intro steps
 * @param {Function} [deps.onViewAndContinue] - Called for viewAndContinue steps
 * @param {Function} [deps.onSuccess] - Called for success steps
 * @param {Function} [deps.onLessonComplete] - Called for lesson complete steps
 * @param {Function} [deps.onUnitComplete] - Called for unit complete steps
 */
export function loadStepOrchestrate(step, lesson, fluencyData, deps = {}) {
    const {
        submitAnswerPrecheck,
        showFeedbackAndProceed,
        onStepLoaded = () => {},
        onResponseStep = () => {},
        onTextStep = () => {},
        onLessonIntro = () => {},
        onViewAndContinue = () => {},
        onSuccess = () => {},
        onLessonComplete = () => {},
        onUnitComplete = () => {}
    } = deps;

    // Core step logic (platform-agnostic)
    handleStepCore(step);

    // Platform-specific post-core hook (e.g., speech warmup, UI reset, media rendering)
    onStepLoaded(step, lesson, fluencyData);

    // Step-type dispatch (platform-agnostic branching, platform-specific handlers)
    if (step.responseType === 'closedResponse' || step.responseType === 'openResponse') {
        onResponseStep(step, lesson, { submitAnswerPrecheck, showFeedbackAndProceed });
    } else if (step.responseType === 'unitcomplete') {
        onUnitComplete(step);
    } else if (step.responseType === 'lessonIntro') {
        onLessonIntro(step, lesson, { showFeedbackAndProceed });
    } else if (step.responseType === 'viewAndContinue') {
        onViewAndContinue(step, lesson, { showFeedbackAndProceed });
    } else if (step.responseType === 'success') {
        onSuccess(step, fluencyData);
    }
}
