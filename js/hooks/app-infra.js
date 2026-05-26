/**
 * app-infra.js — Application infrastructure setup
 *
 * Wires up SuccessLessonHandler, progress tracking, tutor chat,
 * mic animation, and deferred AI/BG workers. Called from the React
 * bootstrap hook after auth and config are loaded.
 */

import { appStore } from '../modules/store.js';
import { State } from '../modules/state.js';

import { initMicAnimation } from '../components/mic-animation.js';
import { syncOfflineScores } from '../modules/user-profile.js';
import { calculateCurrentStreak } from '../modules/user-profile.js';
import { calculateAverage } from '../modules/scoring.js';
import { Media } from '../modules/media.js';
import Strings from '../data/strings.js';
import { updateProgressBar as updateProgressBarFn, loadNextStep as loadNextStepImpl, loadNextLesson as loadNextLessonFn, showCompletionMessage as showCompletionMessageFn, handleTutorChatSubmit as handleTutorChatSubmitFn } from '../modules/lesson-progression.js';
import { clearSpeechRecordingsForLesson } from '../modules/storage.js';

import {
    handleHint as handleHintImpl,
    submitAnswerPrecheck as submitAnswerPrecheckImpl,
    handleAnswer as handleAnswerImpl,
    showFeedbackAndProceed as showFeedbackAndProceedImpl
} from '../modules/answer-pipeline.jsx';
import { loadStep } from '../components/step-loader.web.js';

export async function setupAppInfra({ userData }) {
    if (userData) {
        appStore.getState().setCourseData({
            userData,
            englishLevel: userData?.english_level || 'A0'
        });

        const isGuest = userData.auth_method === 'guest' || userData.display_name === 'Guest User';
        const firstName = isGuest ? null : (userData.first_name || (userData.display_name ? userData.display_name.split(' ')[0] : null));
        appStore.getState().setUserFirstName(firstName);

        if (Array.isArray(userData.completed_dates)) {
            const dayCount = userData.completed_dates.length;
            const currentStreak = calculateCurrentStreak(userData.completed_dates);
            appStore.getState().setActivityMetrics(dayCount, currentStreak);
        }

        const lessonsCompleted = Number(userData.lessons_completed || 0);
        appStore.getState().setLessonsCompleted(lessonsCompleted);
        appStore.getState().setTotalFluencySum(Number(userData.total_fluency_sum || 0));
        appStore.getState().setRecentFluencyAvgs(userData.recent_fluency_avgs || []);
        appStore.getState().setCountedLessons(userData.counted_lessons || []);
    }

    initMicAnimation();
    syncOfflineScores(userData);

    appStore.getState().setTutorChatSubmitCallback(handleTutorChatSubmitFn);

    const updateState = (newState) => {
        const reactiveKeys = ['listeningScore', 'speakingScore', 'incorrectAttempts', 'dayCount', 'currentStreak'];
        const storeUpdates = {};
        const stateUpdates = {};
        Object.entries(newState).forEach(([key, value]) => {
            if (reactiveKeys.includes(key)) {
                storeUpdates[key] = value;
            } else {
                stateUpdates[key] = value;
            }
        });
        if (Object.keys(storeUpdates).length > 0) {
            appStore.setState(storeUpdates);
        }
        if (Object.keys(stateUpdates).length > 0) {
            Object.assign(State, stateUpdates);
        }
    };

    const handleHint = (...args) => handleHintImpl(...args);

    let callLoadStepRef = null;

    const answerDeps = {
        get callLoadStep() { return callLoadStepRef; },
        get loadNextStep() { return loadNextStep; }
    };

    const submitAnswerPrecheck = (...args) => {
        if (args.length < 11) {
            return submitAnswerPrecheckImpl(
                args[0], args[1], args[2], args[3], args[4], args[5], args[6],
                answerDeps,
                args[7], args[8], args[9]
            );
        }
        return submitAnswerPrecheckImpl(...args, answerDeps);
    };

    const handleAnswer = (...args) => {
        if (args.length < 11) {
            return handleAnswerImpl(
                args[0], args[1], args[2], args[3], args[4], args[5], args[6],
                answerDeps,
                args[7], args[8], args[9]
            );
        }
        return handleAnswerImpl(...args, answerDeps);
    };

    const showFeedbackAndProceed = (...args) => showFeedbackAndProceedImpl(...args, answerDeps);

    function callLoadStep(step, lesson, fluencyData) {
        loadStep(step, lesson, fluencyData, {
            submitAnswerPrecheck,
            showFeedbackAndProceed,
            handleHint
        });
    }
    callLoadStepRef = callLoadStep;

    const updateProgressBar = () => updateProgressBarFn();
    const loadNextStep = (currentStep, fluencyData) => loadNextStepImpl(currentStep, fluencyData, { callLoadStep });
    const loadNextLesson = () => {
        loadNextLessonFn({ callLoadStep, loadLessonContent });
    };
    const showCompletionMessage = () => showCompletionMessageFn();

    async function loadLessonContent(lesson) {
        try {
            await clearSpeechRecordingsForLesson(lesson.lessonId);
        } catch (e) {
            console.error(e);
        }
        if (State.player) State.player.destroy();
        State.resetForNewLesson();
        State.lessonStartTime = new Date().toISOString();
        State.roleOther = lesson.roleOther || "";
        State.roleUser = lesson.roleUser || "";
        State.userRole = lesson.userRole || "";
        State.videoRole = lesson.videoRole || "";
        updateProgressBar();

        const configData = appStore.getState().configData;
        const course = configData?.courseName || "";
        const englishLevel = configData?.languageLevel || 'A0';
        const level = englishLevel ? ` (${englishLevel})` : "";
        const unit = (lesson.unit && String(lesson.unit).trim() !== "") ? `${lesson.unit}: ` : "";
        const titleText = (typeof lesson.title === 'object') ? (lesson.title.en || "") : (lesson.title || "");
        const fullTitle = `${course}${level}${course ? ': ' : ''}${unit}${titleText}`;

        appStore.setState({
            currentStepIndex: 0,
            lessonTitle: fullTitle,
            isLessonActive: true
        });

        // Dispatch the first step of the new lesson
        loadStep(lesson.steps[appStore.getState().currentStepIndex], lesson, null, {
            submitAnswerPrecheck,
            showFeedbackAndProceed,
            handleHint
        });
    }

    const { SuccessLessonHandler } = await import('../components/success-lesson.js');

    const handler = new SuccessLessonHandler({
        loadLessonContent,
        calculateAverage,
        playSound: Media.playSound,
        loadNextLesson,
        updateState,
        uiElements: {}
    });

    State.successHandler = handler;
    appStore.getState().setSuccessHandler(handler);

    console.log('[app-infra] SuccessLessonHandler initialized', {
        currentLessonIndex: appStore.getState().currentLessonIndex,
        lessonsLoaded: appStore.getState().configData?.lessons?.length,
        fluencyScore: appStore.getState().fluencyScore,
        listeningScore: appStore.getState().listeningScore,
        speakingScore: appStore.getState().speakingScore
    });

    window.__submitAnswerPrecheck = submitAnswerPrecheck;
    window.__handleAnswer = handleAnswer;
}
