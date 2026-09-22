import { describe, it, expect } from 'vitest';
import { GUEST_LANGUAGES, PROFILE_LANGUAGES, SIGNUP_LANGUAGES } from './languages.js';

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