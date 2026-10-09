import { describe, it, expect } from 'vitest';
import {
    normalizeLanguageCode,
    parseAcceptLanguage,
    resolveEmailLanguage,
} from './email-language.js';

describe('normalizeLanguageCode', () => {
    it('accepts any two-letter code, upper-casing it', () => {
        expect(normalizeLanguageCode('es')).toBe('ES');
        expect(normalizeLanguageCode('ES')).toBe('ES');
        expect(normalizeLanguageCode('de')).toBe('DE');
        expect(normalizeLanguageCode('nb')).toBe('NB');
        expect(normalizeLanguageCode('el')).toBe('EL');
        expect(normalizeLanguageCode('uk')).toBe('UK');
    });

    it('reduces a full tag to its primary two-letter code', () => {
        expect(normalizeLanguageCode('es-ES')).toBe('ES');
        expect(normalizeLanguageCode('pt_BR')).toBe('PT');
        expect(normalizeLanguageCode('de-AT')).toBe('DE');
    });

    it('maps Chinese: TW/Hant/HK/MO -> TW (non-simplified), otherwise ZH', () => {
        expect(normalizeLanguageCode('TW')).toBe('TW');
        expect(normalizeLanguageCode('tw')).toBe('TW');
        expect(normalizeLanguageCode('zh-TW')).toBe('TW');
        expect(normalizeLanguageCode('zh-Hant')).toBe('TW');
        expect(normalizeLanguageCode('zh-HK')).toBe('TW');
        expect(normalizeLanguageCode('zh')).toBe('ZH');
        expect(normalizeLanguageCode('zh-CN')).toBe('ZH');
        expect(normalizeLanguageCode('zh-Hans')).toBe('ZH');
        expect(normalizeLanguageCode('ZH')).toBe('ZH');
    });

    it('rejects anything that is not a usable two-letter code', () => {
        expect(normalizeLanguageCode('')).toBeNull();
        expect(normalizeLanguageCode('  ')).toBeNull();
        expect(normalizeLanguageCode(null)).toBeNull();
        expect(normalizeLanguageCode(undefined)).toBeNull();
        expect(normalizeLanguageCode(42)).toBeNull();
        expect(normalizeLanguageCode('e')).toBeNull();
        expect(normalizeLanguageCode('eng')).toBeNull();
        expect(normalizeLanguageCode('not a language')).toBeNull();
    });
});

describe('parseAcceptLanguage', () => {
    it('picks the highest-priority usable tag', () => {
        expect(parseAcceptLanguage('es-ES,es;q=0.9,en;q=0.8')).toBe('ES');
        expect(parseAcceptLanguage('en;q=0.5,fr;q=0.9')).toBe('FR');
        expect(parseAcceptLanguage('de-DE')).toBe('DE');
        expect(parseAcceptLanguage('zh-TW,zh;q=0.9')).toBe('TW');
    });

    it('ignores wildcards, zero-q entries and unusable tags', () => {
        expect(parseAcceptLanguage('*')).toBeNull();
        expect(parseAcceptLanguage('en;q=0,fr;q=0')).toBeNull();
        expect(parseAcceptLanguage('not-a-language,es;q=0.5')).toBe('ES');
    });

    it('returns null for missing/empty headers', () => {
        expect(parseAcceptLanguage('')).toBeNull();
        expect(parseAcceptLanguage(null)).toBeNull();
        expect(parseAcceptLanguage(undefined)).toBeNull();
    });
});

describe('resolveEmailLanguage', () => {
    it('prefers the stored native language', () => {
        expect(resolveEmailLanguage({ nativeLanguage: 'KO', acceptLanguage: 'fr' })).toBe('KO');
        expect(resolveEmailLanguage({ nativeLanguage: 'zh-TW' })).toBe('TW');
    });

    it('falls back to Accept-Language, then English', () => {
        expect(resolveEmailLanguage({ acceptLanguage: 'fr-FR' })).toBe('FR');
        expect(resolveEmailLanguage({ nativeLanguage: '', acceptLanguage: '' })).toBe('EN');
        expect(resolveEmailLanguage()).toBe('EN');
        expect(resolveEmailLanguage({ nativeLanguage: 'not-a-code', acceptLanguage: 'nope' })).toBe('EN');
    });
});
