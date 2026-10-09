import { describe, it, expect } from 'vitest';
import Strings, { get, getBilingual } from './strings.js';

// Story 056: the friend-practice profile copy + the public course-listings copy.
// `getBilingual` reports `.localized === null` when a language entry is missing,
// so it is the reliable way to assert every language variant exists.
const KEYS = {
    profile_friend_practice_heading: 'Practice English with Me Free',
    profile_friend_practice_subheading: 'click on a lesson link to start.',
    profile_friend_lessons_expired: "All this user's lessons have expired after 48 hours, start a new lesson and send them the link to get them back into practicing English.",
    profile_friend_practice_free: 'Practice English Free',
    friend_courses_heading: 'Choose a conversation to have with your friends and practice English with them free.',
    friend_courses_step_1: 'Complete the first mini lesson in under five minutes.',
    friend_courses_step_2: 'Share your special link with friends, family, and colleagues so that they can reply to you and continue the conversation.',
    friend_courses_empty: 'No friend courses are available right now. Please check back soon.',
    friend_courses_lesson_count: '{count} lessons',
};

const LANGS = ['es', 'pt', 'fr', 'hi', 'bn'];

describe('friend-practice / friend-courses strings', () => {
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

    it('interpolates {count} in the lesson-count string', () => {
        expect(get('friend_courses_lesson_count', 'en', { count: 5 })).toBe('5 lessons');
        expect(get('friend_courses_lesson_count', 'es', { count: 5 })).toBe('5 lecciones');
    });

    it('returns the localized subheading for es, not the English fallback', () => {
        expect(get('profile_friend_practice_subheading', 'es')).toBe('haz clic en un enlace de lección para empezar.');
        expect(get('profile_friend_practice_subheading', 'es'))
            .not.toBe('click on a lesson link to start.');
    });

    it('is reachable through the default export', () => {
        expect(Strings.get('friend_courses_heading', 'en')).toBe(KEYS.friend_courses_heading);
    });
});
