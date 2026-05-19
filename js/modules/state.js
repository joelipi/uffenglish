// --- modules/state.js ---

import { appStore } from './store.js';

export const State = {
    // Application & User Data

    // Logic-driven values

    isAudioEnabled: false,

    interactionLog: [],
    recognizedIdioms: [],
    pragmaticFlags: [],
    totalHesitations: 0,
    totalPauses: null,
    averageWpm: null,

    // Lesson Data
    mission: null,
    setting: null,
    roleOther: null,
    roleUser: null,
    userRole: null,
    videoRole: null,
    successHandler: null,

    // Getters/Setters for properties that moved to appStore (persistence & reactivity)
    get currentLessonIndex() { return appStore.getState().currentLessonIndex; },
    set currentLessonIndex(val) { appStore.setState({ currentLessonIndex: val }); },

    get currentStepIndex() { return appStore.getState().currentStepIndex; },
    set currentStepIndex(val) { appStore.setState({ currentStepIndex: val }); },

    get cuesGiven() { return appStore.getState().cuesGiven; },
    set cuesGiven(val) { appStore.setState({ cuesGiven: val }); },

    get repeatPointsHistory() { return appStore.getState().repeatPointsHistory; },
    set repeatPointsHistory(val) { appStore.setState({ repeatPointsHistory: val }); },

    get rolePlayPointsHistory() { return appStore.getState().rolePlayPointsHistory; },
    set rolePlayPointsHistory(val) { appStore.setState({ rolePlayPointsHistory: val }); },

    // Dynamic properties (initialized in app.js or initializeLesson)
    courseId: null,
    configData: null,
    userData: null,
    englishLevel: 'A0',
    apiRoot: null,

    // Engagement Tracking
    stepCount: 0,
    stepsAnswered: 0,
    wordsRevealed: 0,
    videoPlays: 0,
    videoClicks: 0,
    isPlaybackMuted: false,

    // Active Media Player Reference
    player: null,
    isCameraOff: false,
    isTextMode: false,

    /**
     * Initializes the state with values calculated from Appwrite userData
     * @param {Object} userData - The profile document from Appwrite
     * @param {Function} streakCalculator - The calculateCurrentStreak function from userProfile.js
     */
    initializeUserMetrics(userData, streakCalculator) {
        this.userData = userData;
        // Map the Appwrite 'english_level' to your State
        this.englishLevel = userData?.english_level || 'A0';

        if (userData) {
            const isGuest = userData.auth_method === 'guest' || userData.display_name === 'Guest User';
            const firstName = isGuest ? null : (userData.first_name || (userData.display_name ? userData.display_name.split(' ')[0] : null));
            appStore.getState().setUserFirstName(firstName);

            if (Array.isArray(userData.completed_dates)) {
                // dayCount and currentStreak now live in the Zustand store
                const dayCount = userData.completed_dates.length;
                const currentStreak = streakCalculator(userData.completed_dates);
                appStore.getState().setActivityMetrics(dayCount, currentStreak);
            }

            // Initialize new gamification metrics
            const lessonsCompleted = Number(userData.lessons_completed || 0);
            appStore.getState().setLessonsCompleted(lessonsCompleted);
            console.log(`[Gamification] Initialized lessonsCompleted: ${lessonsCompleted}`);

            appStore.getState().setTotalFluencySum(Number(userData.total_fluency_sum || 0));
            appStore.getState().setRecentFluencyAvgs(userData.recent_fluency_avgs || []);
            appStore.getState().setCountedLessons(userData.counted_lessons || []);
        }
    },

    // Helpers to quickly reset state
    resetForNewLesson() {
        // Reset reactive metrics in the Zustand store
        appStore.getState().resetForNewLesson();
        // Clear history arrays in the Zustand store
        appStore.getState().resetLessonHistory();

        // Reset step index to 0 for a fresh start
        this.currentStepIndex = 0;

        this.interactionLog = [];
        this.recognizedIdioms = [];
        this.pragmaticFlags = [];
        this.totalHesitations = 0;
        this.totalPauses = null;
        this.averageWpm = null;

        // Reset non-reactive lesson data
        this.mission = null;
        this.setting = null;
        this.roleOther = null;
        this.roleUser = null;
        this.userRole = null;
        this.videoRole = null;
        this.wordsRevealed = 0;
        this.videoPlays = 0;
        this.videoClicks = 0;
        this.stepCount = 0;
        this.stepsAnswered = 0;
        this.isTextMode = false;
    },

    resetForNextStep() {
        // Reset reactive metrics in the Zustand store
        appStore.getState().resetForNextStep();
        // Reset non-reactive per-step data
        this.wordsRevealed = 0;
        this.videoPlays = 0;
        this.videoClicks = 0;
        this.isPlaybackMuted = false;
    }
};