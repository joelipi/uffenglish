import { describe, it, expect } from 'vitest';
import model from './model.json';

const WF_TRANSCRIPT_EN =
    'Now you will record yourself asking your friends 3 questions using the phrase Would you rather... You will repeat each question exactly. Press the button below to continue.';

const RESPONSE_TYPES = ['closedResponse', 'openResponse', 'friendClosedResponse'];

// Expected step sequences (responseType, simpleVideoUrl, interactiveVideoUrl,
// introBackgroundVideoUrl) for every lesson. Guards against collateral edits:
// only `wf` may change, and only by inserting the post-intro viewAndContinue step.
const EXPECTED_SEQUENCES = {
    'm-t': [
        ['lessonIntro', null, null, 'do_you_have_rolls_too'],
        ['viewAndContinue', 'do_you_have_rolls_too', null, null],
        ['closedResponse', 'do_you_have_dark_chocolate', null, null],
        ['closedResponse', null, 'do_you_have_rolls_too', null],
        ['closedResponse', null, 'do_you_have_very_bitter_dark_chocolate', null],
        ['closedResponse', null, 'where_is_the_bread_aisle', null],
        ['openResponse', null, 'gtests-1-1', null],
        ['openResponse', null, 'gtests-1-2', null],
        ['success', 'success', null, null],
    ],
    'm-g': [
        ['lessonIntro', null, null, 'do_you_have_dark_chocolate'],
        ['closedResponse', null, 'do_you_have_rolls_too', null],
        ['closedResponse', 'do_you_have_dark_chocolate', null, null],
        ['openResponse', null, 'do_you_have_very_bitter_dark_chocolate', null],
        ['openResponse', null, 'where_is_the_bread_aisle', null],
        ['success', 'success', null, null],
    ],
    'm-h': [
        ['lessonIntro', null, null, 'do_you_have_dark_chocolate'],
        ['openResponse', null, 'do_you_have_rolls_too', null],
        ['openResponse', null, 'do_you_have_very_bitter_dark_chocolate', null],
        ['openResponse', null, 'where_is_the_bread_aisle', null],
        ['success', 'success', null, null],
    ],
    'm-a': [
        ['lessonIntro', null, null, 'gtests-1-0'],
        ['closedResponse', 'gtests-1-0', null, null],
        ['closedResponse', 'gtests-1-0', null, null],
        ['closedResponse', 'gtests-1-0', null, null],
        ['closedResponse', 'gtests-1-0', null, null],
        ['openResponse', null, 'gtests-1-1', null],
        ['openResponse', null, 'gtests-1-2', null],
        ['openResponse', null, 'gtests-1-3', null],
        ['success', 'success', null, null],
    ],
    test: [
        ['lessonIntro', null, null, 'do_you_have_dark_chocolate'],
        ['closedResponse', null, 'do_you_have_dark_chocolate', null],
        ['closedResponse', 'do_you_have_dark_chocolate', null, null],
        ['openResponse', null, 'do_you_have_rolls_too', null],
        ['success', 'success', null, null],
    ],
    'm-x': [
        ['lessonIntro', null, null, 'do_you_have_rolls_too'],
        ['viewAndContinue', 'do_you_have_rolls_too', null, null],
        ['closedResponse', 'gtests-0-1-1', null, null],
        ['closedResponse', null, 'gtests-0-1-1', null],
        ['success', 'success', null, null],
    ],
    'm-w': [
        ['lessonIntro', null, null, 'testvideo01'],
        ['closedResponse', null, 'testvideo02', null],
        ['closedResponse', null, 'testvideo03', null],
        ['closedResponse', null, 'testvideo04', null],
        ['success', 'testvideo08', null, null],
    ],
    wa: [
        ['lessonIntro', null, null, 'testvideo01'],
        ['viewAndContinue', 'testvideo05', null, null],
        ['friendClosedResponse', null, '{friendCode}model-w-response-01', null],
        ['viewAndContinue', 'testvideo06', null, null],
        ['friendClosedResponse', null, '{friendCode}model-w-response-02', null],
        ['viewAndContinue', 'testvideo07', null, null],
        ['friendClosedResponse', null, '{friendCode}model-w-response-03', null],
        ['success', 'testvideo08', null, null],
    ],
    wf: [
        ['lessonIntro', null, null, 'testvideo01'],
        ['viewAndContinue', 'testvideo01', null, null],
        ['friendClosedResponse', 'testvideo02', null, null],
        ['friendClosedResponse', 'testvideo03', null, null],
        ['friendClosedResponse', 'testvideo04', null, null],
        ['success', 'testvideo08', null, null],
    ],
    wfa: [
        ['lessonIntro', null, null, 'testvideo01'],
        ['viewAndContinue', 'testvideo05', null, null],
        ['friendClosedResponse', null, '{friendCode}model-wf-response-01', null],
        ['viewAndContinue', 'testvideo06', null, null],
        ['friendClosedResponse', null, '{friendCode}model-wf-response-02', null],
        ['viewAndContinue', 'testvideo07', null, null],
        ['friendClosedResponse', null, '{friendCode}model-wf-response-03', null],
        ['success', 'testvideo08', null, null],
    ],
};

