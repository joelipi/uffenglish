// --- modules/store.js ---
// Zustand vanilla store for reactive UI metrics.
// This store holds ONLY the five values that drive persistent on-screen indicators.
// All other application state (lesson data, config, player refs, flags) remains in state.js.

import { createStore } from 'https://esm.sh/zustand/vanilla';

export const appStore = createStore((set, get) => ({
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

    // --- Actions ---

    // Update fluency metrics
    setFluencyMetrics: (metrics) => set({
        ...metrics
    }),

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
        incorrectAttempts: 0
    })
}));
