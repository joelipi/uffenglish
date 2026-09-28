import { describe, it, expect } from 'vitest';
import wouldrather from './wouldrather.json';
import { SimpleVideoStateController } from '../modules/video/simple-video-controller.js';

// Lesson "a" of wouldrather.json ships timed SRT captions for its two
// non-response simple-video steps (the instruction video `testvideointro` and
// the `enda` success video). SimpleVideoStateController parses a subtitle
// string containing "-->" as timed cues; anything else scrolls as static text,
// so these assertions guard the player-rendering path as well as the content.

const LOCALES = ['en', 'es', 'pt', 'bn'];

const LESSON_A_CAPTION_STEPS = [
    { label: 'intro viewAndContinue (testvideointro)', responseType: 'viewAndContinue', slug: 'testvideointro' },
    { label: 'success (enda)', responseType: 'success', slug: 'enda' },
];

function lessonA() {
    return wouldrather.lessons.find((lesson) => lesson.lessonId === 'a');
}

function findStep({ responseType, slug }) {
    return lessonA().steps.find(
        (step) => step.responseType === responseType && step.simpleVideoUrl === slug
    );
}

function parseCueCount(srt) {
    const controller = new SimpleVideoStateController({});
    controller.initSubtitles(srt);
    return { isTimed: controller.state.isTimedSubtitles, count: controller.state.timedSubtitles.length };
}

describe('wouldrather.json lesson a — simple-video subtitles', () => {
    it('has lesson a', () => {
        expect(lessonA()).toBeDefined();
    });

    it.each(LESSON_A_CAPTION_STEPS)('provides subtitles for $label', (target) => {
        const step = findStep(target);
        expect(step, `missing step for ${target.slug}`).toBeDefined();
        expect(step.subtitles, `${target.slug} has no subtitles`).toBeTypeOf('object');
        for (const locale of LOCALES) {
            expect(step.subtitles[locale], `${target.slug} missing ${locale}`).toBeTypeOf('string');
            expect(step.subtitles[locale].trim().length, `${target.slug} ${locale} is empty`).toBeGreaterThan(0);
        }
    });

    it.each(LESSON_A_CAPTION_STEPS)('parses $label subtitles as timed SRT cues', (target) => {
        const step = findStep(target);
        for (const locale of LOCALES) {
            const { isTimed, count } = parseCueCount(step.subtitles[locale]);
            expect(isTimed, `${target.slug} ${locale} is not timed`).toBe(true);
            expect(count, `${target.slug} ${locale} has no cues`).toBeGreaterThan(0);
        }
    });

    it.each(LESSON_A_CAPTION_STEPS)('keeps the same cue structure across locales for $label', (target) => {
        const step = findStep(target);
        const counts = LOCALES.map((locale) => parseCueCount(step.subtitles[locale]).count);
        expect(new Set(counts).size).toBe(1);
    });
});
