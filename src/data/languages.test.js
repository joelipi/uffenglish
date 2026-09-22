import { describe, it, expect } from 'vitest';
import { GUEST_LANGUAGES, PROFILE_LANGUAGES, SIGNUP_LANGUAGES, LOCALE_MAP } from './languages.js';

const LISTS = { GUEST_LANGUAGES, PROFILE_LANGUAGES, SIGNUP_LANGUAGES };

describe('language selection lists', () => {
    it.each(Object.keys(LISTS))('%s includes Hindi (HI)', (name) => {
        expect(LISTS[name].some((l) => l.value === 'HI')).toBe(true);
    });

    it.each(Object.keys(LISTS))('%s includes Bengali (BN)', (name) => {
        expect(LISTS[name].some((l) => l.value === 'BN')).toBe(true);
    });

    it.each(Object.keys(LISTS))('%s has no duplicate values', (name) => {
        const values = LISTS[name].map((l) => l.value);
        expect(new Set(values).size).toBe(values.length);
    });

    it.each(Object.keys(LISTS))('%s has non-empty labels', (name) => {
        for (const l of LISTS[name]) {
            expect(l.label, `empty label for ${l.value}`).toBeTruthy();
        }
    });

    it('labels Bengali in its native script', () => {
        expect(GUEST_LANGUAGES.find((l) => l.value === 'BN').label).toBe('বাংলা (Bengali)');
        expect(SIGNUP_LANGUAGES.find((l) => l.value === 'BN').label).toBe('বাংলা (Bengali)');
        expect(PROFILE_LANGUAGES.find((l) => l.value === 'BN').label).toBe('Bengali');
    });
});

describe('LOCALE_MAP', () => {
    it('maps every PROFILE_LANGUAGES code to its lowercase BCP-47 tag', () => {
        for (const { value } of PROFILE_LANGUAGES) {
            expect(LOCALE_MAP[value], `missing locale for ${value}`).toBe(value.toLowerCase());
        }
    });

    it('covers Hindi and Bengali', () => {
        expect(LOCALE_MAP.HI).toBe('hi');
        expect(LOCALE_MAP.BN).toBe('bn');
    });

    it('has no entries outside PROFILE_LANGUAGES (cannot drift)', () => {
        const codes = new Set(PROFILE_LANGUAGES.map((l) => l.value));
        for (const code of Object.keys(LOCALE_MAP)) {
            expect(codes.has(code), `stray locale key ${code}`).toBe(true);
        }
    });
});
