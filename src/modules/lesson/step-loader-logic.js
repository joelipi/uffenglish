/**
 * Step Loader Logic - Core step loading and rendering logic
 *
 * Pure functions for loading and rendering steps.
 * No DOM manipulation - just state management and logic.
 * Can be used by both web and React Native.
 */

import { appStore, setCurrentVideoPlayer } from '../store/store.js';
import Strings from '../../data/strings.js';
import { loadVideoForStep } from '../video/video-loader.js';
import { resolveConfigLanguage } from '../bilingual/config-normalizer.js';
import { Media } from '../media/media.js';
import { saveLessonProgress } from '../user/user-profile.js';
import { resolveFriendCredit } from '../user/friend-credit-logic.js';
import { stashPendingFriendCredit } from '../user/friend-credit-sync.js';
import { recordFriendCompletion } from '../api/api.js';
import { getCompressedLessonStats } from '../answer/scoring.js';
import { calculateLessonAverage, detectFluencyTrend } from './success-lesson-logic.js';
import { setTextInputSubmitCallback } from './step-loader-callbacks.js';
import { trackEvent } from '../utils/posthog.js';

// --- Warning Clear Timer (no DOM) ---

let _warningClearTimer = null;

export function clearWarningLater(ms) {
    clearTimeout(_warningClearTimer);
    _warningClearTimer = setTimeout(() => {
        appStore.getState().setSystemMessage(null);
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
    appStore.getState().clearPlaybackBlob();
    appStore.getState().clearRecordedAudioPeaks();
    appStore.getState().setCurrentVideo(null);

    appStore.getState().setMediaVisible(true);

    loadVideoForStep(step, null, resolveConfigLanguage(appStore.getState().guestNativeLanguage, appStore.getState().userData?.native_language));

    appStore.getState().setSystemMessage({ type: 'info', text: step.step });
}

// --- Text Step Handling ---

export function handleTextStep(step, submitAnswerPrecheck) {
    appStore.getState().setTextInputPlaceholder(
        Strings.get('placeholder_type_answer', appStore.getState().userData?.native_language) || 'Type your answer here...'
    );
    setTextInputSubmitCallback(
        (val, btn) => submitAnswerPrecheck(val, typeof step.cue === 'object' ? step.cue.en : step.cue, step, btn, step.explanation, { pauseCount: null, netDuration: null })
    );
}

// --- Lesson Complete ---

export function handleLessonComplete(step, showFeedbackAndProceed) {
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

    if (step.simpleVideoUrl) {
        loadVideoForStep(step, null, resolveConfigLanguage(state.guestNativeLanguage, state.userData?.native_language));
    }

    trackEvent('unit_complete', {
        lesson_id: lessonId,
        fluency_average: lessonAverage,
        is_improving: isImproving,
    });

    state.setSuccessScreen(lessonId, fluencyDataObj);
    state.setProgressPercent("100%");
    state.transitionTo('lessonSuccess', { lessonId, fluencyData: fluencyDataObj }, { fromStepLoad: true });
}

// --- Success Step Rendering ---

// Mirrors the login gate in SuccessButtons (VideoButton.isUserLoggedIn): a
// real Supabase session, not the synthetic guest object.
function isAuthenticatedUser(userData, isLoggedIn) {
    return !!isLoggedIn
        && userData?.auth_method === 'supabase'
        && !!userData?.$id
        && userData.$id !== 'guest';
}

export function handleSuccessStep(step, fluencyData) {
    const state = appStore.getState();
    const lessonAverage = calculateLessonAverage(state);
    const isImproving = detectFluencyTrend(lessonAverage, state.recentFluencyAvgs || []);
    
    const fluencyDataObj = { total: lessonAverage };
    state.setLastSuccessFluencyData(fluencyDataObj);
    state.setFluencyImproving(isImproving);
    state.setLastLessonFluencyAvg(lessonAverage);

    trackEvent('lesson_complete', {
        lesson_id: step.lessonId,
        course_id: state.courseId,
        fluency_average: lessonAverage,
        is_improving: isImproving,
        step_count: state.stepCount,
        total_interactions: state.interactionLog?.length,
        is_text_mode: state.isTextMode,
    });
    
    if (isImproving) {
        console.log(`[Gamification] ✅ Fluency improving! Last-10 avg: ${state.recentFluencyAvgs?.reduce((a, b) => a + b, 0) / (state.recentFluencyAvgs?.length || 1)}% → Current: ${lessonAverage}%`);
    }

    // The success clip is already mounted by handleStepCore, which runs before
    // this handler (loadStepOrchestrate: handleStepCore → onSuccess). Reloading
    // it here sets currentVideo(null) → the video a second time and can remount
    // the <video>, which drops the iOS autoplay attempt (and the transient
    // activation it depends on). Only hide the media area when there is no clip.
    if (!step.simpleVideoUrl) {
        state.setMediaVisible(false);
    }
    state.setSuccessScreen(step.lessonId, fluencyDataObj);
    state.setProgressPercent("100%");
    // Landing on the success step directly (page load / reload / the signup
    // redirect) has no user gesture, so the success clip cannot autoplay and
    // `ended` never fires. Reveal the overlay + button immediately in that case.
    // When the step was advanced to in-app, the clip plays and handleEnded
    // reveals on completion.
    const successPhase = state.stepLoadedFromRestore ? 'lessonSuccess-decisionTime' : 'lessonSuccess';
    state.transitionTo(successPhase, { lessonId: step.lessonId, fluencyData: fluencyDataObj }, { fromStepLoad: true });

    const currentLesson = state.configData.lessons[state.currentLessonIndex];
    const nextLessonId = currentLesson.nextLessonId;
    // The lesson that just finished is the one we count. It is NOT necessarily
    // `nextLessonId`: a terminal lesson (no next) — e.g. every friend-practice
    // lesson a/b — must still increment the profile's completed count.
    const completedLessonId = currentLesson.lessonId || step.lessonId;

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

    // Persist the completion — with or without a next lesson — so every
    // completed lesson advances the resume state. The COUNT advances only for
    // genuine completions: the success step is also landed on directly (page
    // load, reload, signup redirect — `stepLoadedFromRestore`), which is not a
    // completion and must never count. Re-traversing the lesson in-app (Repeat,
    // re-doing it with friends) always arrives with the flag false and counts —
    // repeats earn credit. The resume target stays the next lesson when there
    // is one, else the lesson just completed.
    const completedInApp = !state.stepLoadedFromRestore;
    saveLessonProgress(state.courseId, nextLessonId || completedLessonId, state.userData, {
        updateUserMeta: true,
        incrementCount: completedInApp,
        completedLessonId,
        lessonStats: finalStats,
        currentLessonId: completedLessonId
    }).then(progressResult => {
        state.setActivityMetrics(progressResult.newDayCount, progressResult.newStreak);
        // Re-sync the store even when the count did not change (a repeated
        // completion), so the in-session value matches the profile row.
        if (progressResult.lessonsCompleted) {
            state.setLessonsCompleted(progressResult.lessonsCompleted);
        }
    });

    // Friend-completion credit for the share-link owner. Only genuine
    // in-app completions qualify (the same phantom guard as the count).
    // Authenticated completers record immediately, fail-open; guests have no
    // user id yet, so their credit is stashed and the signup/login flush
    // sends it once the account exists.
    const friendCredit = resolveFriendCredit({
        configData: state.configData,
        lessonId: completedLessonId,
        courseId: state.courseId,
        ownerShareCode: state.friendCode,
        actorShareCode: state.userData?.shareCode || state.userData?.share_code,
        completedInApp,
    });
    if (friendCredit) {
        if (isAuthenticatedUser(state.userData, state.isLoggedIn)) {
            void recordFriendCompletion(friendCredit);
        } else {
            stashPendingFriendCredit(friendCredit);
        }
    }
}
