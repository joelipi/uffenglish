import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateRepeatAverage, calculateRolePlayAverage, calculateAverage, calculateFluencyScore, logInteraction, getCompressedLessonStats } from './scoring.js';
import { appStore } from '../store/store.js';

describe('scoring utilities', () => {
    beforeEach(() => {
        appStore.getState().setInteractionLog([]);
        appStore.getState().setLessonStartTime(null);
        appStore.getState().setAverageWpm(0);
        appStore.getState().setTotalPauses(0);
        appStore.getState().setTotalHesitations(0);
        appStore.getState().clearRecognizedIdioms();
        appStore.getState().clearPragmaticFlags();
    });

    // ... original tests ...
    describe('calculateRepeatAverage', () => {
        it('should return 0 for empty or null history', () => {
            expect(calculateRepeatAverage([])).toBe(0);
            expect(calculateRepeatAverage(null)).toBe(0);
        });

        it('should calculate correct average and ignore negative scores', () => {
            expect(calculateRepeatAverage([100, 50, -10, 0])).toBe(38); // (100 + 50 + 0 + 0) / 4 = 150 / 4 = 37.5 -> 38
            expect(calculateRepeatAverage([100, 100, 100])).toBe(100);
        });
    });

    describe('calculateRolePlayAverage', () => {
        it('should return 0 for empty or null history', () => {
            expect(calculateRolePlayAverage([])).toBe(0);
            expect(calculateRolePlayAverage(null)).toBe(0);
        });

        it('should calculate correct average and ignore negative scores', () => {
            expect(calculateRolePlayAverage([80, 90, -5])).toBe(57); // (80 + 90 + 0) / 3 = 170 / 3 = 56.66... -> 57
        });
    });

    describe('calculateAverage', () => {
        it('should return 100 if both histories are empty', () => {
            expect(calculateAverage([], [])).toBe(100);
        });

        it('should return roleplay average if repeat is empty', () => {
            expect(calculateAverage([], [80, 100])).toBe(90);
        });

        it('should return repeat average if roleplay is empty', () => {
            expect(calculateAverage([50, 60], [])).toBe(55);
        });

        it('should return combined average when both have history', () => {
            expect(calculateAverage([80, 100], [50, 60])).toBe(73);
        });
    });

    describe('calculateFluencyScore', () => {
        it('should calculate first attempt score correctly', () => {
            const result = calculateFluencyScore({
                pronunciationScore: 80,
                listeningScore: 90,
                wpm: 120,
                pauseCount: 0,
                hesitation: 200,
                wordCount: 15,
                idiomCount: 1,
                cefrLevel: 'B1',
                grammarErrorScore: 85,
                complexityScore: 90,
                labels: ['correct'],
                attemptNumber: 1
            });
            expect(result.fluencyScore).toBe(94);
        });

        it('should return minimum score for subsequent attempts', () => {
            const result = calculateFluencyScore({
                pronunciationScore: 50, // lowest
                listeningScore: 90,
                wpm: 120,
                pauseCount: 0,
                hesitation: 200,
                wordCount: 15,
                idiomCount: 1,
                cefrLevel: 'B1',
                grammarErrorScore: 85,
                complexityScore: 90,
                labels: ['correct'],
                attemptNumber: 2
            });

            expect(result.fluencyScore).toBe(50);
        });

        it('should penalize for low WPM and high pauses', () => {
             const result = calculateFluencyScore({
                pronunciationScore: 100,
                listeningScore: 100,
                wpm: 50, // wpmScore = 0
                pauseCount: 2, // pausesScore = 100 - 100 = 0
                hesitation: 200, // hesitationScore = 100
                wordCount: 15,
                idiomCount: 1,
                cefrLevel: 'B1',
                grammarErrorScore: 100,
                complexityScore: 100,
                labels: ['correct'],
                attemptNumber: 1
            });
            expect(result.fluencyScore).toBe(97);
        });
    });

    describe('logInteraction', () => {
        it('should log interaction to appStore.getState().interactionLog', () => {
            logInteraction('Hello', 'Hi', 'correct', null, null, appStore.getState().interactionLog);
            expect(appStore.getState().interactionLog).toHaveLength(1);
            expect(appStore.getState().interactionLog[0]).toEqual({ q: 'Hello', r: 'Hi', s: 'correct' });
        });

        it('should log details as string if provided as array', () => {
            logInteraction('Hello', 'Hi', 'correct', ['detail1', 'detail2'], null, appStore.getState().interactionLog);
            expect(appStore.getState().interactionLog[0].d).toBe('detail1, detail2');
        });

        it('should add grammarCorrection if provided', () => {
            logInteraction('He go', 'He goes', 'incorrect', null, 'He goes', appStore.getState().interactionLog);
            expect(appStore.getState().interactionLog[0].g).toBe('He goes');
        });
    });

    describe('getCompressedLessonStats', () => {
        it('should return compressed lesson stats stripping nulls and empty arrays', () => {
            const spy = vi.spyOn(appStore, 'getState');
            spy.mockReturnValue({
                fluencyScore: 85,
                incorrectAttempts: 2
            });
            const result = getCompressedLessonStats({
                isTextMode: true,
                isCameraOff: false,
                lessonStartTime: null,
                averageWpm: 0,
                totalPauses: 0,
                totalHesitations: 0,
                recognizedIdioms: [],
                pragmaticFlags: [],
                interactionLog: []
            });
            spy.mockRestore();
            expect(result.mod).toBe('txt');
            expect(result.fs).toBe(85);
            expect(result.ia).toBe(2);
            expect(result.ls).toBeUndefined(); // null stripped
            expect(result.ida).toBeUndefined(); // empty array stripped
            expect(result.idc).toBeUndefined(); // 0 idc stripped
        });
    });
});
