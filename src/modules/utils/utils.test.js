import { describe, it, expect } from 'vitest';
import { getLocalizedTranslation, normalizeLanguageCode } from './utils.js';

describe('normalizeLanguageCode', () => {
    it('strips region subtags and lowercases', () => {
        expect(normalizeLanguageCode('bn-BD')).toBe('bn');
        expect(normalizeLanguageCode('BN')).toBe('bn');
        expect(normalizeLanguageCode('es-ES')).toBe('es');
    });

    it('defaults to en for empty/invalid input', () => {
        expect(normalizeLanguageCode(null)).toBe('en');
        expect(normalizeLanguageCode(undefined)).toBe('en');
        expect(normalizeLanguageCode('')).toBe('en');
        expect(normalizeLanguageCode(42)).toBe('en');
    });
});

describe('getLocalizedTranslation', () => {
    it('returns empty string if no translationData', () => {
        expect(getLocalizedTranslation(null, 'en')).toBe('');
        expect(getLocalizedTranslation(undefined, 'en')).toBe('');
    });

    it('returns string itself if translationData is a string', () => {
        expect(getLocalizedTranslation('hello', 'en')).toBe('hello');
    });

    it('returns target language translation', () => {
        const translations = { en: 'Hello', es: 'Hola' };
        expect(getLocalizedTranslation(translations, 'es')).toBe('Hola');
    });

    it('falls back to English if target language is not available', () => {
        const translations = { en: 'Hello', fr: 'Bonjour' };
        expect(getLocalizedTranslation(translations, 'es')).toBe('Hello');
    });

    it('returns empty string if neither target language nor English is available', () => {
        const translations = { fr: 'Bonjour', de: 'Hallo' };
        expect(getLocalizedTranslation(translations, 'es')).toBe('');
    });

    it('returns empty string if translations object is empty', () => {
        expect(getLocalizedTranslation({}, 'en')).toBe('');
    });

    it('defaults lang to en if lang is null or undefined', () => {
        const translations = { en: 'Hello', es: 'Hola' };
        expect(getLocalizedTranslation(translations, null)).toBe('Hello');
        expect(getLocalizedTranslation(translations, undefined)).toBe('Hello');
    });

    it('resolves region-tagged codes to the base language (bn-BD → bn)', () => {
        // Config content (subtitles, cues, step text) must localize for the
        // same codes Strings.get/getBilingual accept, or a Bengali profile of
        // 'bn-BD' shows a Bengali UI but English lesson content.
        const translations = { en: 'Hello', bn: 'হ্যালো' };
        expect(getLocalizedTranslation(translations, 'BN')).toBe('হ্যালো');
        expect(getLocalizedTranslation(translations, 'bn-BD')).toBe('হ্যালো');
        expect(getLocalizedTranslation(translations, 'bn-IN')).toBe('হ্যালো');
    });
});
