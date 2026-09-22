import { describe, it, expect } from 'vitest';
import { get, getBilingual, strings } from './strings.js';

// Every entry in strings.js must carry hi (Hindi) and bn (Bengali) copy.
// The scripts differ from Latin, so a localized hit is detectable by script.
const DEVANAGARI = /[\u0900-\u097F]/;
const BENGALI = /[\u0980-\u09FF]/;

// Keys that carry {placeholders} — interpolation must survive translation.
const PLACEHOLDER_KEYS = [
    'stats_listening_header',
    'stats_speaking_header',
    'profile_member_since',
    'intent_specific_fail',
];

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

    it('localized copy differs from English for every key', () => {
        for (const key of Object.keys(strings)) {
            expect(get(key, 'hi'), `hi === en for ${key}`).not.toBe(get(key, 'en'));
            expect(get(key, 'bn'), `bn === en for ${key}`).not.toBe(get(key, 'en'));
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
        const hi = get(key, 'hi', { score: 88, date: 'Jan 1', bad_intent: 'angry' });
        const bn = get(key, 'bn', { score: 88, date: 'Jan 1', bad_intent: 'angry' });
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