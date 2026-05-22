// --- modules/store.js ---
// Zustand vanilla store for reactive UI metrics.
// This store holds the values that drive persistent on-screen indicators and session states.
// All other application state (lesson data, config, player refs, flags) remains in state.js.

import { createStore } from 'zustand/vanilla';
import { persist } from 'zustand/middleware';

export const appStore = createStore(
    persist(
        (set, get) => ({
            // --- Session Flags (Not Persisted) ---
            isDemoMode: false,
            isWhisperReady: false,
            isMicActive: false,
            isTextMode: false,
            isGuestModalOpen: false,
            criticalErrorMessage: null,
            userFirstName: null,
            userData: null,
            configData: null,
            courseId: null,
            englishLevel: 'A0',
            currentVideo: null,
            chatHistory: [],

            // --- Reactive UI Metrics ---
            listeningScore: 100,
            speakingScore: 100,
            incorrectAttempts: 0,
            whisperRejections: 0,
            dayCount: 0,
            currentStreak: 0,
            lessonsCompleted: 0,
            lastLessonFluencyAvg: null,
            fluencyImproving: false,
            totalFluencySum: 0,
            recentFluencyAvgs: [],
            countedLessons: [],
            fluencyScore: 100,
            flowScore: 100,
            hesitationMs: 0,
            vocabularyScore: 100,
            grammarScore: 100,
            formalityScore: 100,
            nativeLikeScore: 100,
            understandingScore: 100,

            // --- Persisted Progress & History ---
            activeLessonId: null,
            currentLessonIndex: 0,
            currentStepIndex: 0,
            cuesGiven: [],
            repeatPointsHistory: [],
            rolePlayPointsHistory: [],

            // --- UI State (Replaced ui.js functions) ---
            progressPercent: 0,
            statsVisible: true,
            micStatusText: '',
            isLoaded: false,
            hintsVisible: false,
            hangmanHintHTML: '',
            bottomControlState: 'mic',

            // --- Tutor Engagement Metrics ---
            userMessagesToAi: 0,
            aIMessagesToUser: 0,
            userMessagesToAiWordCount: 0,
            aIMessagesToUserWordCount: 0,

            // --- Actions ---

            // Set Session Flags
            setDemoMode: (val) => set({ isDemoMode: val }),
            setWhisperReady: (val) => set({ isWhisperReady: val }),
            setMicActive: (val) => set({ isMicActive: val }),
            setTextMode: (val) => set({ isTextMode: val }),
            setGuestModalOpen: (val) => set({ isGuestModalOpen: val }),
            setCriticalErrorMessage: (val) => set({ criticalErrorMessage: val }),

            addChatMessage: (msg) => set((state) => {
                const newMsg = {
                    id: msg.id !== undefined ? msg.id : Date.now() + Math.random(),
                    role: msg.role,
                    type: msg.type || 'standard',
                    content: msg.content,
                    ...msg
                };
                return { chatHistory: [...state.chatHistory, newMsg] };
            }),
            clearChatHistory: () => set({ chatHistory: [] }),
            removeAiLoadingMessage: () => set((state) => ({
                chatHistory: state.chatHistory.filter(msg => msg.type !== 'aiLoading')
            })),
            removeContinueWidget: () => set((state) => ({
                chatHistory: state.chatHistory.filter(msg => msg.type !== 'continueWidget')
            })),
            replaceLastMessage: (msg) => set((state) => {
                if (state.chatHistory.length === 0) {
                    const newMsg = {
                        id: msg.id !== undefined ? msg.id : Date.now() + Math.random(),
                        role: msg.role,
                        type: msg.type || 'standard',
                        content: msg.content,
                        ...msg
                    };
                    return { chatHistory: [newMsg] };
                }
                const newHistory = [...state.chatHistory];
                const lastMsg = newHistory[newHistory.length - 1];
                newHistory[newHistory.length - 1] = {
                    ...lastMsg,
                    ...msg
                };
                return { chatHistory: newHistory };
            }),
            setUserFirstName: (val) => set({ userFirstName: val }),
            setCourseData: (data) => set((state) => ({
                userData: data.userData !== undefined ? data.userData : state.userData,
                configData: data.configData !== undefined ? data.configData : state.configData,
                courseId: data.courseId !== undefined ? data.courseId : state.courseId,
                englishLevel: data.englishLevel !== undefined ? data.englishLevel : state.englishLevel,
            })),

            setCurrentVideo: (video) => {
                console.log(`[Store] setCurrentVideo: ${video ? video.type : 'null'}`);
                set({ currentVideo: video });
            },

            // --- UI State Actions (bridge for ui.js → React) ---
            setProgressPercent: (percent) => set({ progressPercent: percent }),
            setStatsVisible: (visible) => set({ statsVisible: visible }),
            setMicStatusText: (text) => set({ micStatusText: text }),
            setIsLoaded: (loaded) => set({ isLoaded: loaded }),
            setHintsVisible: (visible) => set({ hintsVisible: visible }),
            setHangmanHintHTML: (html) => set({ hangmanHintHTML: html }),
            setBottomControlState: (state) => set({ bottomControlState: state }),

            // Update physical place in the lesson
            setProgress: ({ lessonId, lessonIndex, questionIndex }) => set({
                activeLessonId: lessonId,
                currentLessonIndex: lessonIndex,
                currentStepIndex: questionIndex
            }),

            // Clear history arrays when a new lesson begins
            resetLessonHistory: () => set({
                cuesGiven: [],
                repeatPointsHistory: [],
                rolePlayPointsHistory: []
            }),

            // Update fluency metrics securely by filtering only expected keys
            setFluencyMetrics: (metrics) => set((state) => ({
                fluencyScore: metrics.fluencyScore !== undefined ? metrics.fluencyScore : state.fluencyScore,
                flowScore: metrics.flowScore !== undefined ? metrics.flowScore : state.flowScore,
                vocabularyScore: metrics.vocabularyScore !== undefined ? metrics.vocabularyScore : state.vocabularyScore,
                grammarScore: metrics.grammarScore !== undefined ? metrics.grammarScore : state.grammarScore,
                formalityScore: metrics.formalityScore !== undefined ? metrics.formalityScore : state.formalityScore,
                nativeLikeScore: metrics.nativeLikeScore !== undefined ? metrics.nativeLikeScore : state.nativeLikeScore,
                understandingScore: metrics.understandingScore !== undefined ? metrics.understandingScore : state.understandingScore
            })),

            // Deduct from listeningScore, floored at 0
            deductListeningScore: (amount) => set((state) => {
                const safeAmount = Number(amount) || 0; // Fallback to 0 if undefined/NaN
                return { listeningScore: Math.max(0, state.listeningScore - safeAmount) };
            }),

            // Set listeningScore to an explicit value
            setListeningScore: (value) => set({
                listeningScore: Math.max(0, Number(value) || 0)
            }),

            // Deduct from flowScore, floored at 0
            deductFlowScore: (amount) => set((state) => {
                const safeAmount = Number(amount) || 0;
                return { flowScore: Math.max(0, state.flowScore - safeAmount) };
            }),

            setHesitationMs: (ms) => set({ hesitationMs: Math.max(0, Number(ms) || 0) }),

            // Deduct from speakingScore, floored at 0
            deductSpeakingScore: (amount) => set((state) => {
                const safeAmount = Number(amount) || 0;
                return { speakingScore: Math.max(0, state.speakingScore - safeAmount) };
            }),

            // Set speakingScore to an explicit value
            setSpeakingScore: (value) => set({
                speakingScore: Math.max(0, Number(value) || 0)
            }),

            incrementIncorrectAttempts: () => set((state) => ({
                incorrectAttempts: state.incorrectAttempts + 1
            })),

            // Increment whisperRejections by 1
            incrementWhisperRejections: () => set((state) => ({
                whisperRejections: state.whisperRejections + 1
            })),

            // Update dayCount and currentStreak together
            setActivityMetrics: (dayCount, currentStreak) => set({
                dayCount: Number(dayCount) || 0,
                currentStreak: Number(currentStreak) || 0
            }),

            setLessonsCompleted: (count) => {
                const safeCount = Number(count) || 0;
                console.log(`[Gamification] Lessons completed updated: ${safeCount}`);
                set({ lessonsCompleted: safeCount });
            },
            setLastLessonFluencyAvg: (avg) => {
                console.log(`[Gamification] Last lesson fluency avg updated: ${avg}`);
                set({ lastLessonFluencyAvg: avg });
            },
            setFluencyImproving: (improving) => {
                console.log(`[Gamification] Fluency improving flag: ${!!improving}`);
                set({ fluencyImproving: !!improving });
            },
            setTotalFluencySum: (sum) => set({ totalFluencySum: Number(sum) || 0 }),
            setRecentFluencyAvgs: (avgs) => set({ recentFluencyAvgs: Array.isArray(avgs) ? avgs : [] }),
            setCountedLessons: (lessons) => set({ countedLessons: Array.isArray(lessons) ? lessons : [] }),

            // Increment Tutor Engagement Stats
            incrementUserTutorStats: (wordCount) => set((state) => ({
                userMessagesToAi: state.userMessagesToAi + 1,
                userMessagesToAiWordCount: state.userMessagesToAiWordCount + (Number(wordCount) || 0)
            })),
            incrementAiTutorStats: (wordCount) => set((state) => ({
                aIMessagesToUser: state.aIMessagesToUser + 1,
                aIMessagesToUserWordCount: state.aIMessagesToUserWordCount + (Number(wordCount) || 0)
            })),

            resetForNextStep: () => set({
                listeningScore: 100,
                speakingScore: 100,
                incorrectAttempts: 0,
                whisperRejections: 0,
                fluencyScore: 100,
                flowScore: 100,
                hesitationMs: 0,
                vocabularyScore: 100,
                grammarScore: 100,
                formalityScore: 100,
                nativeLikeScore: 100,
                understandingScore: 100
            }),

            // Reset all per-lesson metrics (called at lesson start)
            resetForNewLesson: () => set({
                listeningScore: 100,
                speakingScore: 100,
                incorrectAttempts: 0,
                whisperRejections: 0,
                fluencyScore: 100,
                flowScore: 100,
                vocabularyScore: 100,
                grammarScore: 100,
                formalityScore: 100,
                nativeLikeScore: 100,
                understandingScore: 100
            })
        }),
        {
            name: 'uff-lesson-storage',
            partialize: (state) => ({
                // Only these values are saved to localStorage. 
                // isDemoMode and isWhisperReady are safely ignored.
                activeLessonId: state.activeLessonId,
                currentLessonIndex: state.currentLessonIndex,
                currentStepIndex: state.currentStepIndex,
                fluencyScore: state.fluencyScore,
                flowScore: state.flowScore,
                vocabularyScore: state.vocabularyScore,
                grammarScore: state.grammarScore,
                formalityScore: state.formalityScore,
                nativeLikeScore: state.nativeLikeScore,
                understandingScore: state.understandingScore,
                totalFluencySum: state.totalFluencySum,
                recentFluencyAvgs: state.recentFluencyAvgs,
                countedLessons: state.countedLessons,
                cuesGiven: state.cuesGiven,
                repeatPointsHistory: state.repeatPointsHistory,
                rolePlayPointsHistory: state.rolePlayPointsHistory,
                userMessagesToAi: state.userMessagesToAi,
                aIMessagesToUser: state.aIMessagesToUser,
                userMessagesToAiWordCount: state.userMessagesToAiWordCount,
                aIMessagesToUserWordCount: state.aIMessagesToUserWordCount
            })
        }
    )
);

// Global bridge for legacy window.isMicActive
if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'isMicActive', {
        get() {
            return appStore.getState().isMicActive;
        },
        set(value) {
            appStore.getState().setMicActive(value);
        },
        configurable: true
    });
}