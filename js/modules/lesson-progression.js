// --- modules/lesson-progression.js ---
// Progression functions extracted from app.js.
// Manages step transitions, lesson advancement, progress bar, and tutor chat.
// Uses deps pattern (_deps) for callLoadStep and loadLessonContent to avoid circular imports.

import { appStore } from './store.js';
import Strings from '../data/strings.js';

export function createProgression(deps) {
    const {
        addAILoadingMessage,
        getChatHistoryContext,
        askEnglishTutor,
        saveLessonProgress,
        playSound,
    } = deps;

    function updateProgressBar() {
        if (!appStore.getState().configData || !appStore.getState().configData.lessons || appStore.getState().configData.lessons.length === 0) return;
        const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];
        const totalSteps = currentLesson.steps.length;
        const gs = appStore.getState();
        let currentSteps = gs.stepsAnswered;
        gs.setStepsAnswered(currentSteps + 1);
        const finalProgress = Math.min(Math.max((currentSteps / totalSteps) * 100, 10), 90);
        appStore.getState().setProgressPercent(`${finalProgress}%`);
    }

    function showCompletionMessage() {
        const msg = Strings.get('msg_lesson_complete_all', appStore.getState().userData?.native_language);
        const heading = msg.match(/<h3>(.*?)<\/h3>/)?.[1] || '';
        const body = msg.match(/<p>(.*?)<\/p>/)?.[1] || '';
        appStore.getState().setCompletionMessage({ heading, body });
    }

    function loadNextStep(currentStep, fluencyData, _deps = {}) {
        updateProgressBar();
        appStore.getState().setStatsVisible(false);
        appStore.getState().resetForNextStep();
        appStore.getState().resetStepState();

        if (!appStore.getState().configData || !appStore.getState().configData.lessons || appStore.getState().configData.lessons.length === 0) return;
        const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];

        const loadLessonContent = _deps.loadLessonContent;

        appStore.setState({ currentStepIndex: appStore.getState().currentStepIndex + 1 });
        if (appStore.getState().currentStepIndex < currentLesson.steps.length) {
            _deps.callLoadStep(currentLesson.steps[appStore.getState().currentStepIndex], currentLesson, fluencyData);
        } else {
            if (currentLesson.nextLessonId) loadNextLesson({ callLoadStep: _deps.callLoadStep, loadLessonContent });
            else showCompletionMessage();
        }
    }

    async function loadNextLesson(_deps = {}) {
        if (!appStore.getState().configData || !appStore.getState().configData.lessons || appStore.getState().configData.lessons.length === 0) return;
        const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];
        const nextLessonId = currentLesson.nextLessonId;
        console.log(`[Progression] loadNextLesson: ${currentLesson?.lessonId} → ${nextLessonId}`);

        if (nextLessonId) {
            appStore.setState({ pendingLessonNavigation: nextLessonId });

            saveLessonProgress(appStore.getState().courseId, nextLessonId, appStore.getState().userData).then(progressResult => {
                if (progressResult.dayCountIncremented) {
                    appStore.getState().setActivityMetrics(progressResult.newDayCount, appStore.getState().currentStreak);
                }
            });

            setTimeout(() => {
                const nextLessonIndex = appStore.getState().configData.lessons.findIndex(l => l.lessonId === nextLessonId);
                if (nextLessonIndex !== -1) {
                    appStore.setState({ currentLessonIndex: nextLessonIndex });
                    appStore.getState().setProgress({ lessonId: nextLessonId, lessonIndex: nextLessonIndex, questionIndex: 0 });
                    appStore.getState().setCurrentLessonTimestamp(new Date().toISOString());
                }
            }, 500);
        } else {
            playSound('lesson-complete-sound');
            showCompletionMessage();
        }
    }

    async function handleTutorChatSubmit(rawText) {
        if (!rawText || !rawText.trim()) return;
        const wordCount = rawText.trim().split(/\s+/).length;
        appStore.getState().incrementUserTutorStats(wordCount);

        appStore.getState().addChatMessage({
            role: 'user',
            type: 'standard',
            content: rawText,
            userName: appStore.getState().userData?.display_name?.split(' ')[0] || 'User',
            userAvatarUrl: appStore.getState().userData?.profilepicurl || '/assets/img/userprofile.webp'
        });

        addAILoadingMessage(Strings.get('ai_thinking', appStore.getState().userData?.native_language));

        const context = getChatHistoryContext();
        try {
            const aiResponse = await askEnglishTutor(context, rawText);
            const aiWordCount = aiResponse.trim().split(/\s+/).length;
            appStore.getState().incrementAiTutorStats(aiWordCount);

            appStore.getState().removeAiLoadingMessage();

            appStore.getState().addChatMessage({
                role: 'system',
                type: 'standard',
                content: aiResponse,
                botName: 'FluIntel AI',
                avatarUrl: '/assets/img/ai.webp'
            });
        } catch (error) {
            console.error('[app] Error in askEnglishTutor:', error);
            appStore.getState().removeAiLoadingMessage();
        }
    }

    return { updateProgressBar, showCompletionMessage, loadNextStep, loadNextLesson, handleTutorChatSubmit };
}

// --- Backward-compatible free-function exports ---
// These allow existing importers (LessonContainer.jsx, app-infra.js) to keep working
// without immediately switching to the factory pattern.
// app-infra.js calls setProgressionDeps() to configure the default instance.

let _deps = {
    addAILoadingMessage: () => {},
    getChatHistoryContext: () => '',
    askEnglishTutor: async () => '',
    saveLessonProgress: async () => ({}),
    playSound: () => {},
};
let _instance = null;

export function setProgressionDeps(deps) {
    _deps = deps;
    _instance = null;
}

function getProgression() {
    if (!_instance) _instance = createProgression(_deps);
    return _instance;
}

export function updateProgressBar() { return getProgression().updateProgressBar(); }
export function showCompletionMessage() { return getProgression().showCompletionMessage(); }
export function loadNextStep(currentStep, fluencyData, _deps) { return getProgression().loadNextStep(currentStep, fluencyData, _deps); }
export function loadNextLesson(_deps) { return getProgression().loadNextLesson(_deps); }
export function handleTutorChatSubmit(rawText) { return getProgression().handleTutorChatSubmit(rawText); }
