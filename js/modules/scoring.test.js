import { describe, it, expect } from 'vitest';
import { calculateRepeatAverage, calculateRolePlayAverage, calculateAverage, calculateFluencyScore } from './scoring.js';

describe('scoring utilities', () => {
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
            // repeat: (80 + 100) / 2 = 90
            // roleplay: (50 + 60) / 2 = 55
            // combined: (90 + 55) / 2 = 145 / 2 = 72.5 -> 73
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
                hesitation: 0,
                wordCount: 15,
                idiomCount: 1,
                cefrLevel: 'B1',
                grammarErrorScore: 85,
                complexityScore: 90,
                labels: ['correct'],
                attemptNumber: 1
            });

            // Expected subscores:
            // pronunciation: 80
            // listening: 90
            // wpmScore: 100 (wpm >= 60)
            // pausesScore: 100 (100 - 0*50)
            // flow: 100
            // vocabScore: 100 (idiomCount 1 >= threshold 1)
            // grammar: ((85 * 2) + 90) / 3 = 260 / 3 = 86.666
            // formality: 100 (no too formal/informal)
            // nativeLike: 100 (no unidiomatic)
            // understanding: 100 (no pragmatic failure/rude)

            // Final = (80 * 0.05) + (90 * 0.40) + (100 * 0.05) + (100 * 0.05) + (86.666 * 0.05) + (100 * 0.025) + (100 * 0.025) + (100 * 0.35)
            // Final = 4 + 36 + 5 + 5 + 4.333 + 2.5 + 2.5 + 35 = 94.333 -> 94

            expect(result.fluencyScore).toBe(94);
        });

        it('should return minimum score for subsequent attempts', () => {
            const result = calculateFluencyScore({
                pronunciationScore: 50, // lowest
                listeningScore: 90,
                wpm: 120,
                pauseCount: 0,
                hesitation: 0,
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
                hesitation: 0, // hesitationScore = 100
                wordCount: 15,
                idiomCount: 1,
                cefrLevel: 'B1',
                grammarErrorScore: 100,
                complexityScore: 100,
                labels: ['correct'],
                attemptNumber: 1
            });
            // flow = 33
            // Final = (100 * 0.05) + (100 * 0.40) + (33 * 0.05) + (100 * 0.05) + (100 * 0.05) + (100 * 0.025) + (100 * 0.025) + (100 * 0.35)
            // Final = 5 + 40 + 1.65 + 5 + 5 + 2.5 + 2.5 + 35 = 96.65 -> 97
            expect(result.fluencyScore).toBe(97);
        });
    });
});