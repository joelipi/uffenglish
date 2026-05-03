// --- modules/state.js ---

export const State = {
    // Application & User Data
    courseId: null,
    configData: null,
    userData: null,
    englishLevel: 'A0', // FIXED: Standardized to camelCase
    
    // Logic-driven values
    dayCount: 0, 
    currentStreak: 0,
    
    isAudioEnabled: false,

    // Lesson Data
    lessonId: null,
    lesson: null,
    mission: null,
    setting: null,
    roleA: null,
    roleB: null,
    userRole: null,
    videoRole: null,
    currentLessonIndex: 0,
    currentQuestionIndex: 0,
    successHandler: null,

    // Scoring & Metrics
    currentPoints: 100,
    speakingScore: 100,
    incorrectAttempts: 0,
    cuesGiven: [],
    repeatPointsHistory: [],
    rolePlayPointsHistory: [],
    
    // Engagement Tracking
    questionCount: 0,
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
            this.dayCount = userData.completed_dates.length;
            this.currentStreak = streakCalculator(userData.completed_dates);
        }
    },

    // Helpers to quickly reset state
    resetForNewLesson() {
        this.mission = null;
        this.setting = null;
        this.roleA = null;
        this.roleB = null;
        this.userRole = null;
        this.videoRole = null;
        this.currentPoints = 100;
        this.speakingScore = 100;
        this.currentQuestionIndex = 0;
        this.incorrectAttempts = 0;
        this.cuesGiven = [];
        this.repeatPointsHistory = [];
        this.rolePlayPointsHistory = [];
        this.wordsRevealed = 0;
        this.videoPlays = 0;
        this.videoClicks = 0;
        this.questionCount = 0;
    },

    resetForNextQuestion() {
        this.currentPoints = 100;
        this.speakingScore = 100;
        this.incorrectAttempts = 0;
        this.wordsRevealed = 0;
        this.videoPlays = 0;
        this.videoClicks = 0;
        this.isPlaybackMuted = false;
    }
};