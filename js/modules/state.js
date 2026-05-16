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

    get currentQuestionIndex() { return appStore.getState().currentQuestionIndex; },
    set currentQuestionIndex(val) { appStore.setState({ currentQuestionIndex: val }); },

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
    questionCount: 0,
    questionsAnswered: 0,
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
        }
    },

    // Helpers to quickly reset state
    resetForNewLesson() {
        // Reset reactive metrics in the Zustand store
        appStore.getState().resetForNewLesson();
        // Clear history arrays in the Zustand store
        appStore.getState().resetLessonHistory();

        // Reset question index to 0 for a fresh start
        this.currentQuestionIndex = 0;

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
        this.questionCount = 0;
        this.questionsAnswered = 0;
        this.isTextMode = false;
    },

    resetForNextQuestion() {
        // Reset reactive metrics in the Zustand store
        appStore.getState().resetForNextQuestion();
        // Reset non-reactive per-question data
        this.wordsRevealed = 0;
        this.videoPlays = 0;
        this.videoClicks = 0;
        this.isPlaybackMuted = false;
    }
};