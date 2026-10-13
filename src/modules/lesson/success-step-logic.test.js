import { describe, it, expect } from 'vitest';
import {
    successTypeFor,
    successVideoSlugFor,
    successSubtitlesFor,
    buildSuccessStep,
    applySuccessStep,
    applySuccessSteps,
    SUCCESS_VIDEO_FRIEND,
    SUCCESS_VIDEO_SINGLE_PLAYER,
} from './success-step-logic.js';

const SRT = {
    friend: { en: 'FRIEND EN', es: 'FRIEND ES' },
    'single-player': { en: 'SP EN', es: 'SP ES' },
};

const friendLesson = (extra = {}) => ({ lessonId: 'a', recapOverlay: 'shareCta', steps: [], ...extra });
const singleLesson = (extra = {}) => ({ lessonId: 'm-g', steps: [], ...extra });

describe('successTypeFor', () => {
    it('is "friend" for a share-CTA lesson and "single-player" otherwise', () => {
        expect(successTypeFor(friendLesson())).toBe('friend');
        expect(successTypeFor(singleLesson())).toBe('single-player');
        expect(successTypeFor({ recapOverlay: 'fluency' })).toBe('single-player');
        expect(successTypeFor(undefined)).toBe('single-player');
    });
});

describe('successVideoSlugFor', () => {
    it('maps each type to its canonical slug', () => {
        expect(successVideoSlugFor('friend')).toBe(SUCCESS_VIDEO_FRIEND);
        expect(successVideoSlugFor('single-player')).toBe(SUCCESS_VIDEO_SINGLE_PLAYER);
    });
});

describe('successSubtitlesFor', () => {
    it('returns the captions for the language, falling back to English', () => {
        expect(successSubtitlesFor({ type: 'friend', lang: 'es', srtByType: SRT })).toBe('FRIEND ES');
        expect(successSubtitlesFor({ type: 'friend', lang: 'bn', srtByType: SRT })).toBe('FRIEND EN');
        expect(successSubtitlesFor({ type: 'friend', lang: 'en', srtByType: {} })).toBeUndefined();
    });
});

describe('buildSuccessStep', () => {
    it('uses the type video slug and the localized captions', () => {
        expect(buildSuccessStep({ lesson: friendLesson(), lang: 'es', srtByType: SRT })).toEqual({
            responseType: 'success',
            simpleVideoUrl: SUCCESS_VIDEO_FRIEND,
            subtitles: 'FRIEND ES',
        });
        expect(buildSuccessStep({ lesson: singleLesson(), lang: 'en', srtByType: SRT })).toEqual({
            responseType: 'success',
            simpleVideoUrl: SUCCESS_VIDEO_SINGLE_PLAYER,
            subtitles: 'SP EN',
        });
    });

    it('omits subtitles when none are provided', () => {
        expect(buildSuccessStep({ lesson: friendLesson(), lang: 'en', srtByType: {} }))
            .toEqual({ responseType: 'success', simpleVideoUrl: SUCCESS_VIDEO_FRIEND });
    });
});

describe('applySuccessStep', () => {
    it('appends a canonical success step when the lesson has none', () => {
        const lesson = friendLesson();
        applySuccessStep(lesson, { lang: 'en', srtByType: SRT });
        expect(lesson.steps).toHaveLength(1);
        expect(lesson.steps[0]).toMatchObject({ responseType: 'success', simpleVideoUrl: SUCCESS_VIDEO_FRIEND, subtitles: 'FRIEND EN' });
    });

    it('replaces a course-authored success step (the type is authoritative)', () => {
        const lesson = singleLesson({ steps: [
            { responseType: 'viewAndContinue', simpleVideoUrl: 'intro' },
            { responseType: 'success', simpleVideoUrl: 'success', subtitles: { en: 'legacy' } },
        ] });
        applySuccessStep(lesson, { lang: 'en', srtByType: SRT });
        expect(lesson.steps).toHaveLength(2);
        expect(lesson.steps[1]).toMatchObject({ responseType: 'success', simpleVideoUrl: SUCCESS_VIDEO_SINGLE_PLAYER, subtitles: 'SP EN' });
    });

    it('preserves unknown fields on a config-provided success step', () => {
        const lesson = friendLesson({ steps: [{ responseType: 'success', simpleVideoUrl: 'success', custom: 'keep' }] });
        applySuccessStep(lesson, { lang: 'en', srtByType: SRT });
        expect(lesson.steps[0].custom).toBe('keep');
        expect(lesson.steps[0].simpleVideoUrl).toBe(SUCCESS_VIDEO_FRIEND);
    });

    it('drops inherited captions when the canonical step has none', () => {
        const lesson = friendLesson({ steps: [{ responseType: 'success', simpleVideoUrl: 'success', subtitles: 'legacy' }] });
        applySuccessStep(lesson, { lang: 'en', srtByType: {} });
        expect(lesson.steps[0].simpleVideoUrl).toBe(SUCCESS_VIDEO_FRIEND);
        expect(lesson.steps[0]).not.toHaveProperty('subtitles');
    });

    it('is a no-op for a lesson without a steps array', () => {
        expect(applySuccessStep(null)).toBeNull();
        expect(applySuccessStep({ lessonId: 'x' })).toEqual({ lessonId: 'x' });
    });
});

describe('applySuccessSteps', () => {
    it('applies to every lesson of the config', () => {
        const config = { lessons: [friendLesson(), singleLesson()] };
        applySuccessSteps(config, { lang: 'en', srtByType: SRT });
        expect(config.lessons[0].steps.at(-1).simpleVideoUrl).toBe(SUCCESS_VIDEO_FRIEND);
        expect(config.lessons[1].steps.at(-1).simpleVideoUrl).toBe(SUCCESS_VIDEO_SINGLE_PLAYER);
    });

    it('tolerates a config with no lessons', () => {
        expect(applySuccessSteps(undefined)).toBeUndefined();
        expect(applySuccessSteps({})).toEqual({});
    });
});
