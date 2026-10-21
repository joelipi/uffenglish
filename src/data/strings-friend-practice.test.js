import { describe, it, expect } from 'vitest';
import Strings, { get, getBilingual } from './strings.js';

// Story 056: the friend-practice profile copy + the public course-listings copy.
// `getBilingual` reports `.localized === null` when a language entry is missing,
// so it is the reliable way to assert every language variant exists.
const KEYS = {
    // The invitation names the profile owner, so the copy is a template. It
    // used to be hardcoded English in the component.
    profile_friend_links_heading: 'Click on a lesson to start practicing with {name} right now free!',
    profile_friend_links_subheading: '{name} does not have to be online now, they can respond to you later.',
    profile_friend_start_here: 'Start here',
    profile_friend_lessons_expired: "All this user's lessons have expired after 48 hours, start a new lesson and send them the link to get them back into practicing English.",
    // Variant shown when every OPEN link is already badged for the visitor.
    profile_friend_lessons_all_completed: "There are no open lessons right now. You've already completed them together — start a brand new lesson in a new course and send them the link.",
    profile_friend_practice_free: 'Practice English Free',
    // A profile link is labelled by its POSITION in the course chain, derived
    // from the course config at read time (a stored lesson title went stale
    // after a rename). Two numbers, so it is safe to re-litigate the label.
    profile_friend_lesson_number: 'Lesson {n} of {total}',
    friend_courses_heading: 'Choose a conversation to have with your friends and practice English with them free.',
    // Story 070: signup is lazy, so step 1 now names the account the lesson
    // creates. The under-five-minutes promise is kept — it is what makes
    // deferring the account unalarming.
    friend_courses_step_1: "Complete the first mini lesson in under five minutes. You'll create your free account at the end.",
    friend_courses_step_2: 'Share your special link with friends, family, and colleagues so that they can reply to you and continue the conversation.',
    friend_courses_empty: 'No friend courses are available right now. Please check back soon.',
    friend_courses_lesson_count: '{count} lessons',
    // The signed-out notice at the top of /courses (story 070). Listing them
    // here also puts them under the getBilingual localized-value check below,
    // which reports a genuinely missing locale as null rather than falling
    // back to English.
    courses_guest_notice_title: "You're not signed in",
    courses_guest_notice_body: 'New here? Complete a mini lesson in under five minutes and create your free account at the end.',
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

    it('interpolates both numbers in the profile lesson label', () => {
        expect(get('profile_friend_lesson_number', 'en', { n: 3, total: 6 })).toBe('Lesson 3 of 6');
        expect(get('profile_friend_lesson_number', 'es', { n: 3, total: 6 })).toBe('Lección 3 de 6');
        expect(get('profile_friend_lesson_number', 'fr', { n: 3, total: 6 })).toBe('Leçon 3 sur 6');
        for (const lang of ['pt', 'hi', 'bn']) {
            expect(get('profile_friend_lesson_number', lang, { n: 1, total: 6 }), lang)
                .not.toContain('{');
        }
    });

    it('returns the localized subheading for es, not the English fallback', () => {
        expect(get('profile_friend_links_subheading', 'es', { name: 'Sam' }))
            .toBe('Sam no tiene que estar en línea ahora, puede responderte más tarde.');
        expect(get('profile_friend_links_subheading', 'es', { name: 'Sam' }))
            .not.toBe(get('profile_friend_links_subheading', 'en', { name: 'Sam' }));
    });

    it('is reachable through the default export', () => {
        expect(Strings.get('friend_courses_heading', 'en')).toBe(KEYS.friend_courses_heading);
    });
});
