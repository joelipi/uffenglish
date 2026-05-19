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
            userFirstName: null,

            // --- Reactive UI Metrics ---
            listeningScore: 100,
            incorrectAttempts: 0,
            whisperRejections: 0,
            dayCount: 0,
            currentStreak: 0,
            lessonsCompleted: 0,
            lastLessonFluencyAvg: null,
            fluencyImproving: false,
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
            currentQuestionIndex: 0,
            cuesGiven: [],
            repeatPointsHistory: [],
            rolePlayPointsHistory: [],

            // --- Tutor Engagement Metrics ---
            userMessagesToAi: 0,
            aIMessagesToUser: 0,
            userMessagesToAiWordCount: 0,
            aIMessagesToUserWordCount: 0,

            // --- Actions ---

            // Set Session Flags
            setDemoMode: (val) => set({ isDemoMode: val }),
            setWhisperReady: (val) => set({ isWhisperReady: val }),
            setUserFirstName: (val) => set({ userFirstName: val }),

            // Update physical place in the lesson
            setProgress: ({ lessonId, lessonIndex, questionIndex }) => set({
                activeLessonId: lessonId,
                currentLessonIndex: lessonIndex,
                currentQuestionIndex: questionIndex
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

            // Increment Tutor Engagement Stats
            incrementUserTutorStats: (wordCount) => set((state) => ({
                userMessagesToAi: state.userMessagesToAi + 1,
                userMessagesToAiWordCount: state.userMessagesToAiWordCount + (Number(wordCount) || 0)
            })),
            incrementAiTutorStats: (wordCount) => set((state) => ({
                aIMessagesToUser: state.aIMessagesToUser + 1,
                aIMessagesToUserWordCount: state.aIMessagesToUserWordCount + (Number(wordCount) || 0)
            })),

            resetForNextQuestion: () => set({
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
                currentQuestionIndex: state.currentQuestionIndex,
                fluencyScore: state.fluencyScore,
                flowScore: state.flowScore,
                vocabularyScore: state.vocabularyScore,
                grammarScore: state.grammarScore,
                formalityScore: state.formalityScore,
                nativeLikeScore: state.nativeLikeScore,
                understandingScore: state.understandingScore,
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