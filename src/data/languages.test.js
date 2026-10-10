import { describe, it, expect } from 'vitest';
import { GUEST_LANGUAGES, PROFILE_LANGUAGES, SIGNUP_LANGUAGES, HOME_LANGUAGES, LOCALE_MAP } from './languages.js';

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

    it('removes English from the guest dropdown only', () => {
        expect(GUEST_LANGUAGES.some((l) => l.value === 'EN')).toBe(false);
        expect(GUEST_LANGUAGES.some((l) => l.label === 'English')).toBe(false);
        expect(PROFILE_LANGUAGES.some((l) => l.value === 'EN')).toBe(true);
        expect(SIGNUP_LANGUAGES.some((l) => l.value === 'EN')).toBe(true);
    });

    it('keeps the other guest options', () => {
        for (const code of ['ES', 'HI', 'BN']) {
            expect(GUEST_LANGUAGES.some((l) => l.value === code), `missing ${code}`).toBe(true);
        }
    });
});

describe('HOME_LANGUAGES', () => {
    it('lists the six homepage languages in order, English first', () => {
        expect(HOME_LANGUAGES.map((l) => l.value)).toEqual(['EN', 'ES', 'PT', 'FR', 'HI', 'BN']);
    });

    it('includes English (unlike GUEST_LANGUAGES)', () => {
        expect(HOME_LANGUAGES.some((l) => l.value === 'EN')).toBe(true);
    });

    it('has unique values and non-empty labels', () => {
        const values = HOME_LANGUAGES.map((l) => l.value);
        expect(new Set(values).size).toBe(values.length);
        for (const l of HOME_LANGUAGES) {
            expect(l.label, `empty label for ${l.value}`).toBeTruthy();
        }
    });

    it('uses native-only labels so the homepage dropdown stays narrow', () => {
        expect(HOME_LANGUAGES.map((l) => l.label)).toEqual([
            'English',
            'Español',
            'Português',
            'Français',
            'हिन्दी',
            'বাংলা',
        ]);
        for (const l of HOME_LANGUAGES) {
            expect(l.label, `English gloss for ${l.value}`).not.toContain('(');
        }
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
