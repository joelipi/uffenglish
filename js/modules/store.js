// --- modules/store.js ---
// Zustand vanilla store for reactive UI metrics.
// This store holds the 12 values that drive persistent on-screen indicators.
// All other application state (lesson data, config, player refs, flags) remains in state.js.

import { createStore } from 'https://esm.sh/zustand/vanilla';
import { persist } from 'https://esm.sh/zustand/middleware';

export const appStore = createStore(
    persist(
        (set, get) => ({
            // --- Reactive UI Metrics ---
            listeningScore: 100,
            speakingScore: 100,
            incorrectAttempts: 0,
            dayCount: 0,
            currentStreak: 0,
            fluencyScore: 100,
            flowScore: 100,
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

            // --- Actions ---

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

            // Deduct from speakingScore, floored at 0
            deductSpeakingScore: (amount) => set((state) => {
                const safeAmount = Number(amount) || 0;
                return { speakingScore: Math.max(0, state.speakingScore - safeAmount) };
            }),

            // Set speakingScore to an explicit value
            setSpeakingScore: (value) => set({
                speakingScore: Math.max(0, Number(value) || 0)
            }),

            // Increment incorrectAttempts by 1
            incrementIncorrectAttempts: () => set((state) => ({
                incorrectAttempts: state.incorrectAttempts + 1
            })),

            // Update dayCount and currentStreak together
            setActivityMetrics: (dayCount, currentStreak) => set({
                dayCount: Number(dayCount) || 0,
                currentStreak: Number(currentStreak) || 0
            }),

            // Reset all per-question metrics (called between questions)
            resetForNextQuestion: () => set({
                listeningScore: 100,
                speakingScore: 100,
                incorrectAttempts: 0
            }),

            // Reset all per-lesson metrics (called at lesson start)
            resetForNewLesson: () => set({
                listeningScore: 100,
                speakingScore: 100,
                incorrectAttempts: 0,
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
                rolePlayPointsHistory: state.rolePlayPointsHistory
            })
        }
    )
);