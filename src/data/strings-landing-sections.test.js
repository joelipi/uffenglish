import { describe, it, expect } from 'vitest';
import Strings, { get, getBilingual, strings } from './strings.js';

// Story 059: the public homepage's marketing sections. `getBilingual` reports
// `.localized === null` when a language entry is missing, so it is the reliable
// way to assert every language variant exists (get() falls back to English).
const KEYS = {
    home_landing_how_heading: 'How it works',
    home_landing_how_1: "It's 100% free — no card and no subscription, ever.",
    home_landing_how_2: 'Any English level works, from beginner to advanced. It teaches you what to say.',
    home_landing_how_3: "You don't need to be online at the same time as your friend.",
    home_landing_how_4: 'Answer out loud and get instant feedback on your speaking.',
    home_landing_how_5: "Your friend's videos expire after 48 hours, so start now.",
    home_landing_about_heading: 'About the teacher',
    home_landing_about_credentials: "I have a master's degree in teaching English to speakers of other languages (TESOL) and 20 years of experience teaching English.",
    home_landing_language_label: 'Language',
    home_landing_showcase_heading: 'See what a conversation looks like',
    home_landing_showcase_play: 'Play video',
};

const LANGS = ['es', 'pt', 'fr', 'hi', 'bn'];
const DEVANAGARI = /[\u0900-\u097F]/;
const BENGALI = /[\u0980-\u09FF]/;

describe('homepage landing-section strings', () => {
    it('has the exact English copy for every key', () => {
        for (const [key, en] of Object.entries(KEYS)) {
            expect(getBilingual(key, 'en').english, key).toBe(en);
        }
    });

    it('has a non-empty localized value for es/pt/fr/hi/bn on every key', () => {
        for (const key of Object.keys(KEYS)) {
            for (const lang of LANGS) {
                const bilingual = getBilingual(key, lang);
                expect(bilingual.localized, `${key} ${lang}`).not.toBeNull();
                expect(bilingual.localized.length, `${key} ${lang}`).toBeGreaterThan(0);
            }
        }
    });

    it('returns the localized heading for es, not the English fallback', () => {
        expect(get('home_landing_how_heading', 'es')).toBe('Cómo funciona');
        expect(get('home_landing_how_heading', 'es')).not.toBe('How it works');
    });

    it('renders Hindi / Bengali copy in the right script', () => {
        expect(get('home_landing_how_2', 'hi')).toMatch(DEVANAGARI);
        expect(get('home_landing_how_1', 'bn')).toMatch(BENGALI);
    });

    it('leaves no placeholder behind in any language', () => {
        for (const key of Object.keys(KEYS)) {
            for (const lang of ['en', 'es', 'pt', 'fr', 'hi', 'bn']) {
                const out = get(key, lang);
                expect(out, `${key}/${lang}`).not.toContain('{');
                expect(out, `${key}/${lang}`).not.toContain('}');
            }
        }
    });

    it('carries a raw hi/bn value for every key (so strings.test.js stays green)', () => {
        for (const key of Object.keys(KEYS)) {
            expect(strings[key].hi, `${key}/hi`).toBeTruthy();
            expect(strings[key].bn, `${key}/bn`).toBeTruthy();
        }
    });

    it('is reachable through the default export', () => {
        expect(Strings.get('home_landing_about_heading', 'en')).toBe('About the teacher');
    });
});
