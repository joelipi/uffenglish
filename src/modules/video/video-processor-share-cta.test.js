import { describe, it, expect } from 'vitest';
import Strings from '../../data/strings.js';
import {
    SHARE_URL_BASE,
    buildShareUrl,
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

const CTA_LINES = {
    share_cta_respond_now: {
        en: 'Respond now before the video expires!',
        es: '¡Responde ahora antes de que caduque el video!',
        pt: 'Responda agora antes que o vídeo expire!',
        fr: "Répondez maintenant avant que la vidéo n'expire !",
        hi: 'वीडियो समाप्त होने से पहले अभी जवाब दें!',
        bn: 'ভিডিওটি শেষ হওয়ার আগে এখনই উত্তর দিন!',
    },
    share_cta_quick: {
        en: 'It takes less than 5 minutes!',
        es: '¡Toma menos de 5 minutos!',
        pt: 'Leva menos de 5 minutos!',
        fr: 'Ça prend moins de 5 minutes !',
        hi: 'इसमें 5 मिनट से भी कम समय लगता है!',
        bn: 'এটি ৫ মিনিটেরও কম সময় নেয়!',
    },
    share_cta_go_to: {
        en: 'Go to:',
        es: 'Ve a:',
        pt: 'Acesse:',
        fr: 'Rendez-vous sur :',
        hi: 'यहाँ जाएँ:',
        bn: 'এখানে যান:',
    },
    share_cta_enter_code: {
        en: 'Enter code:',
        es: 'Ingresa el código:',
        pt: 'Digite o código:',
        fr: 'Entrez le code :',
        hi: 'कोड दर्ज करें:',
        bn: 'কোড লিখুন:',
    },
};

describe('share CTA strings', () => {
    it.each(LANGS)('share_cta_headline returns the exact copy for %s', (lang) => {
        expect(Strings.get('share_cta_headline', lang)).toBe(HEADLINES[lang]);
    });

    it.each(Object.entries(CTA_LINES))('%s returns the exact copy per language', (key, copy) => {
        for (const [lang, expected] of Object.entries(copy)) {
            expect(Strings.get(key, lang)).toBe(expected);
        }
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

        expect(url).toBe('ultrafastfluency.com/ab12');
        expect(url).not.toMatch(/^https?:/);
        expect(url).not.toMatch(/\s/);
    });

    it('uses the production share host constant', () => {
        expect(SHARE_URL_BASE).toBe('ultrafastfluency.com');
    });

    it('falls back to the bare host when there is no shareCode', () => {
        expect(buildShareUrl(null)).toBe(SHARE_URL_BASE);
        expect(buildShareUrl(undefined)).toBe(SHARE_URL_BASE);
        expect(buildShareUrl('')).toBe(SHARE_URL_BASE);
        expect(buildShareUrl('ab12')).toBe(`${SHARE_URL_BASE}/ab12`);
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

describe('share_message (recap share text)', () => {
    // The message attached when sharing the recap video must carry the learner's
    // personal share link, localized to their language. The exact per-language
    // copy is exercised end-to-end in video-share-message.test.js.
    it.each(LANGS)('has a %s translation with the {url} placeholder', (lang) => {
        expect(Strings.get('share_message', lang)).toContain('{url}');
    });

    it('interpolates the share URL into the message for every language', () => {
        const url = buildShareUrl('abc123');
        for (const lang of LANGS) {
            const out = Strings.get('share_message', lang, { url });
            expect(out).toContain('ultrafastfluency.com/abc123');
            expect(out).not.toContain('{url}');
        }
    });

    it('falls back to the bare host when there is no share code', () => {
        const url = buildShareUrl(null);
        const out = Strings.get('share_message', 'en', { url });
        expect(out).toContain('ultrafastfluency.com');
        expect(out).not.toContain('{url}');
    });
});
