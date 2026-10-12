import { describe, it, expect } from 'vitest';
import Strings, { get, getBilingual, strings } from './strings.js';

// Story 059: the public homepage's marketing sections. `getBilingual` reports
// `.localized === null` when a language entry is missing, so it is the reliable
// way to assert every language variant exists (get() falls back to English).
const KEYS = {
    home_landing_how_1_title: '100% free',
    home_landing_how_1: 'no subscription, no card needed, ever.',
    home_landing_how_2_title: 'Any English level',
    home_landing_how_2: 'Each lesson teaches multiple forms of the same basic questions and answers, from a very beginner way to an advanced way. For instance, very beginner: "Coffee or tea?" Intermediate: "Would you like coffee or tea?" Advanced: "Would you prefer a steaming mug of fresh-brewed Arabica coffee or a nice cup of tea?"',
    home_landing_how_3_title: 'Practice anytime, anywhere',
    home_landing_how_3: "You don't need to be online at the same time as your friends.",
    home_landing_how_4_title: 'Instant feedback on your speaking',
    home_landing_how_4: "Find out what you said right or wrong. You have an infinite number of attempts to get it right, no pressure.",
    home_landing_how_5_title: 'UFF stands for Ultra <i>Fast</i> Fluency in English',
    home_landing_how_5: 'Each lesson can be completed in less than 5 minutes.',
    home_landing_how_6_title: "Unlike anything you've ever tried before.",
    home_landing_how_6: 'This is never-before-seen technology and a radically different paradigm from the thousands of multiple-choice "gamified" apps that don\'t really teach you how to speak.',
    home_landing_how_7_title: 'It works!',
    home_landing_how_7: 'These are time-tested speaking exercises updated with revolutionary technology.',
    home_landing_how_8_title: 'Gain confidence in speaking.',
    home_landing_how_8: "Re-record yourself as many times as you like. There's no classroom full of people to feel embarrassed in front of.",
    home_landing_how_9_title: "It's fun!",
    home_landing_how_9: 'Ask your friends crazy questions, role play, play trivia games, or even tell jokes!',
    home_landing_how_10_title: 'Get rewarded.',
    home_landing_how_10: 'At the end of each lesson you get a special video of you and your friend you can share publicly or keep forever.',
    home_landing_how_11_title: 'Stay motivated.',
    home_landing_how_11: "You're not just practicing English, you're renewing acquaintances and deepening relationships. And you're seeing real progress in speaking English.",
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
