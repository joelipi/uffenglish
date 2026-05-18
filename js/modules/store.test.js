import { describe, it, expect, beforeEach } from 'vitest';
import { appStore } from './store.js';

describe('Zustand App Store', () => {
    beforeEach(() => {
        // Reset the store to default state before each test using native methods to not clear functions
        appStore.setState({
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
            activeLessonId: null,
            currentLessonIndex: 0,
            currentScreenIndex: 0,
            cuesGiven: [],
            repeatPointsHistory: [],
            rolePlayPointsHistory: []
        });
    });

    it('should correctly set progress', () => {
        appStore.getState().setProgress({ lessonId: 'lesson_1', lessonIndex: 1, screenIndex: 2 });
        const state = appStore.getState();
        expect(state.activeLessonId).toBe('lesson_1');
        expect(state.currentLessonIndex).toBe(1);
        expect(state.currentScreenIndex).toBe(2);
    });

    it('should deduct listening and speaking scores without going below 0', () => {
        appStore.getState().deductListeningScore(30);
        expect(appStore.getState().listeningScore).toBe(70);

        appStore.getState().deductListeningScore(80); // Should floor at 0
        expect(appStore.getState().listeningScore).toBe(0);

        appStore.getState().deductSpeakingScore(10);
        expect(appStore.getState().speakingScore).toBe(90);

        appStore.getState().deductSpeakingScore(100); // Should floor at 0
        expect(appStore.getState().speakingScore).toBe(0);
    });

    it('should handle undefined values when deducting points', () => {
        appStore.getState().deductListeningScore(undefined);
        expect(appStore.getState().listeningScore).toBe(100);

        appStore.getState().deductSpeakingScore(NaN);
        expect(appStore.getState().speakingScore).toBe(100);
    });

    it('should increment incorrect attempts', () => {
        appStore.getState().incrementIncorrectAttempts();
        expect(appStore.getState().incorrectAttempts).toBe(1);

        appStore.getState().incrementIncorrectAttempts();
        expect(appStore.getState().incorrectAttempts).toBe(2);
    });

    it('should reset per-screen metrics correctly', () => {
        appStore.setState({
            listeningScore: 50,
            speakingScore: 40,
            incorrectAttempts: 2
        });

        appStore.getState().resetForNextScreen();

        const state = appStore.getState();
        expect(state.listeningScore).toBe(100);
        expect(state.speakingScore).toBe(100);
        expect(state.incorrectAttempts).toBe(0);
    });

    it('should set fluency metrics partially', () => {
        appStore.getState().setFluencyMetrics({
            fluencyScore: 85,
            grammarScore: 90
        });

        const state = appStore.getState();
        expect(state.fluencyScore).toBe(85);
        expect(state.grammarScore).toBe(90);
        expect(state.flowScore).toBe(100); // Unchanged
    });
});