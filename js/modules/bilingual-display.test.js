import { describe, it, expect } from 'vitest';
import { formatBilingualHTML } from './bilingual-display.web.js';
import { formatBilingualText } from './bilingual-display.js';

const HOLA = { en: 'Hello', es: 'Hola' };

// ── formatBilingualHTML ──────────────────────────────────────────────────────

describe('formatBilingualHTML', () => {
    it('returns empty string for null/undefined translationData', () => {
        expect(formatBilingualHTML(null, 'es')).toBe('');
        expect(formatBilingualHTML(undefined, 'es')).toBe('');
    });

    it('passes through a plain string regardless of lang', () => {
        expect(formatBilingualHTML('hello', 'en')).toBe('hello');
        expect(formatBilingualHTML('hello', 'es')).toBe('hello');
        expect(formatBilingualHTML('hello', null)).toBe('hello');
    });

    it('returns only English when userLang is null', () => {
        expect(formatBilingualHTML(HOLA, null)).toBe('Hello');
    });

    it('returns only English when userLang is undefined', () => {
        expect(formatBilingualHTML(HOLA, undefined)).toBe('Hello');
    });

    it('returns only English when userLang is "en"', () => {
        expect(formatBilingualHTML(HOLA, 'en')).toBe('Hello');
    });

    it('returns English plus localized span when userLang is "es"', () => {
        expect(formatBilingualHTML(HOLA, 'es'))
            .toBe('Hello <span lang="es">/ Hola</span>');
    });

    it('returns only English when userLang has no matching entry', () => {
        expect(formatBilingualHTML(HOLA, 'fr')).toBe('Hello');
    });

    it('returns empty string when object has no en key', () => {
        expect(formatBilingualHTML({ es: 'Hola' }, 'es')).toBe('');
    });

    it('returns only English when localized text equals English text', () => {
        const same = { en: 'Hello', es: 'Hello' };
        expect(formatBilingualHTML(same, 'es')).toBe('Hello');
    });

    it('honours enPrefix and enSuffix for English decoration', () => {
        expect(formatBilingualHTML(HOLA, 'es', {
            enPrefix: '<strong>',
            enSuffix: '</strong>',
        })).toBe('<strong>Hello</strong> <span lang="es">/ Hola</span>');
    });

    it('returns only the localized span when skipEnglish is true', () => {
        expect(formatBilingualHTML(HOLA, 'es', { skipEnglish: true }))
            .toBe('<span lang="es">Hola</span>');
    });

    it('skipEnglish with no localized returns empty string', () => {
        const noLocalized = { en: 'Hello' };
        expect(formatBilingualHTML(noLocalized, 'es', { skipEnglish: true })).toBe('');
    });

    it('applies the wrapper callback to the final HTML', () => {
        expect(formatBilingualHTML(HOLA, 'es', {
            wrapper: html => `<div class="cue">${html}</div>`,
        })).toBe('<div class="cue">Hello <span lang="es">/ Hola</span></div>');
    });

    it('handles an empty translation object', () => {
        expect(formatBilingualHTML({}, 'es')).toBe('');
    });

    it('handles { en: "", es: "" }', () => {
        expect(formatBilingualHTML({ en: '', es: '' }, 'es')).toBe('');
    });
});

// ── formatBilingualText ──────────────────────────────────────────────────────

describe('formatBilingualText', () => {
    it('returns structured data for null/undefined translationData', () => {
        expect(formatBilingualText(null, 'es')).toEqual({
            english: '',
            shouldShowLocalized: false,
        });
        expect(formatBilingualText(undefined, 'es')).toEqual({
            english: '',
            shouldShowLocalized: false,
        });
    });

    it('passes through a plain string regardless of lang', () => {
        expect(formatBilingualText('hello', 'en')).toEqual({
            english: 'hello',
            shouldShowLocalized: false,
        });
        expect(formatBilingualText('hello', 'es')).toEqual({
            english: 'hello',
            shouldShowLocalized: false,
        });
        expect(formatBilingualText('hello', null)).toEqual({
            english: 'hello',
            shouldShowLocalized: false,
        });
    });

    it('returns only English when userLang is null', () => {
        expect(formatBilingualText(HOLA, null)).toEqual({
            english: 'Hello',
            shouldShowLocalized: false,
        });
    });

    it('returns only English when userLang is undefined', () => {
        expect(formatBilingualText(HOLA, undefined)).toEqual({
            english: 'Hello',
            shouldShowLocalized: false,
        });
    });

    it('returns only English when userLang is "en"', () => {
        expect(formatBilingualText(HOLA, 'en')).toEqual({
            english: 'Hello',
            shouldShowLocalized: false,
        });
    });

    it('returns English plus localized data when userLang is "es"', () => {
        expect(formatBilingualText(HOLA, 'es')).toEqual({
            english: 'Hello',
            localized: 'Hola',
            lang: 'es',
            shouldShowLocalized: true,
            enPrefix: '',
            enSuffix: '',
            spanPrefix: ' ',
        });
    });

    it('returns only English when userLang has no matching entry', () => {
        expect(formatBilingualText(HOLA, 'fr')).toEqual({
            english: 'Hello',
            shouldShowLocalized: false,
        });
    });

    it('returns empty string when object has no en key', () => {
        expect(formatBilingualText({ es: 'Hola' }, 'es')).toEqual({
            english: '',
            shouldShowLocalized: false,
        });
    });

    it('returns only English when localized text equals English text', () => {
        const same = { en: 'Hello', es: 'Hello' };
        expect(formatBilingualText(same, 'es')).toEqual({
            english: 'Hello',
            shouldShowLocalized: false,
        });
    });

    it('honours enPrefix and enSuffix for English decoration', () => {
        expect(formatBilingualText(HOLA, 'es', {
            enPrefix: '<strong>',
            enSuffix: '</strong>',
        })).toEqual({
            english: 'Hello',
            localized: 'Hola',
            lang: 'es',
            shouldShowLocalized: true,
            enPrefix: '<strong>',
            enSuffix: '</strong>',
            spanPrefix: ' ',
        });
    });

    it('returns only the localized data when skipEnglish is true', () => {
        expect(formatBilingualText(HOLA, 'es', { skipEnglish: true })).toEqual({
            localized: 'Hola',
            lang: 'es',
            shouldShowLocalized: true,
        });
    });

    it('skipEnglish with no localized returns empty data', () => {
        const noLocalized = { en: 'Hello' };
        expect(formatBilingualText(noLocalized, 'es', { skipEnglish: true })).toEqual({
            localized: '',
            lang: 'es',
            shouldShowLocalized: false,
        });
    });

    it('handles an empty translation object', () => {
        expect(formatBilingualText({}, 'es')).toEqual({
            english: '',
            shouldShowLocalized: false,
        });
    });

    it('handles { en: "", es: "" }', () => {
        expect(formatBilingualText({ en: '', es: '' }, 'es')).toEqual({
            english: '',
            shouldShowLocalized: false,
        });
    });
});