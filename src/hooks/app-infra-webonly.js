// @web-only
// Application infrastructure wiring for web.
// Imports web-specific modules (speech.js, chat-interface.js) and wires them
// into the platform-agnostic factories (progression, answer-pipeline, step-loader).
// Called from the web-only useAppBootstrap hook after auth and config are loaded.

import { appStore, setAnswerPipelineDeps } from '../modules/store/store.js';

import { syncOfflineScores } from '../modules/user/user-profile.js';
import { calculateCurrentStreak } from '../modules/user/user-profile.js';
import { saveLessonProgress } from '../modules/user/user-profile.js';
import { calculateAverage } from '../modules/answer/scoring.js';
import { Media } from '../modules/media/media.js';
import Strings from '../data/strings.js';
import { setProgressionDeps, updateProgressBar as updateProgressBarFn, loadNextStep as loadNextStepImpl, loadNextLesson as loadNextLessonFn, showCompletionMessage as showCompletionMessageFn } from '../modules/lesson/lesson-progression.js';
import { loadLessonContent as loadLessonContentShared } from '../modules/lesson/lesson-loader.js';
import { loadStep } from '../components/step-loader.js';

import { createAnswerPipeline } from '../modules/answer/answer-pipeline.js';
import { showChat, addAILoadingMessage, addAIFeedbackMessages, clearChat, getChatHistoryContext } from '../components/chat/chat-interface.js';
import { askEnglishTutor } from '../modules/api/api.js';
import { warmUpSpeechCamStream, toggleSpeechRecognition, listeningState, retryWhisperEngine } from '../modules/speech/speech.js';
import { setSpeechEngineRetryCallback } from '../modules/lesson/step-loader-callbacks.js';

export async function setupAppInfra({ userData }) {
    // Let the mode chooser's "Try Again" reboot the Whisper engine.
    setSpeechEngineRetryCallback(retryWhisperEngine);

    if (userData) {
        appStore.getState().setCourseData({
            userData,
            userLevel: userData?.english_level || 'A0'
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

    syncOfflineScores(userData);

    // Wire progression backward-compatible wrappers
    setProgressionDeps({
        addAILoadingMessage,
        getChatHistoryContext,
        askEnglishTutor,
        saveLessonProgress,
        playSound: Media.playSound,
    });

    // Create answer pipeline
    const pipeline = createAnswerPipeline({
        showChat,
        clearChat,
        addAIFeedbackMessages,
        playSound: Media.playSound,
        enableAudioSystem: Media.enableAudioSystem,
        preloadVideo: (url) => Media.preloader.preloadOnly(url),
        warmUpSpeechCam: warmUpSpeechCamStream,
    });

    const {
        submitAnswerPrecheck: submitAnswerPrecheckImpl,
        showFeedbackAndProceed: showFeedbackAndProceedImpl,
    } = pipeline;

    let callLoadStepRef = null;

    const answerDeps = {
        get callLoadStep() { return callLoadStepRef; },
        get loadNextStep() { return loadNextStep; }
    };

    const submitAnswerPrecheck = (...args) => {
        if (args.length < 10) {
            return submitAnswerPrecheckImpl(
                args[0], args[1], args[2], args[3], args[4], args[5],
                answerDeps,
                args[6], args[7], args[8]
            );
        }
        return submitAnswerPrecheckImpl(...args, answerDeps);
    };

    const showFeedbackAndProceed = (...args) => showFeedbackAndProceedImpl(...args, answerDeps);

    setAnswerPipelineDeps({ submitAnswerPrecheck, showFeedbackAndProceed });

    function callLoadStep(step, lesson, fluencyData) {
        loadStep(step, lesson, fluencyData, {
            submitAnswerPrecheck,
            showFeedbackAndProceed
        });
    }
    callLoadStepRef = callLoadStep;

    const updateProgressBar = () => updateProgressBarFn();
    const loadNextStep = (currentStep, fluencyData) => loadNextStepImpl(currentStep, fluencyData, { callLoadStep, loadLessonContent });
    const loadNextLesson = () => {
        loadNextLessonFn({ callLoadStep, loadLessonContent });
    };
    const showCompletionMessage = () => showCompletionMessageFn();

    const loadLessonContent = (lesson) => loadLessonContentShared(lesson);
}