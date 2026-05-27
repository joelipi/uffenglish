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
import { calculateLessonAverage, detectFluencyTrend } from './success-lesson-logic.js';

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
    const state = appStore.getState();
    const lessonAverage = calculateLessonAverage(state);
    const isImproving = detectFluencyTrend(lessonAverage, state.recentFluencyAvgs || []);

    const fluencyDataObj = { total: lessonAverage };
    const lessonId = state.configData.lessons[state.currentLessonIndex].lessonId + 's';

    state.setLastSuccessFluencyData(fluencyDataObj);
    state.setFluencyImproving(isImproving);
    state.setLastLessonFluencyAvg(lessonAverage);

    step.lessonId = lessonId;
    state.setSuccessScreen(step.lessonId, fluencyDataObj);
    state.setStatsVisible(false);
    state.setProgressPercent("100%");
    state.setBottomControlState('lessonSuccess');
}

// --- Success Step Rendering ---

export function handleSuccessStep(step, fluencyData) {
    const state = appStore.getState();
    const lessonAverage = calculateLessonAverage(state);
    const isImproving = detectFluencyTrend(lessonAverage, state.recentFluencyAvgs || []);
    
    const fluencyDataObj = { total: lessonAverage };
    state.setLastSuccessFluencyData(fluencyDataObj);
    state.setFluencyImproving(isImproving);
    state.setLastLessonFluencyAvg(lessonAverage);
    
    if (isImproving) {
        console.log(`[Gamification] ✅ Fluency improving! Last-10 avg: ${state.recentFluencyAvgs?.reduce((a, b) => a + b, 0) / (state.recentFluencyAvgs?.length || 1)}% → Current: ${lessonAverage}%`);
    }
    
    state.setSuccessScreen(step.lessonId, fluencyDataObj);
    state.setStatsVisible(false);
    state.setProgressPercent("100%");
    state.setBottomControlState('lessonSuccess');

    const currentLesson = state.configData.lessons[state.currentLessonIndex];
    const nextLessonId = currentLesson.nextLessonId;

    if (nextLessonId) {
        const finalStats = getCompressedLessonStats({
            isTextMode: state.isTextMode,
            isCameraOff: state.isCameraOff,
            lessonStartTime: state.lessonStartTime,
            averageWpm: state.averageWpm,
            totalPauses: state.totalPauses,
            totalHesitations: state.totalHesitations,
            recognizedIdioms: state.recognizedIdioms,
            pragmaticFlags: state.pragmaticFlags,
            interactionLog: state.interactionLog
        });

        saveLessonProgress(state.courseId, nextLessonId, state.userData, {
            updateUserMeta: true,
            incrementCount: true,
            lessonStats: finalStats,
            currentLessonId: step.lessonId
        }).then(progressResult => {
            state.setActivityMetrics(progressResult.newDayCount, progressResult.newStreak);
            if (progressResult.lessonsCompleted) {
                state.setLessonsCompleted(progressResult.lessonsCompleted);
            }
        });
    };
}
