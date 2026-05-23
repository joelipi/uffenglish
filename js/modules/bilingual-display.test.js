import { describe, it, expect } from 'vitest';
import { formatBilingualHTML, buildBilingualSpan } from './bilingual-display.js';

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

// ── buildBilingualSpan ───────────────────────────────────────────────────────

describe('buildBilingualSpan', () => {
    it('returns "" for falsy text', () => {
        expect(buildBilingualSpan('', 'es')).toBe('');
        expect(buildBilingualSpan(null, 'es')).toBe('');
        expect(buildBilingualSpan(undefined, 'es')).toBe('');
        expect(buildBilingualSpan('text', '')).toBe('');
    });

    it('wraps text in a span with the correct lang attribute', () => {
        expect(buildBilingualSpan('Hola', 'es')).toBe('<span lang="es">Hola</span>');
        expect(buildBilingualSpan('Olá', 'pt')).toBe('<span lang="pt">Olá</span>');
    });
});
