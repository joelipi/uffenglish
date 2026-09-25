// src/generated/poster-lqips.test.js
// The committed LQIP module is slug-keyed (stories/011-auto-intro-poster).
import { describe, it, expect } from 'vitest';
import { POSTER_LQIPS, getPosterLqip } from './poster-lqips.js';

const INTRO_SLUGS = [
    'testvideo01',
    'do_you_have_rolls_too',
    'do_you_have_dark_chocolate',
    'gtests-1-0',
    'gtests-0-1-1',
];

describe('poster-lqips module', () => {
    it('returns a base64 jpeg data URI for a teacher intro slug', () => {
        expect(getPosterLqip('do_you_have_rolls_too')).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('returns null for an old lessonId key (no lessonId keys remain)', () => {
        expect(getPosterLqip('t')).toBeNull();
    });

    it('keys every entry by one of the five intro slugs', () => {
        for (const key of Object.keys(POSTER_LQIPS)) {
            expect(INTRO_SLUGS).toContain(key);
        }
    });
});
