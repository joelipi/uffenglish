// src/config/wouldyourather-test.test.js
// Guard: lesson B of the test config must not carry the longer combined
// video files (wouldyourather-a-02 / wouldyourather-a-03) that read all four
// question variants in one take. Only single-take per-variant videos
// (wouldyourather-a-02-01 … wouldyourather-a-03-04) may be used.
import { describe, it, expect } from 'vitest';
import wouldyouratherTest from './wouldyourather-test.json';

const LONG_VIDEO_RE = /^wouldyourather-a-0[23]$/;

describe('wouldyourather-test.json — lesson B single-take videos', () => {
    const lessonB = wouldyouratherTest.lessons.find((l) => l.lessonId === 'b');
    expect(lessonB, 'lesson b').toBeDefined();

    it('has no longer combined video files in lesson B', () => {
        for (const step of lessonB.steps) {
            const url = step.simpleVideoUrl || step.introBackgroundVideoUrl;
            expect(url, `${step.responseType} step uses a longer combined video`).not.toMatch(LONG_VIDEO_RE);
        }
    });

    it('every lesson B friendClosedResponse step uses a single-take video', () => {
        for (const step of lessonB.steps) {
            if (step.responseType !== 'friendClosedResponse') continue;
            const url = step.simpleVideoUrl;
            expect(url, `friendClosedResponse step missing simpleVideoUrl`).toBeDefined();
            expect(
                /^wouldyourather-[abc]-[0-9]+-[0-9]+$|^wouldyourather-b-[0-9]+$/.test(url),
                `friendClosedResponse step uses a non-single-take video: ${url}`,
            ).toBe(true);
        }
    });

    it('the two recap steps use single-take per-variant videos', () => {
        const recapSteps = lessonB.steps.filter(
            (s) => s.simpleVideoUrl && /^wouldyourather-a-0[23]-[0-9]+$/.test(s.simpleVideoUrl),
        );
        expect(recapSteps).toHaveLength(2);
        for (const step of recapSteps) {
            // Single-take: one cue variant, one subtitle locale
            expect(step.cue, `${step.simpleVideoUrl} cue variants`).toHaveLength(1);
            expect(Object.keys(step.subtitles || {}), `${step.simpleVideoUrl} subtitle locales`).toHaveLength(1);
        }
    });
});
