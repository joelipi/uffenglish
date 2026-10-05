import { describe, it, expect } from 'vitest';
import model from './model.json';

// Expected step sequences (responseType, simpleVideoUrl, interactiveVideoUrl,
// introBackgroundVideoUrl) for every lesson. Guards against collateral edits.
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
};

function stepSequence(step) {
    return [
        step.responseType,
        step.simpleVideoUrl || null,
        step.interactiveVideoUrl || null,
        step.introBackgroundVideoUrl || null,
    ];
}

describe('model.json lesson step sequences', () => {
    it('leaves every lesson step sequence unchanged', () => {
        for (const lesson of model.lessons) {
            expect(lesson.steps.map(stepSequence)).toEqual(EXPECTED_SEQUENCES[lesson.lessonId]);
        }
    });

    it('keeps EXPECTED_SEQUENCES in sync with the lessons in model.json', () => {
        // Reverse completeness check: a stale entry (lesson removed from the
        // config) or a missing entry (lesson added) must fail loudly here.
        expect(Object.keys(EXPECTED_SEQUENCES)).toEqual(model.lessons.map((l) => l.lessonId));
    });

    it('contains no friend-challenge (shareCta) lessons', () => {
        const friendLessons = model.lessons
            .filter((l) => l.recapOverlay === 'shareCta' || l.recapSources !== undefined)
            .map((l) => l.lessonId);
        expect(friendLessons).toEqual([]);
    });
});
