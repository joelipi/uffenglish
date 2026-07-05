import { describe, it, expect } from 'vitest';
import { toShortId, ALPHABET } from './short-id.js';

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
