import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    toShortId,
    ALPHABET,
    SHORT_ID_MIN_LENGTH,
    SHORT_ID_MAX_LENGTH,
    isShareCodeSegment,
} from './short-id.js';

describe('toShortId', () => {
    it('encodes 0 to 4-char padded string', () => {
        const result = toShortId(0);
        expect(result).toBe('aaaa');
        expect(result.length).toBe(4);
    });

    it('encodes 1048575 as a 4-char string (max 4-char value)', () => {
        expect(32 ** 4).toBe(1048576);
        const result = toShortId(1048575);
        expect(result.length).toBe(4);
    });

    it('encodes 1048576 as a 5-char string (natural rollover)', () => {
        const result = toShortId(1048576);
        expect(result.length).toBe(5);
        expect(result.startsWith('b'));
    });

    it('encodes small numbers correctly', () => {
        expect(toShortId(1)).toBe('aaab');
        expect(toShortId(31)).toBe('aaa9');
        expect(toShortId(32)).toBe('aaba');
    });

    it('uses default minLength of 4', () => {
        expect(toShortId(5)).toBe('aaaf');
    });

    it('respects custom minLength', () => {
        expect(toShortId(0, 6)).toBe('aaaaaa');
        expect(toShortId(5, 6)).toBe('aaaaaf');
    });

    it('does not truncate when encoded length exceeds minLength', () => {
        const result = toShortId(1048576, 3);
        expect(result.length).toBe(5);
    });

    it('throws on negative numbers', () => {
        expect(() => toShortId(-1)).toThrow('non-negative integer');
    });

    it('accepts string numeric input', () => {
        expect(toShortId('0')).toBe('aaaa');
        expect(toShortId('45')).toBe('aabp');
        expect(toShortId('1048576')).toBe('baaaa');
    });

    it('throws on non-integers', () => {
        expect(() => toShortId(1.5)).toThrow('non-negative integer');
        expect(() => toShortId('abc')).toThrow('non-negative integer');
        expect(() => toShortId(null)).toThrow('non-negative integer');
        expect(() => toShortId(undefined)).toThrow('non-negative integer');
    });

    it('exports ALPHABET with expected length and chars', () => {
        expect(ALPHABET.length).toBe(32);
        expect(ALPHABET).toBe('abcdefghijkmnpqrstuvwxyz23456789');
        expect(ALPHABET.includes('o')).toBe(false);
        expect(ALPHABET.includes('l')).toBe(false);
        expect(ALPHABET.includes('0')).toBe(false);
        expect(ALPHABET.includes('1')).toBe(false);
    });
});

describe('isShareCodeSegment', () => {
    const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'short-id.js');
    const source = readFileSync(sourcePath, 'utf8');

    it('accepts every code the generator mints (toShortId round trip)', () => {
        // 0..2048 covers both padded 4-char codes and the natural rollover to
        // 5 chars, plus arbitrary values across the 24-bit space.
        for (let n = 0; n <= 2048; n += 1) {
            expect(isShareCodeSegment(toShortId(n)), `toShortId(${n})`).toBe(true);
        }
        for (const n of [50000, 250000, 1048575, 1048576, 16777214]) {
            expect(isShareCodeSegment(toShortId(n)), `toShortId(${n})`).toBe(true);
        }
    });

    it('accepts the real share codes the product uses', () => {
        expect(isShareCodeSegment('abcd')).toBe(true);
        expect(isShareCodeSegment('k9gyi')).toBe(true);
        expect(isShareCodeSegment('a'.repeat(SHORT_ID_MIN_LENGTH))).toBe(true);
        expect(isShareCodeSegment('z'.repeat(SHORT_ID_MAX_LENGTH))).toBe(true);
    });

    it('rejects malformed single segments', () => {
        expect(isShareCodeSegment('nonsense')).toBe(false);
        expect(isShareCodeSegment('Abcd')).toBe(false); // the alphabet is lowercase
        expect(isShareCodeSegment('abc')).toBe(false); // shorter than the min
        expect(isShareCodeSegment('a'.repeat(SHORT_ID_MAX_LENGTH + 1))).toBe(false); // over the generator's space
        expect(isShareCodeSegment('')).toBe(false);
        expect(isShareCodeSegment('ab-cd')).toBe(false);
        expect(isShareCodeSegment('ab cd')).toBe(false);
        expect(isShareCodeSegment('ab0d')).toBe(false);
        expect(isShareCodeSegment('ab1d')).toBe(false);
        expect(isShareCodeSegment('abl d')).toBe(false);
    });

    it('rejects non-string values', () => {
        for (const value of [null, undefined, 1234, {}, [], true]) {
            expect(isShareCodeSegment(value), String(value)).toBe(false);
        }
    });

    it('derives its shape from ALPHABET and the generator min length', () => {
        // A guard, not a restatement: the predicate must consult the shared
        // constants (a hand-written character class could drift from the
        // generator without any behavioural test noticing).
        const fnAt = source.indexOf('function isShareCodeSegment');
        const fnEnd = source.indexOf('\nexport {', fnAt);
        expect(fnAt).toBeGreaterThan(-1);
        expect(fnEnd).toBeGreaterThan(fnAt);
        const body = source.slice(fnAt, fnEnd);
        expect(body).toContain('ALPHABET.includes');
        expect(body).toContain('SHORT_ID_MIN_LENGTH');
        expect(body).toContain('SHORT_ID_MAX_LENGTH');
        expect(body).not.toMatch(/\[a-z0-9\]/);

        // Every alphabet character is accepted, and only those.
        for (const char of ALPHABET) {
            expect(isShareCodeSegment(char + 'a'.repeat(SHORT_ID_MIN_LENGTH - 1))).toBe(true);
        }
        for (const char of 'ol01') {
            expect(isShareCodeSegment(char + 'a'.repeat(SHORT_ID_MIN_LENGTH - 1))).toBe(false);
        }
    });
});
