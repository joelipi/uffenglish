import { describe, it, expect, beforeEach, vi } from 'vitest';
import { State } from './state.js';
import { appStore } from './store.js';

describe('State Module', () => {
    beforeEach(() => {
        State.resetForNewLesson();
        vi.clearAllMocks();
    });

    it('should set and get values from appStore correctly', () => {
        State.currentLessonIndex = 5;
        expect(appStore.getState().currentLessonIndex).toBe(5);
        expect(State.currentLessonIndex).toBe(5);

        State.currentQuestionIndex = 3;
        expect(appStore.getState().currentQuestionIndex).toBe(3);
        expect(State.currentQuestionIndex).toBe(3);

        const cues = ['cue1', 'cue2'];
        State.cuesGiven = cues;
        expect(appStore.getState().cuesGiven).toEqual(cues);
        expect(State.cuesGiven).toEqual(cues);

        State.repeatPointsHistory = [100, 80];
        expect(appStore.getState().repeatPointsHistory).toEqual([100, 80]);
        expect(State.repeatPointsHistory).toEqual([100, 80]);

        State.rolePlayPointsHistory = [90, 70];
        expect(appStore.getState().rolePlayPointsHistory).toEqual([90, 70]);
        expect(State.rolePlayPointsHistory).toEqual([90, 70]);
    });

    describe('initializeUserMetrics', () => {
        it('should initialize metrics correctly for a regular user with first_name', () => {
            const userData = {
                english_level: 'B1',
                first_name: 'John',
                completed_dates: ['2023-10-01', '2023-10-02'],
                lessons_completed: 5,
                total_fluency_sum: 450,
                recent_fluency_avgs: [90, 90, 90, 90, 90],
                counted_lessons: ['lesson1']
            };
            const mockStreakCalculator = vi.fn().mockReturnValue(2);

            State.initializeUserMetrics(userData, mockStreakCalculator);

            expect(State.userData).toEqual(userData);
            expect(State.englishLevel).toBe('B1');

            const storeState = appStore.getState();
            expect(storeState.userFirstName).toBe('John');
            expect(storeState.dayCount).toBe(2);
            expect(storeState.currentStreak).toBe(2);
            expect(storeState.lessonsCompleted).toBe(5);
            expect(storeState.totalFluencySum).toBe(450);
            expect(storeState.recentFluencyAvgs).toEqual([90, 90, 90, 90, 90]);
            expect(storeState.countedLessons).toEqual(['lesson1']);
            expect(mockStreakCalculator).toHaveBeenCalledWith(userData.completed_dates);
        });

        it('should initialize metrics correctly for a regular user using display_name', () => {
            const userData = {
                display_name: 'Jane Smith',
            };
            const mockStreakCalculator = vi.fn();

            State.initializeUserMetrics(userData, mockStreakCalculator);

            const storeState = appStore.getState();
            expect(storeState.userFirstName).toBe('Jane');
        });

        it('should handle guest user properly with Guest User display name', () => {
             const userData = {
                display_name: 'Guest User',
                english_level: 'A1'
            };
            const mockStreakCalculator = vi.fn();

            State.initializeUserMetrics(userData, mockStreakCalculator);

            expect(State.englishLevel).toBe('A1');
            expect(appStore.getState().userFirstName).toBeNull();
            expect(mockStreakCalculator).not.toHaveBeenCalled();
        });

        it('should default to A0 if no english_level', () => {
             State.initializeUserMetrics({}, vi.fn());
             expect(State.englishLevel).toBe('A0');
        });

        it('should handle null userData', () => {
             State.initializeUserMetrics(null, vi.fn());
             expect(State.userData).toBeNull();
             expect(State.englishLevel).toBe('A0');
        });
    });

    describe('resetForNewLesson', () => {
        it('should reset all lesson specific state', () => {
            // Set some dirty state
            State.interactionLog = ['test'];
            State.currentQuestionIndex = 5;
            State.mission = 'Test Mission';
            State.isTextMode = true;
            State.totalHesitations = 10;
            State.totalPauses = 5;
            State.averageWpm = 100;
            State.questionCount = 5;
            State.questionsAnswered = 3;

            State.resetForNewLesson();

            expect(State.interactionLog).toEqual([]);
            expect(State.currentQuestionIndex).toBe(0);
            expect(State.mission).toBeNull();
            expect(State.isTextMode).toBe(false);
            expect(State.recognizedIdioms).toEqual([]);
            expect(State.totalHesitations).toBe(0);
            expect(State.totalPauses).toBeNull();
            expect(State.averageWpm).toBeNull();
            expect(State.questionCount).toBe(0);
            expect(State.questionsAnswered).toBe(0);
        });
    });

    describe('resetForNextQuestion', () => {
        it('should reset question specific state', () => {
            State.wordsRevealed = 5;
            State.videoPlays = 2;
            State.videoClicks = 1;
            State.isPlaybackMuted = true;

            State.resetForNextQuestion();

            expect(State.wordsRevealed).toBe(0);
            expect(State.videoPlays).toBe(0);
            expect(State.videoClicks).toBe(0);
            expect(State.isPlaybackMuted).toBe(false);
        });
    });
});
