import { describe, it, expect } from 'vitest';
import calculateSimilarity from './calculate-similarity.js';

describe('calculateSimilarity', () => {
    it('should return 100 for identical strings', () => {
        expect(calculateSimilarity('hello world', 'hello world')).toBe(100);
    });

    it('should return 100 for empty strings', () => {
        expect(calculateSimilarity('', '')).toBe(100);
    });

    it('should calculate correct similarity for different strings', () => {
        // "test" (4) -> "tent" (4), 1 substitution, dist=1. (4-1)/4 = 3/4 = 75%
        expect(calculateSimilarity('test', 'tent')).toBe(75);

        // "kitten" (6) -> "sitting" (7), 3 changes (k->s, e->i, +g), dist=3. (7-3)/7 = 4/7 ~ 57.14%
        expect(calculateSimilarity('kitten', 'sitting')).toBeCloseTo(57.14, 2);
    });

    it('should return 0 for completely different strings', () => {
        // "a" vs "b" -> dist 1. len 1. (1-1)/1 = 0
        expect(calculateSimilarity('a', 'b')).toBe(0);
    });

    it('should throw an error for non-string inputs', () => {
        expect(() => calculateSimilarity(123, 'test')).toThrow('Inputs must be strings');
        expect(() => calculateSimilarity('test', null)).toThrow('Inputs must be strings');
    });
});
