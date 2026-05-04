// --- modules/store.js ---
// Zustand vanilla store for reactive UI metrics.
// This store holds ONLY the five values that drive persistent on-screen indicators.
// All other application state (lesson data, config, player refs, flags) remains in state.js.

import { createStore } from 'https://esm.sh/zustand/vanilla';

export const appStore = createStore((set, get) => ({
    // --- Reactive UI Metrics ---
    currentPoints: 100,
    speakingScore: 100,
    incorrectAttempts: 0,
    dayCount: 0,
    currentStreak: 0,

    // --- Actions ---

    // Deduct from currentPoints, floored at 0
    deductPoints: (amount) => set((state) => ({
        currentPoints: Math.max(0, state.currentPoints - amount)
    })),

    // Set currentPoints to an explicit value (used when zeroing out on hard fail)
    setPoints: (value) => set({ currentPoints: Math.max(0, value) }),

    // Deduct from speakingScore, floored at 0
    deductSpeakingScore: (amount) => set((state) => ({
        speakingScore: Math.max(0, state.speakingScore - amount)
    })),

    // Set speakingScore to an explicit value
    setSpeakingScore: (value) => set({ speakingScore: Math.max(0, value) }),

    // Increment incorrectAttempts by 1
    incrementIncorrectAttempts: () => set((state) => ({
        incorrectAttempts: state.incorrectAttempts + 1
    })),

    // Update dayCount and currentStreak together (always updated as a pair)
    setActivityMetrics: (dayCount, currentStreak) => set({ dayCount, currentStreak }),

    // Reset all per-question metrics (called between questions)
    resetForNextQuestion: () => set({
        currentPoints: 100,
        speakingScore: 100,
        incorrectAttempts: 0
    }),

    // Reset all per-lesson metrics (called at lesson start)
    resetForNewLesson: () => set({
        currentPoints: 100,
        speakingScore: 100,
        incorrectAttempts: 0
    })
}));
