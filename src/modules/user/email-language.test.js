import { describe, it, expect } from 'vitest';
import {
    normalizeEmailLanguage,
    parseAcceptLanguage,
    resolveEmailLanguage,
} from './email-language.js';

describe('normalizeEmailLanguage', () => {
    it('accepts any two-letter code, lower-casing it', () => {
        expect(normalizeEmailLanguage('es')).toBe('es');
        expect(normalizeEmailLanguage('ES')).toBe('es');
        expect(normalizeEmailLanguage('de')).toBe('de');
        expect(normalizeEmailLanguage('nb')).toBe('nb');
        expect(normalizeEmailLanguage('el')).toBe('el');
        expect(normalizeEmailLanguage('uk')).toBe('uk');
    });

    it('reduces a full tag to its primary two-letter code', () => {
        expect(normalizeEmailLanguage('es-ES')).toBe('es');
        expect(normalizeEmailLanguage('pt_BR')).toBe('pt');
        expect(normalizeEmailLanguage('de-AT')).toBe('de');
        expect(normalizeEmailLanguage('bn-BD')).toBe('bn');
    });

    it('maps Chinese: TW/Hant/HK/MO -> tw (non-simplified), otherwise zh', () => {
        expect(normalizeEmailLanguage('TW')).toBe('tw');
        expect(normalizeEmailLanguage('tw')).toBe('tw');
        expect(normalizeEmailLanguage('zh-TW')).toBe('tw');
        expect(normalizeEmailLanguage('zh-Hant')).toBe('tw');
        expect(normalizeEmailLanguage('zh-HK')).toBe('tw');
        expect(normalizeEmailLanguage('zh')).toBe('zh');
        expect(normalizeEmailLanguage('zh-CN')).toBe('zh');
        expect(normalizeEmailLanguage('zh-Hans')).toBe('zh');
        expect(normalizeEmailLanguage('ZH')).toBe('zh');
    });

    it('rejects anything that is not a usable two-letter code', () => {
        expect(normalizeEmailLanguage('')).toBeNull();
        expect(normalizeEmailLanguage('  ')).toBeNull();
        expect(normalizeEmailLanguage(null)).toBeNull();
        expect(normalizeEmailLanguage(undefined)).toBeNull();
        expect(normalizeEmailLanguage(42)).toBeNull();
        expect(normalizeEmailLanguage('e')).toBeNull();
        expect(normalizeEmailLanguage('eng')).toBeNull();
        expect(normalizeEmailLanguage('not a language')).toBeNull();
    });
});

describe('parseAcceptLanguage', () => {
    it('picks the highest-priority usable tag', () => {
        expect(parseAcceptLanguage('es-ES,es;q=0.9,en;q=0.8')).toBe('es');
        expect(parseAcceptLanguage('en;q=0.5,fr;q=0.9')).toBe('fr');
        expect(parseAcceptLanguage('de-DE')).toBe('de');
        expect(parseAcceptLanguage('zh-TW,zh;q=0.9')).toBe('tw');
    });

    it('ignores wildcards, zero-q entries and unusable tags', () => {
        expect(parseAcceptLanguage('*')).toBeNull();
        expect(parseAcceptLanguage('en;q=0,fr;q=0')).toBeNull();
        expect(parseAcceptLanguage('not-a-language,es;q=0.5')).toBe('es');
    });

    it('returns null for missing/empty headers', () => {
        expect(parseAcceptLanguage('')).toBeNull();
        expect(parseAcceptLanguage(null)).toBeNull();
        expect(parseAcceptLanguage(undefined)).toBeNull();
    });
});

describe('resolveEmailLanguage', () => {
    it('prefers the stored native language', () => {
        expect(resolveEmailLanguage({ nativeLanguage: 'KO', acceptLanguage: 'fr' })).toBe('ko');
        expect(resolveEmailLanguage({ nativeLanguage: 'zh-TW' })).toBe('tw');
    });

    it('falls back to Accept-Language, then English', () => {
        expect(resolveEmailLanguage({ acceptLanguage: 'fr-FR' })).toBe('fr');
        expect(resolveEmailLanguage({ nativeLanguage: '', acceptLanguage: '' })).toBe('en');
        expect(resolveEmailLanguage()).toBe('en');
        expect(resolveEmailLanguage({ nativeLanguage: 'not-a-code', acceptLanguage: 'nope' })).toBe('en');
    });
});
