// src/config/wouldyourather-test.test.js
// The ABABAB shape of the wouldyourather friend course.
//
// The course is three ask/answer PAIRS of video sets — a-*, b-* (set 1),
// c-*, d-* (set 2), e-*, f-* (set 3) — where every set has 4 question
// variants (takes) and every answer set has 6 groups x 4 phrasings. The
// lessons chain like this:
//
//   A (16)  records the set-1 questions            -> publishes into a
//   B (43)  answers the friend's set-1 clip         -> records the set-1 questions
//   C (43)  answers the friend's set-1 clip         -> records the set-2 questions
//   D (43)  answers the friend's set-2 clip         -> records the set-2 questions
//   E (43)  answers the friend's set-2 clip         -> records the set-3 questions
//   F (43)  answers the friend's set-3 clip         -> records the set-3 questions
//   G (33)  answers the friend's set-3 clip         -> closes (no next set)
//
// Every lesson after A is respond-then-record: the friend's clip opens the
// lesson, the learner answers it, then the learner records the next set's
// question videos. C reuses B's answer videos and E reuses D's — there is
// only one answer video set per topic set, so each is drilled twice.
// G is the chain's CLOSING lesson: nothing follows it, so its second half is
// a code-owned goodbye block (one branch + four text-only takes) instead of
// recording a question set nobody could answer. F still records the set-3
// questions, and G is the lesson that answers them.
//
// These guards use the app's OWN resolvers (resolveNextStepIndex /
// resolveBranchChoices) so they check behaviour, not text.
import { describe, it, expect } from 'vitest';
import wouldyouratherTest from './wouldyourather-test.json';
import { resolveNextStepIndex, resolveBranchChoices } from '../modules/lesson/branch-choice-logic.js';

const LOCALES = ['en', 'es', 'pt', 'bn', 'fr', 'hi'];
const TAKE_RE = /^wouldyourather-[a-g]-\d{2}-\d{2}$/;
const FRIEND_RE = /^\{friendCode\}\{selfCode\}-wouldyourather-test-([a-g])-(\d{2})$/;

// lesson id -> { friendSet, answerSet, recordSet, steps, branchings, responses }
// `recordSet: null` means the lesson closes instead of recording a next set.
const PLAN = {
    a: { friendSet: null, answerSet: null, recordSet: 'a', steps: 16, branchings: 3, responses: 12 },
    b: { friendSet: 'a', answerSet: 'b', recordSet: 'a', steps: 43, branchings: 6, responses: 36 },
    c: { friendSet: 'a', answerSet: 'b', recordSet: 'c', steps: 43, branchings: 6, responses: 36 },
    d: { friendSet: 'c', answerSet: 'd', recordSet: 'c', steps: 43, branchings: 6, responses: 36 },
    e: { friendSet: 'c', answerSet: 'd', recordSet: 'e', steps: 43, branchings: 6, responses: 36 },
    f: { friendSet: 'e', answerSet: 'f', recordSet: 'e', steps: 43, branchings: 6, responses: 36 },
    g: { friendSet: 'e', answerSet: 'f', recordSet: null, steps: 33, branchings: 4, responses: 28 },
};

const lessonById = (id) => wouldyouratherTest.lessons.find((l) => l.lessonId === id);

describe('wouldyourather-test.json — lesson shape', () => {
    it.each(Object.keys(PLAN))('lesson %s has the planned step counts', (id) => {
        const plan = PLAN[id];
        const steps = lessonById(id).steps;
        expect(steps).toHaveLength(plan.steps);
        expect(steps.filter((s) => s.responseType === 'branching')).toHaveLength(plan.branchings);
        expect(steps.filter((s) => s.responseType === 'friendClosedResponse')).toHaveLength(plan.responses);
        expect(steps.filter((s) => s.responseType === 'lessonIntro')).toHaveLength(1);
    });

    it.each(Object.keys(PLAN))('lesson %s is recapSources=%s', (id) => {
        expect(lessonById(id).recapSources).toBe(id === 'a' ? 'none' : 'friend');
    });

    it.each(Object.keys(PLAN))('lesson %s opens on its expected friend clip', (id) => {
        const plan = PLAN[id];
        const steps = lessonById(id).steps;
        const intro = steps.find((s) => s.responseType === 'lessonIntro');
        if (!plan.friendSet) {
            // the seed lesson opens on its own first take
            expect(intro.introBackgroundVideoUrl).toBe('wouldyourather-a-01-01');
            return;
        }
        const want = `{friendCode}{selfCode}-wouldyourather-test-${plan.friendSet}-01`;
        expect(intro.introBackgroundVideoUrl).toBe(want);
        const firstBranch = steps.find((s) => s.responseType === 'branching');
        expect(firstBranch.simpleVideoUrl).toBe(want);
    });
});

