import { describe, it, expect } from 'vitest';
import Strings from '../../data/strings.js';
import {
    SHARE_URL_BASE,
    SHARE_WINDOW_HOURS,
    buildShareUrl,
    buildShareDeadline,
    resolveOverlayElements,
    isShareCtaEnabled,
} from './video-processor-logic.js';

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

        expect(url).toBe('s.ultrafastfluency.com/ab12');
        expect(url).not.toMatch(/^https?:/);
        expect(url).not.toMatch(/\s/);
    });

    it('uses the production share host constant', () => {
        expect(SHARE_URL_BASE).toBe('s.ultrafastfluency.com');
    });

    it('falls back to the bare host when there is no shareCode', () => {
        expect(buildShareUrl(null)).toBe(SHARE_URL_BASE);
        expect(buildShareUrl(undefined)).toBe(SHARE_URL_BASE);
        expect(buildShareUrl('')).toBe(SHARE_URL_BASE);
        expect(buildShareUrl('ab12')).toBe(`${SHARE_URL_BASE}/ab12`);
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
    it('keeps the fluency card for fluency/default variants', () => {
        expect(resolveOverlayElements({ variant: 'fluency', isFirst: true })).toEqual({
            fluencyCard: true, headlineBlock: false, tailingCard: false,
        });
        expect(resolveOverlayElements({ variant: 'fluency', tailing: true })).toEqual({
            fluencyCard: true, headlineBlock: false, tailingCard: false,
        });
        expect(resolveOverlayElements({ variant: 'fluency' })).toEqual({
            fluencyCard: false, headlineBlock: false, tailingCard: false,
        });
        expect(resolveOverlayElements({})).toEqual({
            fluencyCard: false, headlineBlock: false, tailingCard: false,
        });
    });

    it('falls through to fluency for unknown variants', () => {
        expect(resolveOverlayElements({ variant: 'bogus', isFirst: true })).toEqual({
            fluencyCard: true, headlineBlock: false, tailingCard: false,
        });
    });

    it('ignores the removed webcamOnly key (decoupling locked)', () => {
        expect(resolveOverlayElements({ webcamOnly: true, isFirst: true })).toEqual({
            fluencyCard: true, headlineBlock: false, tailingCard: false,
        });
    });

    it('shows the headline block every frame and the tailing card during tailing for shareCta', () => {
        expect(resolveOverlayElements({ variant: 'shareCta', isFirst: true })).toEqual({
            fluencyCard: false, headlineBlock: true, tailingCard: false,
        });
        expect(resolveOverlayElements({ variant: 'shareCta', tailing: true })).toEqual({
            fluencyCard: false, headlineBlock: true, tailingCard: true,
        });
        // No shareCode is no longer a reason to render nothing — the CTA always
        // renders for a shareCta recap (the URL falls back to the bare host).
        expect(resolveOverlayElements({ variant: 'shareCta' })).toEqual({
            fluencyCard: false, headlineBlock: true, tailingCard: false,
        });
    });

    it('renders nothing for the none variant', () => {
        expect(resolveOverlayElements({ variant: 'none', isFirst: true })).toEqual({
            fluencyCard: false, headlineBlock: false, tailingCard: false,
        });
        expect(resolveOverlayElements({ variant: 'none', tailing: true })).toEqual({
            fluencyCard: false, headlineBlock: false, tailingCard: false,
        });
    });
});

describe('isShareCtaEnabled', () => {
    it('enables the CTA for the shareCta variant regardless of shareCode', () => {
        expect(isShareCtaEnabled('shareCta')).toBe(true);
        expect(isShareCtaEnabled('fluency')).toBe(false);
        expect(isShareCtaEnabled('none')).toBe(false);
    });
});
