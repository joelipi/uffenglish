import { appStore } from './store.js';

function get() { return appStore.getState(); }

export const State = {
    get isAudioEnabled() { return get().isAudioEnabled; },
    set isAudioEnabled(v) { get().setAudioEnabled(v); },

    get interactionLog() { return get().interactionLog; },
    set interactionLog(v) { get().setInteractionLog(v); },

    get recognizedIdioms() { return get().recognizedIdioms; },
    set recognizedIdioms(v) { get().setInteractionLog(v); },

    get pragmaticFlags() { return get().pragmaticFlags; },
    set pragmaticFlags(v) { get().clearPragmaticFlags(); if (v) v.forEach(f => get().addPragmaticFlag(f)); },

    get totalHesitations() { return get().totalHesitations; },
    set totalHesitations(v) { get().setTotalHesitations(v); },

    get totalPauses() { return get().totalPauses; },
    set totalPauses(v) { get().setTotalPauses(v); },

    get averageWpm() { return get().averageWpm; },
    set averageWpm(v) { get().setAverageWpm(v); },

    get mission() { return get().mission; },
    set mission(v) { get().setMission(v); },

    get setting() { return get().setting; },
    set setting(v) { get().setSetting(v); },

    get roleOther() { return get().roleOther; },
    set roleOther(v) { get().setRoleOther(v); },

    get roleUser() { return get().roleUser; },
    set roleUser(v) { get().setUserRole(v); },

    get userRole() { return get().userRole; },
    set userRole(v) { get().setUserRole(v); },

    get videoRole() { return get().videoRole; },
    set videoRole(v) { get().setVideoRole(v); },

    get successHandler() { return get().successHandler; },
    set successHandler(v) { get().setSuccessHandler(v); },

    get stepCount() { return get().stepCount; },
    set stepCount(v) { get().setStepCount(v); },

    get stepsAnswered() { return get().stepsAnswered; },
    set stepsAnswered(v) { get().setStepsAnswered(v); },

    get wordsRevealed() { return get().wordsRevealed; },
    set wordsRevealed(v) { get().setWordsRevealed(v); },

    get videoPlays() { return get().videoPlays; },
    set videoPlays(v) { get().setVideoPlays(v); },

    get videoClicks() { return get().videoClicks; },
    set videoClicks(v) { get().setVideoClicks(v); },

    get player() { return get().currentVideoPlayer; },
    set player(v) { get().setCurrentVideoPlayer(v); },

    get lessonStartTime() { return get().lessonStartTime; },
    set lessonStartTime(v) { get().setLessonStartTime(v); },

    initializeUserMetrics(userData, streakCalculator) {
        appStore.getState().setCourseData({
            userData,
            englishLevel: userData?.english_level || 'A0'
        });

        if (userData) {
            const isGuest = userData.auth_method === 'guest' || userData.display_name === 'Guest User';
            const firstName = isGuest ? null : (userData.first_name || (userData.display_name ? userData.display_name.split(' ')[0] : null));
            appStore.getState().setUserFirstName(firstName);

            if (Array.isArray(userData.completed_dates)) {
                const dayCount = userData.completed_dates.length;
                const currentStreak = streakCalculator(userData.completed_dates);
                appStore.getState().setActivityMetrics(dayCount, currentStreak);
            }

            const lessonsCompleted = Number(userData.lessons_completed || 0);
            appStore.getState().setLessonsCompleted(lessonsCompleted);
            appStore.getState().setTotalFluencySum(Number(userData.total_fluency_sum || 0));
            appStore.getState().setRecentFluencyAvgs(userData.recent_fluency_avgs || []);
            appStore.getState().setCountedLessons(userData.counted_lessons || []);
        }
    },

    resetForNewLesson() {
        appStore.getState().resetForNewLesson();
        appStore.getState().resetLessonHistory();
        appStore.setState({ currentStepIndex: 0 });
        appStore.getState().resetLessonState();
    },

    resetForNextStep() {
        appStore.getState().resetForNextStep();
        appStore.getState().resetStepState();
    }
};
