// src/config/wouldyourather-test.test.js
// Guard: lesson B of the test config must not carry the longer combined
// video files (wouldyourather-a-01 / -02 / -03) that read all four
// question variants in one take. Only single-take per-variant videos
// (wouldyourather-a-02-01 … wouldyourather-a-03-04) may be used.
//
// The recap steps at the end of lesson B reuse lesson A's video slugs, so
// their subtitle tracks must be the SAME 6-locale, single-phrase tracks
// lesson A uses. Two regressions are guarded here:
//   1. trimming the tracks to English only (a Spanish user then reads
//      English because getLocalizedTranslation falls back to .en), and
//   2. keeping the combined 4-phrase SRT on a 1-phrase video, so the
//      subtitle cues run past the end of the recording.
import { describe, it, expect } from 'vitest';
import wouldyouratherTest from './wouldyourather-test.json';
import { SimpleVideoStateController } from '../modules/video/simple-video-controller.js';

const LOCALES = ['en', 'es', 'pt', 'bn', 'fr', 'hi'];
const LONG_VIDEO_RE = /^wouldyourather-a-0[123]$/;
const RECAP_URLS = ['wouldyourather-a-01-01', 'wouldyourather-a-02-01', 'wouldyourather-a-03-01'];

function parseCues(srt) {
    const controller = new SimpleVideoStateController({});
    controller.initSubtitles(srt);
    return { isTimed: controller.state.isTimedSubtitles, cues: controller.state.timedSubtitles };
}

describe('wouldyourather-test.json — lesson B single-take videos', () => {
    const lessonA = wouldyouratherTest.lessons.find((l) => l.lessonId === 'a');
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
            expect(url, 'friendClosedResponse step missing simpleVideoUrl').toBeDefined();
            expect(
                /^wouldyourather-[abc]-[0-9]+-[0-9]+$/.test(url),
                `friendClosedResponse step uses a non-single-take video: ${url}`,
            ).toBe(true);
        }
    });

    it('the three recap steps use single-take per-variant videos', () => {
        const recapSteps = lessonB.steps.filter((s) => RECAP_URLS.includes(s.simpleVideoUrl));
        expect(recapSteps).toHaveLength(3);
        for (const step of recapSteps) {
            // Single-take: one cue variant, not the four of a combined video.
            expect(step.cue, `${step.simpleVideoUrl} cue variants`).toHaveLength(1);
        }
    });

    it('every recap step carries a subtitle track in all 6 locales', () => {
        for (const step of lessonB.steps) {
            if (!RECAP_URLS.includes(step.simpleVideoUrl)) continue;
            for (const locale of LOCALES) {
                expect(
                    step.subtitles?.[locale],
                    `${step.simpleVideoUrl} missing ${locale} subtitle track`,
                ).toBeTypeOf('string');
                expect(
                    step.subtitles[locale].trim().length,
                    `${step.simpleVideoUrl} ${locale} subtitle track is empty`,
                ).toBeGreaterThan(0);
            }
        }
    });

    it('every recap subtitle track holds exactly the one phrase of its video', () => {
        for (const step of lessonB.steps) {
            if (!RECAP_URLS.includes(step.simpleVideoUrl)) continue;
            for (const locale of LOCALES) {
                const { isTimed, cues } = parseCues(step.subtitles[locale]);
                expect(isTimed, `${step.simpleVideoUrl} ${locale} is not timed SRT`).toBe(true);
                expect(
                    cues.length,
                    `${step.simpleVideoUrl} ${locale} has ${cues.length} cues but the video holds one phrase`,
                ).toBe(1);
            }
        }
    });

    it('recap subtitle tracks match the lesson A track for the same video slug', () => {
        const aByUrl = new Map(lessonA.steps.map((s) => [s.simpleVideoUrl, s]));
        for (const step of lessonB.steps) {
            if (!RECAP_URLS.includes(step.simpleVideoUrl)) continue;
            const a = aByUrl.get(step.simpleVideoUrl);
            expect(a, `lesson A has no step for ${step.simpleVideoUrl}`).toBeDefined();
            for (const locale of LOCALES) {
                expect(
                    step.subtitles[locale],
                    `${step.simpleVideoUrl} ${locale} differs from lesson A`,
                ).toBe(a.subtitles[locale]);
            }
        }
    });
});
