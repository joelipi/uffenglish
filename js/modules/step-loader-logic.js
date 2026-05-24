/**
 * Step Loader Logic - Core step loading and rendering logic
 *
 * Pure functions for loading and rendering steps.
 * No DOM manipulation - just state management and logic.
 * Can be used by both web and React Native.
 */

import { State } from './state.js';
import { appStore } from './store.js';
import Strings from '../data/strings.js';
import { loadVideoForStep } from './video-loader.js';
import { Media } from './media.js';
import { saveLessonProgress } from './user-profile.js';
import { getCompressedLessonStats } from './scoring.js';

// --- Step Loading ---

export function loadStep(step, lesson, fluencyData, deps) {
    const { submitAnswerPrecheck, showFeedbackAndProceed } = deps;

    Media.cleanupPreviousPlayers();
    State.player = null;
    appStore.getState().setCurrentVideo(null);

    appStore.getState().setStatsVisible((step.stepType === 'closedResponse' || step.stepType === 'openResponse') && step.videoUrl);

    appStore.getState().setMediaVisible(true);

    loadVideoForStep(step, State, appStore.getState().userData?.native_language);

    appStore.getState().setMicStatusText(step.step);

    if (step.stepType === 'text') {
        appStore.getState().setStatsVisible(true);
        appStore.getState().setTextInputPlaceholder(
            Strings.get('placeholder_type_answer', appStore.getState().userData?.native_language) || 'Type your answer here...'
        );
        appStore.getState().setTextInputSubmitCallback(
            (val, btn) => submitAnswerPrecheck(val, typeof step.cue === 'object' ? step.cue.en : step.cue, step, btn, step.explanation, step.translation, { pauseCount: null, netDuration: null })
        );
    } else if (step.stepType === 'lessoncomplete') {
        appStore.getState().setStatsVisible(false);
        appStore.getState().setProgressPercent("95%");
        showFeedbackAndProceed(step, true);
    } else if (step.stepType === 'unitcomplete') {
        step.lessonId = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex].lessonId + 's';
        State.successHandler.handleSuccessLesson(step);
    } else if (step.stepType === 'success') {
        renderSuccess(step, fluencyData);
    }
}

// --- Success Step Rendering ---

function renderSuccess(step, fluencyData) {
    State.successHandler.handleSuccessLesson(step);

    const currentLesson = appStore.getState().configData.lessons[appStore.getState().currentLessonIndex];
    const nextLessonId = currentLesson.nextLessonId;

    if (nextLessonId) {
        const finalStats = getCompressedLessonStats({
            isTextMode: appStore.getState().isTextMode,
            isCameraOff: appStore.getState().isCameraOff,
            lessonStartTime: State.lessonStartTime,
            averageWpm: State.averageWpm,
            totalPauses: State.totalPauses,
            totalHesitations: State.totalHesitations,
            recognizedIdioms: State.recognizedIdioms,
            pragmaticFlags: State.pragmaticFlags,
            interactionLog: State.interactionLog
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


