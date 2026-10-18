import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    toShortId,
    ALPHABET,
    SHARE_CODE_MIN_LENGTH,
    SHARE_CODE_MAX_LENGTH,
    GENERATED_CODE_LENGTH,
    SHARE_CODE_SPACE,
    normalizeShareCodeSegment,
    isShareCodeSegment,
} from './short-id.js';

describe('toShortId', () => {
    it('encodes 0 to 5-char padded string', () => {
        const result = toShortId(0);
        expect(result).toBe('aaaaa');
        expect(result.length).toBe(5);
    });

    it('encodes small numbers correctly', () => {
        expect(toShortId(1)).toBe('aaaab');
        expect(toShortId(5)).toBe('aaaaf');
        expect(toShortId(35)).toBe('aaaba');
    });

    it('uses default length of 5', () => {
        expect(toShortId(5)).toBe('aaaaf');
    });

    it('respects custom minLength', () => {
        expect(toShortId(0, 6)).toBe('aaaaaa');
        expect(toShortId(5, 6)).toBe('aaaaaf');
    });

    it('does not truncate when encoded length exceeds minLength', () => {
        const result = toShortId(52521874, 3);
        expect(result.length).toBe(5);
    });

    it('throws on negative numbers', () => {
        expect(() => toShortId(-1)).toThrow('non-negative integer');
    });

    it('accepts string numeric input', () => {
        expect(toShortId('0')).toBe('aaaaa');
        expect(toShortId('45')).toBe('aaabk');
    });

    it('throws on non-integers', () => {
        expect(() => toShortId(1.5)).toThrow('non-negative integer');
        expect(() => toShortId('abc')).toThrow('non-negative integer');
        expect(() => toShortId(null)).toThrow('non-negative integer');
        expect(() => toShortId(undefined)).toThrow('non-negative integer');
    });

    it('exports ALPHABET with expected length and chars', () => {
        expect(ALPHABET.length).toBe(35);
        expect(ALPHABET).toBe('abcdefghijkmnopqrstuvwxyz0123456789');
        expect(ALPHABET.includes('l')).toBe(false);
        expect(ALPHABET.includes('o')).toBe(true);
        expect(ALPHABET.includes('0')).toBe(true);
        expect(ALPHABET.includes('1')).toBe(true);
    });

    it('generated code length is exactly 5', () => {
        expect(GENERATED_CODE_LENGTH).toBe(5);
    });
});

describe('normalizeShareCodeSegment', () => {
    it('lowercases strings so uppercase links resolve the stored code', () => {
        expect(normalizeShareCodeSegment('Abcd')).toBe('abcd');
        expect(normalizeShareCodeSegment('K9GYI')).toBe('k9gyi');
        expect(normalizeShareCodeSegment('abcd')).toBe('abcd');
    });

    it('leaves non-strings unchanged for the predicate to reject', () => {
        for (const value of [null, undefined, 1234, {}, []]) {
            expect(normalizeShareCodeSegment(value)).toBe(value);
        }
    });
});

describe('isShareCodeSegment', () => {
    const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'short-id.js');
    const source = readFileSync(sourcePath, 'utf8');

    it('accepts every code the generator mints (toShortId round trip)', () => {
        for (let n = 0; n <= 2048; n += 1) {
            expect(isShareCodeSegment(toShortId(n)), `toShortId(${n})`).toBe(true);
        }
        for (const n of [50000, 250000, 1000000, 52521874]) {
            expect(isShareCodeSegment(toShortId(n)), `toShortId(${n})`).toBe(true);
        }
    });

    it('accepts the real share codes the product uses', () => {
        expect(isShareCodeSegment('abcd')).toBe(true);
        expect(isShareCodeSegment('k9gyi')).toBe(true);
        expect(isShareCodeSegment('a'.repeat(SHARE_CODE_MIN_LENGTH))).toBe(true);
        expect(isShareCodeSegment('z'.repeat(SHARE_CODE_MAX_LENGTH))).toBe(true);
    });

    it('accepts uppercase and mixed-case forms of a share code', () => {
        expect(isShareCodeSegment('Abcd')).toBe(true);
        expect(isShareCodeSegment('ABCD')).toBe(true);
        expect(isShareCodeSegment('aBcD')).toBe(true);
        expect(isShareCodeSegment('K9GYI')).toBe(true);
    });

    it('rejects malformed single segments', () => {
        expect(isShareCodeSegment('nonsense')).toBe(false); // 8 chars
        expect(isShareCodeSegment('abc')).toBe(false); // shorter than the min
        expect(isShareCodeSegment('a'.repeat(SHARE_CODE_MAX_LENGTH + 1))).toBe(false); // over the max
        expect(isShareCodeSegment('')).toBe(false);
        expect(isShareCodeSegment('ab-cd')).toBe(false);
        expect(isShareCodeSegment('ab cd')).toBe(false);
        expect(isShareCodeSegment('abl d')).toBe(false);
    });

    it('rejects non-string values', () => {
        for (const value of [null, undefined, 1234, {}, [], true]) {
            expect(isShareCodeSegment(value), String(value)).toBe(false);
        }
    });

    it('keeps the Postgres generator in step with ALPHABET', () => {
        const migPath = path.join(
            path.dirname(fileURLToPath(import.meta.url)),
            '..', '..', '..', 'supabase', 'migrations', '010_short_share_codes.sql',
        );
        const sql = readFileSync(migPath, 'utf8');
        const m = sql.match(/alphabet text := '([^']+)';/);
        expect(m, 'alphabet declaration not found').not.toBeNull();
        expect(m[1]).toBe(ALPHABET);
        expect(sql).toContain('for i in 1..5 loop');
        expect(sql).toContain('floor(random() * length(alphabet))');
        expect(sql).toContain("length(code) not in (4, 5)");
        // The trigger's validation regex must use the same alphabet, otherwise
        // it can reject codes the generator mints.
        const regexes = [...sql.matchAll(/!\~ '(\^[^']+)'/g)].map((x) => x[1]);
        expect(regexes.length).toBeGreaterThan(0);
        for (const r of regexes) {
            const classMatch = r.match(/\[([^\]]+)\]/);
            expect(classMatch, 'validation char class not found').not.toBeNull();
            expect(classMatch[1]).toBe(ALPHABET);
        }
        expect(sql).toContain('create trigger trg_fill_share_code');
    });

    it('derives its shape from ALPHABET and the code-length bounds', () => {
        const fnAt = source.indexOf('function isShareCodeSegment');
        const fnEnd = source.indexOf('\nexport {', fnAt);
        expect(fnAt).toBeGreaterThan(-1);
        expect(fnEnd).toBeGreaterThan(fnAt);
        const body = source.slice(fnAt, fnEnd);
        expect(body).toContain('normalizeShareCodeSegment');
        expect(body).toContain('ALPHABET.includes');
        expect(body).toContain('SHARE_CODE_MIN_LENGTH');
        expect(body).toContain('SHARE_CODE_MAX_LENGTH');
        expect(body).not.toMatch(/\[a-z0-9\]/);

        expect(SHARE_CODE_SPACE).toBe(ALPHABET.length ** GENERATED_CODE_LENGTH);
        expect(toShortId(SHARE_CODE_SPACE - 1).length).toBe(SHARE_CODE_MAX_LENGTH);

        for (const char of ALPHABET) {
            expect(isShareCodeSegment(char + 'a'.repeat(SHARE_CODE_MIN_LENGTH - 1))).toBe(true);
        }
        expect(isShareCodeSegment('l' + 'a'.repeat(SHARE_CODE_MIN_LENGTH - 1))).toBe(false);
    });
});
