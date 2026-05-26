/**
 * Step Loader Logic - Core step loading and rendering logic
 *
 * Pure functions for loading and rendering steps.
 * No DOM manipulation - just state management and logic.
 * Can be used by both web and React Native.
 */

import { appStore } from './store.js';
import Strings from '../data/strings.js';
import { loadVideoForStep } from './video-loader.js';
import { Media } from './media.js';
import { saveLessonProgress } from './user-profile.js';
import { getCompressedLessonStats } from './scoring.js';

// --- Warning Clear Timer (no DOM) ---

let _warningClearTimer = null;

export function clearWarningLater(ms) {
    clearTimeout(_warningClearTimer);
    _warningClearTimer = setTimeout(() => {
        appStore.getState().setMicStatusText('');
        _warningClearTimer = null;
    }, ms);
}

export function cancelWarningClear() {
    clearTimeout(_warningClearTimer);
    _warningClearTimer = null;
}

// --- Core Step Loading State (no DOM) ---

export function handleStepCore(step) {
    Media.cleanupPreviousPlayers();
    appStore.getState().setCurrentVideoPlayer(null);
    appStore.getState().setCurrentVideo(null);

    appStore.getState().setStatsVisible((step.stepType === 'closedResponse' || step.stepType === 'openResponse') && step.videoUrl);

    appStore.getState().setMediaVisible(true);

    loadVideoForStep(step, null, appStore.getState().userData?.native_language);

    appStore.getState().setMicStatusText(step.step);
}

// --- Text Step Handling ---

export function handleTextStep(step, submitAnswerPrecheck) {
    appStore.getState().setStatsVisible(true);
    appStore.getState().setTextInputPlaceholder(
        Strings.get('placeholder_type_answer', appStore.getState().userData?.native_language) || 'Type your answer here...'
    );
    appStore.getState().setTextInputSubmitCallback(
        (val, btn) => submitAnswerPrecheck(val, typeof step.cue === 'object' ? step.cue.en : step.cue, step, btn, step.explanation, step.translation, { pauseCount: null, netDuration: null })
    );
}

// --- Lesson Complete ---

export function handleLessonComplete(step, showFeedbackAndProceed) {
    appStore.getState().setStatsVisible(false);
    appStore.getState().setProgressPercent("95%");
    showFeedbackAndProceed(step, true);
}

// --- Unit Complete ---

export function handleUnitComplete(step) {
    step.lessonId = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex].lessonId + 's';
    appStore.getState().successHandler.handleSuccessLesson(step);
}

// --- Success Step Rendering ---

export function handleSuccessStep(step, fluencyData) {
    appStore.getState().successHandler.handleSuccessLesson(step);

    const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];
    const nextLessonId = currentLesson.nextLessonId;

    if (nextLessonId) {
        const finalStats = getCompressedLessonStats({
            isTextMode: appStore.getState().isTextMode,
            isCameraOff: appStore.getState().isCameraOff,
            lessonStartTime: appStore.getState().lessonStartTime,
            averageWpm: appStore.getState().averageWpm,
            totalPauses: appStore.getState().totalPauses,
            totalHesitations: appStore.getState().totalHesitations,
            recognizedIdioms: appStore.getState().recognizedIdioms,
            pragmaticFlags: appStore.getState().pragmaticFlags,
            interactionLog: appStore.getState().interactionLog
        });

        saveLessonProgress(appStore.getState().courseId, nextLessonId, appStore.getState().userData, {
            updateUserMeta: true,
            incrementCount: true,
            lessonStats: finalStats,
            currentLessonId: step.lessonId
        }).then(progressResult => {
            appStore.getState().setActivityMetrics(progressResult.newDayCount, progressResult.newStreak);
            if (progressResult.lessonsCompleted) {
                appStore.getState().setLessonsCompleted(progressResult.lessonsCompleted);
            }
        });
    };
}