describe('wouldyourather-test.json — every response step', () => {
    it.each(Object.keys(PLAN))('lesson %s uses only single-take videos', (id) => {
        for (const step of lessonById(id).steps) {
            if (step.responseType !== 'friendClosedResponse') continue;
            // The closing lesson's goodbye takes are the only text-only
            // response steps: the learner records their own voice.
            if (!step.simpleVideoUrl) {
                expect(id, `${id}: a text-only response step is only allowed in the closing lesson`).toBe('g');
                continue;
            }
            expect(
                TAKE_RE.test(step.simpleVideoUrl),
                `${id}: ${step.simpleVideoUrl} is not a single-take slug`,
            ).toBe(true);
        }
    });

    it.each(Object.keys(PLAN))('lesson %s gives every response step one cue in all 6 locales', (id) => {
        for (const step of lessonById(id).steps) {
            if (step.responseType !== 'friendClosedResponse') continue;
            const label = `${id}/${step.simpleVideoUrl}`;
            expect(step.cue, `${label} cue count`).toHaveLength(1);
            for (const locale of LOCALES) {
                expect(step.cue[0][locale], `${label} cue missing ${locale}`).toBeTypeOf('string');
                expect(step.cue[0][locale].trim().length, `${label} cue ${locale} is empty`).toBeGreaterThan(0);
            }
        }
    });

    it.each(Object.keys(PLAN))('lesson %s gives every response step a plain-phrase subtitle in all 6 locales', (id) => {
        for (const step of lessonById(id).steps) {
            if (step.responseType !== 'friendClosedResponse') continue;
            const label = `${id}/${step.simpleVideoUrl}`;
            expect(Object.keys(step.subtitles || {}), `${label} subtitle locales`).toHaveLength(6);
            for (const locale of LOCALES) {
                const text = step.subtitles?.[locale];
                expect(text, `${label} subtitle ${locale} missing`).toBeTypeOf('string');
                expect(text.trim().length, `${label} subtitle ${locale} is empty`).toBeGreaterThan(0);
                // A single-phrase take needs no timings: the player shows the
                // whole phrase for the video's length (initSubtitles, no "-->").
                expect(text, `${label} subtitle ${locale} still carries SRT timings`).not.toContain('-->');
                expect(text, `${label} subtitle ${locale} does not match its cue`).toBe(step.cue[0][locale]);
            }
        }
    });

    it.each(Object.keys(PLAN))('lesson %s publishes every clip into its video set namespace', (id) => {
        for (const step of lessonById(id).steps) {
            if (step.responseType !== 'friendClosedResponse') continue;
            if (!step.simpleVideoUrl) {
                expect(step.publishLessonId, `${id}: a text-only step publishes nothing`).toBeUndefined();
                continue;
            }
            const set = step.simpleVideoUrl.match(/^wouldyourather-([a-f])-/)[1];
            const want = set === id ? undefined : set;
            expect(
                step.publishLessonId,
                `${id}: ${step.simpleVideoUrl} should publish into ${want}`,
            ).toBe(want);
        }
    });

    it.each(Object.keys(PLAN))('lesson %s answers the answer set it is meant to drill', (id) => {
        const plan = PLAN[id];
        if (!plan.answerSet) return;
        const answerSteps = lessonById(id).steps.filter(
            (s) => s.responseType === 'friendClosedResponse' && s.simpleVideoUrl?.startsWith(`wouldyourather-${plan.answerSet}-`),
        );
        expect(answerSteps, `${id} answer steps`).toHaveLength(24);
        // 6 groups x 4 phrasings
        const groups = new Set(answerSteps.map((s) => s.simpleVideoUrl.split('-').slice(0, 3).join('-')));
        expect(groups.size, `${id} answer groups`).toBe(6);
    });

    it.each(Object.keys(PLAN))('lesson %s records the question set it is meant to record', (id) => {
        const plan = PLAN[id];
        if (!plan.recordSet) return;
        const recordSteps = lessonById(id).steps.filter(
            (s) => s.responseType === 'friendClosedResponse' && s.simpleVideoUrl?.startsWith(`wouldyourather-${plan.recordSet}-`),
        );
        expect(recordSteps, `${id} record steps`).toHaveLength(12);
        const groups = new Set(recordSteps.map((s) => s.simpleVideoUrl.split('-').slice(0, 3).join('-')));
        expect(groups.size, `${id} record groups`).toBe(3);
    });
});

