// --- modules/lesson-progression.js ---
// Progression functions extracted from app.js.
// Manages step transitions, lesson advancement, progress bar, and tutor chat.
// Uses deps pattern (_deps) for callLoadStep and loadLessonContent to avoid circular imports.

import { appStore } from './store.js';
import Strings from '../data/strings.js';

import {
    addAILoadingMessage,
    getChatHistoryContext
} from '../components/chat/chat-interface.js';
import { askEnglishTutor } from './api.js';
import { saveLessonProgress } from './user-profile.js';
import { Media } from './media.js';

export function updateProgressBar() {
    if (!appStore.getState().configData || !appStore.getState().configData.lessons || appStore.getState().configData.lessons.length === 0) return;
    const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];
    const totalSteps = currentLesson.steps.length;
    const gs = appStore.getState();
    let currentSteps = gs.stepsAnswered;
    gs.setStepsAnswered(currentSteps + 1);
    const finalProgress = Math.min(Math.max((currentSteps / totalSteps) * 100, 10), 90);
    appStore.getState().setProgressPercent(`${finalProgress}%`);
}

export function showCompletionMessage() {
    appStore.getState().setCompletionMessage(Strings.get('msg_lesson_complete_all', appStore.getState().userData?.native_language));
}

export function loadNextStep(currentStep, fluencyData, _deps = {}) {
    updateProgressBar();
    appStore.getState().setStatsVisible(false);
    appStore.getState().resetForNextStep();
    appStore.getState().resetStepState();

    if (!appStore.getState().configData || !appStore.getState().configData.lessons || appStore.getState().configData.lessons.length === 0) return;
    const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];

    const loadLessonContent = _deps.loadLessonContent || appStore.getState().loadLessonContentCallback;

    appStore.setState({ currentStepIndex: appStore.getState().currentStepIndex + 1 });
    if (appStore.getState().currentStepIndex < currentLesson.steps.length) {
        _deps.callLoadStep(currentLesson.steps[appStore.getState().currentStepIndex], currentLesson, fluencyData);
    } else {
        if (currentLesson.nextLessonId) loadNextLesson({ callLoadStep: _deps.callLoadStep, loadLessonContent });
        else showCompletionMessage();
    }
}

export async function loadNextLesson(_deps = {}) {
    if (!appStore.getState().configData || !appStore.getState().configData.lessons || appStore.getState().configData.lessons.length === 0) return;
    const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];
    const nextLessonId = currentLesson.nextLessonId;
    console.log(`[Progression] loadNextLesson: ${currentLesson?.lessonId} → ${nextLessonId}`);

    if (nextLessonId) {
        // Update URL immediately so reload lands on the correct lesson
        appStore.setState({ pendingLessonNavigation: nextLessonId });

        saveLessonProgress(appStore.getState().courseId, nextLessonId, appStore.getState().userData).then(progressResult => {
            if (progressResult.dayCountIncremented) {
                appStore.getState().setActivityMetrics(progressResult.newDayCount, appStore.getState().currentStreak);
            }
        });

        // Async state persistence — route navigation handles loading the new lesson content
        setTimeout(() => {
            const nextLessonIndex = appStore.getState().configData.lessons.findIndex(l => l.lessonId === nextLessonId);
            if (nextLessonIndex !== -1) {
                appStore.setState({ currentLessonIndex: nextLessonIndex });
                localStorage.setItem(`${appStore.getState().courseId}_currentLessonId`, nextLessonId);
                localStorage.setItem(`${appStore.getState().courseId}_currentLessonTimestamp`, new Date().toISOString());
            }
        }, 500);
    } else {
        Media.playSound('lesson-complete-sound');
        showCompletionMessage();
    }
}

export async function handleTutorChatSubmit(rawText) {
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
