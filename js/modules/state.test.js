import { describe, it, expect, beforeEach, vi } from 'vitest';
import { State } from './state.js';
import { appStore } from './store.js';

describe('State Module', () => {
    beforeEach(() => {
        State.resetForNewLesson();
        vi.clearAllMocks();
    });

    it('should set and get values from appStore correctly', () => {
        appStore.setState({ currentLessonIndex: 5 });
        expect(appStore.getState().currentLessonIndex).toBe(5);

        appStore.setState({ currentStepIndex: 3 });
        expect(appStore.getState().currentStepIndex).toBe(3);

        const cues = ['cue1', 'cue2'];
        appStore.setState({ cuesGiven: cues });
        expect(appStore.getState().cuesGiven).toEqual(cues);

        appStore.setState({ repeatPointsHistory: [100, 80] });
        expect(appStore.getState().repeatPointsHistory).toEqual([100, 80]);

        appStore.setState({ rolePlayPointsHistory: [90, 70] });
        expect(appStore.getState().rolePlayPointsHistory).toEqual([90, 70]);
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

            expect(appStore.getState().userData).toEqual(userData);
            expect(appStore.getState().englishLevel).toBe('B1');

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
                english_level: 'A1',
                auth_method: 'guest'
            };
            const mockStreakCalculator = vi.fn();

            State.initializeUserMetrics(userData, mockStreakCalculator);

            expect(appStore.getState().englishLevel).toBe('A1');
            expect(appStore.getState().userFirstName).toBeNull();
            expect(mockStreakCalculator).not.toHaveBeenCalled();
        });

        it('should default to A0 if no english_level', () => {
             State.initializeUserMetrics({}, vi.fn());
             expect(appStore.getState().englishLevel).toBe('A0');
         });

        it('should handle null userData', () => {
             State.initializeUserMetrics(null, vi.fn());
             expect(appStore.getState().userData).toBeNull();
             expect(appStore.getState().englishLevel).toBe('A0');
         });
    });

    describe('resetForNewLesson', () => {
        it('should reset all lesson specific state', () => {
            // Set some dirty state
            State.interactionLog = ['test'];
            appStore.setState({ currentStepIndex: 5 });
            State.totalHesitations = 10;
            State.totalPauses = 5;
            State.averageWpm = 100;
            State.stepCount = 5;
            State.stepsAnswered = 3;

            State.resetForNewLesson();

            expect(State.interactionLog).toEqual([]);
            expect(appStore.getState().currentStepIndex).toBe(0);
            expect(State.recognizedIdioms).toEqual([]);
            expect(State.totalHesitations).toBe(0);
            expect(State.totalPauses).toBeNull();
            expect(State.averageWpm).toBeNull();
            expect(State.stepCount).toBe(0);
            expect(State.stepsAnswered).toBe(0);
        });
    });

    describe('resetForNextStep', () => {
        it('should reset step specific state', () => {
            State.wordsRevealed = 5;
            State.videoPlays = 2;
            State.videoClicks = 1;
            appStore.getState().setPlaybackMuted(true);

            State.resetForNextStep();

            expect(State.wordsRevealed).toBe(0);
            expect(State.videoPlays).toBe(0);
            expect(State.videoClicks).toBe(0);
            expect(appStore.getState().isPlaybackMuted).toBe(false);
        });
    });
});