describe('wouldyourather-test.json — the closing lesson closes', () => {
    // G is the last lesson in the chain: the friend who receives its video has
    // nothing left to answer, so the second half is a goodbye, not a question
    // set. The block is code-owned by the generator (FRIEND_CLOSING_LINES).
    it('lesson g ends with one goodbye branch and four text-only takes', () => {
        const steps = lessonById('g').steps;
        const start = steps.findLastIndex((s) => s.responseType === 'branching');
        const closing = steps.slice(start);
        expect(closing, 'closing block size').toHaveLength(5);

        const [branch, ...takes] = closing;
        expect(branch.responseType).toBe('branching');
        expect(branch.simpleVideoUrl, 'the closing prompt is text, not a clip').toBeUndefined();
        expect(branch.chooseStep, 'one goodbye per rung').toHaveLength(4);
        expect(branch.chooseStep.map((c) => c.nextStep)).toEqual([1, 2, 3, 4]);

        for (const take of takes) {
            expect(take.responseType).toBe('friendClosedResponse');
            expect(take.simpleVideoUrl, 'a closing take records the learner, no prompt video').toBeUndefined();
            expect(take.publishLessonId, 'a closing take publishes nothing').toBeUndefined();
            expect(take.cue).toHaveLength(1);
            for (const locale of LOCALES) {
                expect(take.subtitles?.[locale], `closing ${locale}`).toBe(take.cue[0][locale]);
            }
        }
    });

    it('the last closing take ends the lesson', () => {
        const steps = lessonById('g').steps;
        expect(resolveNextStepIndex(steps[steps.length - 1], steps.length - 1)).toBe(steps.length);
    });

    it('no other lesson has a text-only response step', () => {
        for (const lesson of wouldyouratherTest.lessons) {
            if (lesson.lessonId === 'g') continue;
            for (const step of lesson.steps) {
                if (step.responseType !== 'friendClosedResponse') continue;
                expect(step.simpleVideoUrl, `${lesson.lessonId} response step without a take`).toBeTypeOf('string');
            }
        }
    });
});

describe('wouldyourather-test.json — navigation', () => {
    it.each(Object.keys(PLAN))('every branch leaf in lesson %s targets a response step', (id) => {
        const steps = lessonById(id).steps;
        for (const [i, step] of steps.entries()) {
            if (step.responseType !== 'branching') continue;
            const leaves = resolveBranchChoices(step, i, steps.length);
            expect(leaves.length, `${id}/${i} resolved leaves`).toBeGreaterThan(0);
            for (const leaf of leaves) {
                const target = steps[leaf.targetIndex];
                expect(target, `${id}/${i} leaf target ${leaf.targetIndex}`).toBeDefined();
                expect(target.responseType, `${id}/${i} leaf target ${leaf.targetIndex}`).toBe('friendClosedResponse');
            }
        }
    });

    it.each(Object.keys(PLAN))('every branch label in lesson %s is localized', (id) => {
        const steps = lessonById(id).steps;
        for (const [i, step] of steps.entries()) {
            if (step.responseType !== 'branching') continue;
            for (const group of step.chooseStep) {
                for (const locale of LOCALES) {
                    expect(group.text[locale], `${id}/${i} group label ${locale}`).toBeTypeOf('string');
                }
                for (const leaf of group.chooseStep || []) {
                    for (const locale of LOCALES) {
                        expect(leaf.text[locale], `${id}/${i} leaf label ${locale}`).toBeTypeOf('string');
                    }
                }
            }
        }
    });

    it.each(Object.keys(PLAN))('every response step in lesson %s advances to a branch or the end', (id) => {
        const steps = lessonById(id).steps;
        for (const [i, step] of steps.entries()) {
            if (step.responseType !== 'friendClosedResponse') continue;
            const next = resolveNextStepIndex(step, i);
            if (next < steps.length) {
                expect(steps[next].responseType, `${id}/${i} advances to`).toBe('branching');
            }
        }
    });

    it.each(Object.keys(PLAN))('every step in lesson %s is reachable from the first step', (id) => {
        const steps = lessonById(id).steps;
        const seen = new Set([0]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const i of [...seen]) {
                const step = steps[i];
                if (step.responseType === 'branching') {
                    for (const leaf of resolveBranchChoices(step, i, steps.length)) {
                        if (!seen.has(leaf.targetIndex)) { seen.add(leaf.targetIndex); changed = true; }
                    }
                } else {
                    const next = resolveNextStepIndex(step, i);
                    if (next < steps.length && !seen.has(next)) { seen.add(next); changed = true; }
                }
            }
        }
        const unreachable = steps.map((_, i) => i).filter((i) => !seen.has(i));
        expect(unreachable, `${id} unreachable steps`).toEqual([]);
    });
});

describe('wouldyourather-test.json — the friend clip chain', () => {
    it('each lesson answers the clip the previous lesson recorded', () => {
        // The clip a lesson answers is the one the previous lesson republished
        // into that set's namespace: B and C answer the a-questions, D and E
        // the c-questions, F and G the e-questions.
        const answered = {};
        for (const lesson of wouldyouratherTest.lessons) {
            const intro = lesson.steps.find((s) => s.responseType === 'lessonIntro');
            const m = FRIEND_RE.exec(intro.introBackgroundVideoUrl || '');
            answered[lesson.lessonId] = m ? m[1] : null;
        }
        expect(answered).toEqual({
            a: null, b: 'a', c: 'a', d: 'c', e: 'c', f: 'e', g: 'e',
        });
    });

    it('the friend clip indices are 01..03, one per topic', () => {
        for (const lesson of wouldyouratherTest.lessons) {
            if (lesson.lessonId === 'a') continue;
            const indices = lesson.steps
                .filter((s) => FRIEND_RE.test(s.simpleVideoUrl || ''))
                .map((s) => FRIEND_RE.exec(s.simpleVideoUrl)[2]);
            expect(indices, `${lesson.lessonId} friend clip indices`).toEqual(['01', '02', '03']);
        }
    });
});
