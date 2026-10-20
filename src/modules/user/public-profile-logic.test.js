import { describe, it, expect } from 'vitest';
import { resolveProfileLocale, formatProfileJoinDate } from './public-profile-logic.js';

// The public profile is localized to the VISITOR's language (the app's
// guest-first session language). These helpers turn that language code into a
// locale for the one date the page formats.
describe('resolveProfileLocale', () => {
    it('maps an uppercase language code to its locale tag', () => {
        expect(resolveProfileLocale('EN')).toBe('en');
        expect(resolveProfileLocale('ES')).toBe('es');
        expect(resolveProfileLocale('HI')).toBe('hi');
        expect(resolveProfileLocale('BN')).toBe('bn');
    });

    it('accepts any case and a region tag', () => {
        expect(resolveProfileLocale('es')).toBe('es');
        expect(resolveProfileLocale('es-ES')).toBe('es');
        expect(resolveProfileLocale('bn-BD')).toBe('bn');
        expect(resolveProfileLocale('HI')).toBe('hi');
    });

    it('falls back to English for a missing or unknown code', () => {
        expect(resolveProfileLocale('XX')).toBe('en');
        expect(resolveProfileLocale(null)).toBe('en');
        expect(resolveProfileLocale(undefined)).toBe('en');
        expect(resolveProfileLocale('')).toBe('en');
    });
});

describe('formatProfileJoinDate', () => {
    const JOINED = '2026-01-15T00:00:00.000Z';

    it('formats the date in the visitor locale', () => {
        expect(formatProfileJoinDate(JOINED, 'en'))
            .toBe(new Date(JOINED).toLocaleDateString('en'));
        expect(formatProfileJoinDate(JOINED, 'es'))
            .toBe(new Date(JOINED).toLocaleDateString('es'));
    });

    it('formats the same date differently per language (the locale is applied)', () => {
        const english = formatProfileJoinDate(JOINED, 'en');
        const spanish = formatProfileJoinDate(JOINED, 'es');
        expect(english).not.toBe(spanish);
    });

    it('returns an empty string for a missing or unparseable date', () => {
        expect(formatProfileJoinDate(null, 'en')).toBe('');
        expect(formatProfileJoinDate(undefined, 'en')).toBe('');
        expect(formatProfileJoinDate('', 'en')).toBe('');
        expect(formatProfileJoinDate('not-a-date', 'en')).toBe('');
    });
});
