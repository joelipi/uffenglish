// --- modules/state.js ---

import { appStore } from './store.js';

export const State = {
    // Application & User Data
    
    // Logic-driven values
    
    isAudioEnabled: false,

    // Lesson Data
    mission: null,
    setting: null,
    roleA: null,
    roleB: null,
    userRole: null,
    videoRole: null,
    successHandler: null,
    
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

    /**
     * Initializes the state with values calculated from Appwrite userData
     * @param {Object} userData - The profile document from Appwrite
     * @param {Function} streakCalculator - The calculateCurrentStreak function from userProfile.js
     */
    initializeUserMetrics(userData, streakCalculator) {
        this.userData = userData;
        // Map the Appwrite 'english_level' to your State
        this.englishLevel = userData?.english_level || 'A0'; 

        if (userData && Array.isArray(userData.completed_dates)) {
            // dayCount and currentStreak now live in the Zustand store
            const dayCount = userData.completed_dates.length;
            const currentStreak = streakCalculator(userData.completed_dates);
            appStore.getState().setActivityMetrics(dayCount, currentStreak);
        }
    },

    // Helpers to quickly reset state
    resetForNewLesson() {
        // Reset reactive metrics in the Zustand store
        appStore.getState().resetForNewLesson();
        // Clear history arrays in the Zustand store
        appStore.getState().resetLessonHistory();
        // Reset non-reactive lesson data
        this.mission = null;
        this.setting = null;
        this.roleA = null;
        this.roleB = null;
        this.userRole = null;
        this.videoRole = null;
        this.wordsRevealed = 0;
        this.videoPlays = 0;
        this.videoClicks = 0;
        this.questionCount = 0;
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