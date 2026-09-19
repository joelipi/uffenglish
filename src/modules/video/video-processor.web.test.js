import { describe, it, expect } from 'vitest';
import Strings from '../../data/strings.js';
import {
    SHARE_URL_BASE,
    SHARE_WINDOW_HOURS,
    buildShareUrl,
    buildShareDeadline,
    resolveOverlayElements,
} from './video-processor.web.js';

const LANGS = ['en', 'es', 'pt', 'fr', 'hi', 'bn'];

const HEADLINES = {
    en: 'Practice English with me free',
    es: 'Practica inglés conmigo gratis',
    pt: 'Pratique inglês comigo de graça',
    fr: "Pratique l'anglais avec moi gratuitement",
    hi: 'मेरे साथ मुफ़्त अंग्रेज़ी प्रैक्टिस करें',
    bn: 'আমার সাথে ফ্রি ইংরেজি প্র্যাকটিস করুন',
};

const DEADLINES = {
    en: 'Practice English with me free before',
    es: 'Practica inglés conmigo gratis antes del',
    pt: 'Pratique inglês comigo de graça antes de',
    fr: "Pratique l'anglais avec moi gratuitement avant le",
    hi: 'मेरे साथ मुफ़्त अंग्रेज़ी प्रैक्टिस करें — अंतिम तिथि:',
    bn: 'আমার সাথে ফ্রি ইংরেজি প্র্যাকটিস করুন — শেষ তারিখ:',
};

const LOCALE_MAP = { en: 'en', es: 'es', pt: 'pt', fr: 'fr', hi: 'hi', bn: 'bn' };

const DEADLINE_OPTIONS = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
};

describe('share CTA strings', () => {
    it.each(LANGS)('share_cta_headline returns the exact copy for %s', (lang) => {
        expect(Strings.get('share_cta_headline', lang)).toBe(HEADLINES[lang]);
    });

    it.each(LANGS)('share_cta_deadline returns the exact copy for %s', (lang) => {
        expect(Strings.get('share_cta_deadline', lang)).toBe(DEADLINES[lang]);
    });

    it('normalizes stored uppercase and full locales, falling back to en', () => {
        expect(Strings.get('share_cta_headline', 'HI')).toBe(HEADLINES.hi);
        expect(Strings.get('share_cta_headline', 'hi-IN')).toBe(HEADLINES.hi);
        expect(Strings.get('share_cta_headline', 'de')).toBe(HEADLINES.en);
    });
});

describe('buildShareUrl', () => {
    it('returns a bare host/path with no scheme and no whitespace', () => {
        const url = buildShareUrl('ab12');

        expect(url).toBe('example.com/ab12');
        expect(url).not.toMatch(/^https?:/);
        expect(url).not.toMatch(/\s/);
    });

    it('uses the placeholder domain constant', () => {
        expect(SHARE_URL_BASE).toBe('example.com');
    });
});

describe('buildShareDeadline', () => {
    const nowMs = Date.UTC(2026, 2, 13, 12, 0, 0);

    it('is 48 hours', () => {
        expect(SHARE_WINDOW_HOURS).toBe(48);
    });

    it.each(LANGS)('formats now+48h in the %s locale with weekday', (lang) => {
        const expected = new Date(nowMs + SHARE_WINDOW_HOURS * 60 * 60 * 1000)
            .toLocaleString(LOCALE_MAP[lang], DEADLINE_OPTIONS);

        expect(buildShareDeadline(nowMs, lang)).toBe(expected);
    });

    it('differs from the unshifted timestamp (proves the +48h offset)', () => {
        const unshifted = new Date(nowMs).toLocaleString('en', DEADLINE_OPTIONS);

        expect(buildShareDeadline(nowMs, 'en')).not.toBe(unshifted);
    });

    it('localizes (non-en differs from en)', () => {
        expect(buildShareDeadline(nowMs, 'es')).not.toBe(buildShareDeadline(nowMs, 'en'));
    });

    it('normalizes es / ES / es-ES identically and falls back to en', () => {
        const es = buildShareDeadline(nowMs, 'es');

        expect(buildShareDeadline(nowMs, 'ES')).toBe(es);
        expect(buildShareDeadline(nowMs, 'es-ES')).toBe(es);
        expect(buildShareDeadline(nowMs, '')).toBe(buildShareDeadline(nowMs, 'en'));
        expect(buildShareDeadline(nowMs, 'DE')).toBe(buildShareDeadline(nowMs, 'en'));
    });
});

describe('resolveOverlayElements', () => {
    it('keeps the fluency card for non-webcamOnly lessons', () => {
        expect(resolveOverlayElements({ isFirst: true })).toEqual({
            fluencyCard: true, headlineBlock: false, tailingCard: false,
        });
        expect(resolveOverlayElements({ tailing: true })).toEqual({
            fluencyCard: true, headlineBlock: false, tailingCard: false,
        });
        expect(resolveOverlayElements({})).toEqual({
            fluencyCard: false, headlineBlock: false, tailingCard: false,
        });
    });

    it('shows the headline block every frame and the tailing card during tailing', () => {
        expect(resolveOverlayElements({ webcamOnly: true, hasShareCta: true, isFirst: true })).toEqual({
            fluencyCard: false, headlineBlock: true, tailingCard: false,
        });
        expect(resolveOverlayElements({ webcamOnly: true, hasShareCta: true, tailing: true })).toEqual({
            fluencyCard: false, headlineBlock: true, tailingCard: true,
        });
    });

    it('renders nothing when a webcamOnly lesson has no shareCode', () => {
        expect(resolveOverlayElements({ webcamOnly: true, hasShareCta: false, isFirst: true })).toEqual({
            fluencyCard: false, headlineBlock: false, tailingCard: false,
        });
        expect(resolveOverlayElements({ webcamOnly: true, hasShareCta: false, tailing: true })).toEqual({
            fluencyCard: false, headlineBlock: false, tailingCard: false,
        });
    });
});
