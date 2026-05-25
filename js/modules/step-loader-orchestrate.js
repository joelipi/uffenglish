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
 * @param {Function} deps.handleHint - Hint handler
 * @param {Function} [deps.onStepLoaded] - Called after core step logic, before step-type dispatch
 * @param {Function} [deps.onResponseStep] - Called for response-type steps (openResponse, closedResponse)
 * @param {Function} [deps.onTextStep] - Called for text-type steps
 * @param {Function} [deps.onLessonIntro] - Called for lesson intro steps
 * @param {Function} [deps.onPresent] - Called for present steps
 * @param {Function} [deps.onSuccess] - Called for success steps
 * @param {Function} [deps.onLessonComplete] - Called for lesson complete steps
 * @param {Function} [deps.onUnitComplete] - Called for unit complete steps
 */
export function loadStepOrchestrate(step, lesson, fluencyData, deps = {}) {
    const {
        submitAnswerPrecheck,
        showFeedbackAndProceed,
        handleHint,
        onStepLoaded = () => {},
        onResponseStep = () => {},
        onTextStep = () => {},
        onLessonIntro = () => {},
        onPresent = () => {},
        onSuccess = () => {},
        onLessonComplete = () => {},
        onUnitComplete = () => {}
    } = deps;

    // Core step logic (platform-agnostic)
    handleStepCore(step);

    // Platform-specific post-core hook (e.g., speech warmup, UI reset, media rendering)
    onStepLoaded(step, lesson, fluencyData);

    // Step-type dispatch (platform-agnostic branching, platform-specific handlers)
    if (step.stepType === 'closedResponse' || step.stepType === 'openResponse') {
        onResponseStep(step, lesson, { submitAnswerPrecheck, showFeedbackAndProceed, handleHint });
    } else if (step.stepType === 'text') {
        onTextStep(step, { submitAnswerPrecheck, showFeedbackAndProceed });
    } else if (step.stepType === 'lessoncomplete') {
        onLessonComplete(step, { showFeedbackAndProceed });
    } else if (step.stepType === 'unitcomplete') {
        onUnitComplete(step);
    } else if (step.stepType === 'lessonIntro') {
        onLessonIntro(step, lesson, { showFeedbackAndProceed });
    } else if (step.stepType === 'present') {
        onPresent(step, lesson, { showFeedbackAndProceed });
    } else if (step.stepType === 'success') {
        onSuccess(step, fluencyData);
    }
}
