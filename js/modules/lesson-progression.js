// --- modules/lesson-progression.js ---
// Progression functions extracted from app.js.
// Manages step transitions, lesson advancement, progress bar, and tutor chat.
// Uses deps pattern (_deps) for callLoadStep and loadLessonContent to avoid circular imports.

import { appStore } from './store.js';
import { State } from './state.js';
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
    let currentSteps = State.stepsAnswered++;
    const finalProgress = Math.min(Math.max((currentSteps / totalSteps) * 100, 10), 90);
    appStore.getState().setProgressPercent(`${finalProgress}%`);
}

export function showCompletionMessage() {
    appStore.getState().setCompletionMessage(Strings.get('msg_lesson_complete_all', appStore.getState().userData?.native_language));
}

export function loadNextStep(currentStep, fluencyData, _deps = {}) {
    updateProgressBar();
    appStore.getState().setStatsVisible(false);
    State.resetForNextStep();

    if (!appStore.getState().configData || !appStore.getState().configData.lessons || appStore.getState().configData.lessons.length === 0) return;
    const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];

    appStore.setState({ currentStepIndex: appStore.getState().currentStepIndex + 1 });
    if (appStore.getState().currentStepIndex < currentLesson.steps.length) {
        _deps.callLoadStep(currentLesson.steps[appStore.getState().currentStepIndex], currentLesson, fluencyData);
    } else {
        if (currentLesson.nextLessonId) loadNextLesson(_deps);
        else showCompletionMessage();
    }
}

export async function loadNextLesson(_deps = {}) {
    if (!appStore.getState().configData || !appStore.getState().configData.lessons || appStore.getState().configData.lessons.length === 0) return;
    const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];
    const nextLessonId = currentLesson.nextLessonId;

    if (nextLessonId) {
        saveLessonProgress(appStore.getState().courseId, nextLessonId, appStore.getState().userData).then(progressResult => {
            if (progressResult.dayCountIncremented) {
                appStore.getState().setActivityMetrics(progressResult.newDayCount, appStore.getState().currentStreak);
            }
        });

        setTimeout(async () => {
            const nextLessonIndex = appStore.getState().configData.lessons.findIndex(l => l.lessonId === nextLessonId);
            if (nextLessonIndex !== -1) {
                appStore.setState({ currentLessonIndex: nextLessonIndex });
                localStorage.setItem(`${appStore.getState().courseId}_currentLessonId`, nextLessonId);
                localStorage.setItem(`${appStore.getState().courseId}_currentLessonTimestamp`, new Date().toISOString());
                appStore.getState().setProgressPercent("100%");
                State.stepsAnswered = 0;
                appStore.setState({ currentStepIndex: 0 });
                _deps.loadLessonContent(appStore.getState().configData.lessons[nextLessonIndex]);
            } else showCompletionMessage();
        }, 1200);
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
