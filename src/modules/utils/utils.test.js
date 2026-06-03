import { describe, it, expect } from 'vitest';
import { getLocalizedTranslation } from './utils.js';

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

    it('falls back to the first available language if English is not available', () => {
        const translations = { fr: 'Bonjour', de: 'Hallo' };
        expect(getLocalizedTranslation(translations, 'es')).toBe('Bonjour');
    });

    it('returns empty string if translations object is empty', () => {
        expect(getLocalizedTranslation({}, 'en')).toBe('');
    });

    it('defaults lang to en if lang is null or undefined', () => {
        const translations = { en: 'Hello', es: 'Hola' };
        expect(getLocalizedTranslation(translations, null)).toBe('Hello');
        expect(getLocalizedTranslation(translations, undefined)).toBe('Hello');
    });
});