function stepSequence(step) {
    return [
        step.responseType,
        step.simpleVideoUrl || null,
        step.interactiveVideoUrl || null,
        step.introBackgroundVideoUrl || null,
    ];
}

describe('model.json — WF post-intro viewAndContinue step', () => {
    const wf = model.lessons.find((l) => l.lessonId === 'wf');

    it('has a wf lesson', () => {
        expect(wf).toBeDefined();
    });

    it('keeps the lessonIntro as the first step', () => {
        expect(wf.steps[0].responseType).toBe('lessonIntro');
    });

    it('inserts a viewAndContinue step at index 1 with simpleVideoUrl testvideo01', () => {
        expect(wf.steps[1].responseType).toBe('viewAndContinue');
        expect(wf.steps[1].simpleVideoUrl).toBe('testvideo01');
    });

    it('gives the new step localized subtitles in en, es, and pt', () => {
        const subtitles = wf.steps[1].subtitles;
        expect(subtitles).toBeTypeOf('object');
        for (const locale of ['en', 'es', 'pt']) {
            expect(subtitles[locale]).toBeTypeOf('string');
            expect(subtitles[locale].trim().length).toBeGreaterThan(0);
        }
    });

    it('uses the verbatim testvideo01 spoken script as the en subtitle', () => {
        expect(wf.steps[1].subtitles.en).toBe(WF_TRANSCRIPT_EN);
    });

    it('keeps the first response step at index 2 as friendClosedResponse/testvideo02', () => {
        const firstResponseIndex = wf.steps.findIndex((s) => RESPONSE_TYPES.includes(s.responseType));
        expect(firstResponseIndex).toBe(2);
        expect(wf.steps[firstResponseIndex].responseType).toBe('friendClosedResponse');
        expect(wf.steps[firstResponseIndex].simpleVideoUrl).toBe('testvideo02');
    });

    it('has exactly 6 steps in wf', () => {
        expect(wf.steps.length).toBe(6);
    });

    it('removes wf.nextLessonId so wf does not auto-advance to wfa', () => {
        expect(wf.nextLessonId).toBeUndefined();
    });

    it('leaves every lesson step sequence unchanged except the wf insertion', () => {
        for (const lesson of model.lessons) {
            expect(lesson.steps.map(stepSequence)).toEqual(EXPECTED_SEQUENCES[lesson.lessonId]);
        }
    });

    it('keeps EXPECTED_SEQUENCES in sync with the lessons in model.json', () => {
        // Reverse completeness check: a stale entry (lesson removed from the
        // config) or a missing entry (lesson added) must fail loudly here.
        expect(Object.keys(EXPECTED_SEQUENCES)).toEqual(model.lessons.map((l) => l.lessonId));
    });
});
