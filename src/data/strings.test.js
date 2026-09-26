import { describe, it, expect } from 'vitest';
import { get, getBilingual, strings } from './strings.js';

// Every entry in strings.js must carry hi (Hindi) and bn (Bengali) copy.
// The scripts differ from Latin, so a localized hit is detectable by script.
const DEVANAGARI = /[\u0900-\u097F]/;
const BENGALI = /[\u0980-\u09FF]/;

// Keys that carry {placeholders} — interpolation must survive translation.
// Auto-derived from the en values so future placeholder keys are covered
// without editing this list.
const PLACEHOLDER_KEYS = Object.keys(strings).filter((key) =>
    /\{[a-z_]+\}/.test(strings[key].en || '')
);

describe('Hindi and Bengali localization coverage', () => {
    it('returns a Devanagari (Hindi) string for every key', () => {
        for (const key of Object.keys(strings)) {
            const hi = get(key, 'hi');
            expect(hi, `missing/empty hi for ${key}`).toBeTruthy();
            expect(hi, `hi for ${key} is not Hindi script`).toMatch(DEVANAGARI);
        }
    });

    it('returns a Bengali string for every key', () => {
        for (const key of Object.keys(strings)) {
            const bn = get(key, 'bn');
            expect(bn, `missing/empty bn for ${key}`).toBeTruthy();
            expect(bn, `bn for ${key} is not Bengali script`).toMatch(BENGALI);
        }
    });
});

describe('Hindi and Bengali spot checks', () => {
    it('translates core lesson strings', () => {
        expect(get('status_speak', 'hi')).toBe('बोलिए।');
        expect(get('status_speak', 'bn')).toBe('বলুন।');
        expect(get('try_again_speech', 'hi')).toBe('फिर से प्रयास करें। आवाज़ का पता नहीं चला।');
        expect(get('try_again_speech', 'bn')).toBe('আবার চেষ্টা করুন। কথা শনাক্ত করা যায়নি।');
    });

    it('translates guest modal strings', () => {
        expect(get('guest_language_title', 'hi')).toBe('अपनी मातृभाषा की पुष्टि करें');
        expect(get('guest_language_title', 'bn')).toBe('আপনার মাতৃভাষা নিশ্চিত করুন');
        expect(get('guest_modal_continue', 'hi')).toBe('अतिथि के रूप में जारी रखें');
        expect(get('guest_modal_continue', 'bn')).toBe('অতিথি হিসেবে চালিয়ে যান');
    });

    it('translates profile and auth strings', () => {
        expect(get('profile_native_language', 'hi')).toBe('मातृभाषा');
        expect(get('profile_native_language', 'bn')).toBe('মাতৃভাষা');
        expect(get('auth_signup_title', 'hi')).toBe('साइन अप');
        expect(get('auth_signup_title', 'bn')).toBe('সাইন আপ');
    });

    it('keeps the share CTA copy already shipped for hi/bn', () => {
        expect(get('share_cta_headline', 'hi')).toBe('मेरे साथ मुफ़्त अंग्रेज़ी प्रैक्टिस करें');
        expect(get('share_cta_headline', 'bn')).toBe('আমার সাথে ফ্রি ইংরেজি প্র্যাকটিস করুন');
    });
});

describe('placeholder interpolation in hi/bn', () => {
    it.each(PLACEHOLDER_KEYS)('replaces {placeholders} in %s for hi and bn', (key) => {
        const hi = get(key, 'hi', { score: 88, date: 'Jan 1', bad_intent: 'angry', time: '47h 0m' });
        const bn = get(key, 'bn', { score: 88, date: 'Jan 1', bad_intent: 'angry', time: '47h 0m' });
        expect(hi).not.toContain('{');
        expect(bn).not.toContain('{');
        expect(hi).toMatch(DEVANAGARI);
        expect(bn).toMatch(BENGALI);
    });

    it('interpolates the listening score placeholder', () => {
        expect(get('stats_listening_header', 'hi', { score: 88 })).toBe('सुनने का स्कोर: 88%');
        expect(get('stats_listening_header', 'bn', { score: 88 })).toBe('শোনার স্কোর: 88%');
    });
});

describe('language code normalization for hi/bn', () => {
    it('normalizes uppercase and full locales to the base code', () => {
        expect(get('status_speak', 'HI')).toBe(get('status_speak', 'hi'));
        expect(get('status_speak', 'hi-IN')).toBe(get('status_speak', 'hi'));
        expect(get('status_speak', 'BN')).toBe(get('status_speak', 'bn'));
        expect(get('status_speak', 'bn-BD')).toBe(get('status_speak', 'bn'));
    });

    it('falls back to English for unsupported languages', () => {
        expect(get('status_speak', 'de')).toBe('SPEAK.');
    });
});

describe('getBilingual for hi/bn', () => {
    it('returns structured bilingual data', () => {
        const hi = getBilingual('status_speak', 'hi');
        expect(hi).toEqual({ english: 'SPEAK.', localized: 'बोलिए।', lang: 'hi' });
        const bn = getBilingual('status_speak', 'bn');
        expect(bn).toEqual({ english: 'SPEAK.', localized: 'বলুন।', lang: 'bn' });
    });

    it('returns null localized for English', () => {
        expect(getBilingual('status_speak', 'en').localized).toBeNull();
    });
});

describe('friend-challenge profile link strings', () => {
    const LINK_TEXT = {
        en: 'Practice English with Me',
        es: 'Practica inglés conmigo',
        pt: 'Pratique inglês comigo',
        fr: "Pratique l'anglais avec moi",
        hi: 'मेरे साथ अंग्रेज़ी का अभ्यास करें',
        bn: 'আমার সাথে ইংরেজি চর্চা করুন',
    };
    const AVAILABLE = {
        en: 'Available for 47h 0m',
        es: 'Disponible por 47h 0m',
        pt: 'Disponível por 47h 0m',
        fr: 'Disponible pendant 47h 0m',
        hi: '47h 0m तक उपलब्ध',
        bn: '47h 0m পর্যন্ত উপলব্ধ',
    };

    it.each(Object.entries(LINK_TEXT))('returns the exact link copy for %s', (lang, expected) => {
        expect(get('profile_friend_lesson_link', lang)).toBe(expected);
    });

    it.each(Object.entries(AVAILABLE))('returns the exact countdown copy for %s', (lang, expected) => {
        expect(get('profile_friend_link_available', lang, { time: '47h 0m' })).toBe(expected);
    });

    it('leaves no placeholder behind in any language', () => {
        for (const lang of ['en', 'es', 'pt', 'fr', 'hi', 'bn']) {
            expect(get('profile_friend_link_available', lang, { time: '47h 0m' })).not.toContain('{');
        }
    });
});
