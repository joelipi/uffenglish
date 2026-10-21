// src/config/ababab-generated-contract.test.js
// The generated config and the hand-written model must agree.
//
// src/config/wouldyourather.json is GENERATED from
// public/wouldyourather.master.csv (which the bridge builds from
// wouldyourather.source.txt). src/config/wouldyourather-test.json is the
// hand-written MODEL of the same shape. Story 075 wrote the model by hand;
// story 076 taught the generator to produce it. If the two ever drift, the
// generator has stopped producing the agreed shape.
//
// The two differ only where they must: the model is the TEST course, so its
// friend-clip slugs carry the `-test` course prefix, and the course-level
// `tags` live on the generated file's source.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import generated from './wouldyourather.json';
import model from './wouldyourather-test.json';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const LOCALES = ['en', 'es', 'pt', 'bn', 'fr', 'hi'];
const TAKE_RE = /^wouldyourather-[a-f]-\d{2}-\d{2}$/;

/**
 * The model is the TEST course, so its FRIEND clips live in that course's
 * UGC namespace (`-test-`). The take videos are the teacher's own server
 * assets, shared by both courses, so they match as they are.
 */
const asRealCourse = (value) => JSON.parse(
    JSON.stringify(value).replace(/wouldyourather-test-/g, 'wouldyourather-')
);

describe('the generated config matches the hand-written ABABAB model', () => {
    it('has the same lessons in the same order', () => {
        expect(generated.lessons.map((l) => l.lessonId))
            .toEqual(model.lessons.map((l) => l.lessonId));
    });

    it.each(model.lessons.map((l) => l.lessonId))(
        'lesson %s has the same steps as the model',
        (lessonId) => {
            const gen = generated.lessons.find((l) => l.lessonId === lessonId);
            const hand = model.lessons.find((l) => l.lessonId === lessonId);
            expect(asRealCourse(hand.steps), `lesson ${lessonId} steps`).toEqual(gen.steps);
            expect(gen.recapSources, `lesson ${lessonId} recapSources`).toBe(hand.recapSources);
            expect(asRealCourse(gen.title), `lesson ${lessonId} title`).toEqual(hand.title);
        }
    );

    it('the generated course carries the tags the source declares', () => {
        const source = readFileSync(path.join(ROOT, 'wouldyourather.source.txt'), 'utf8');
        const declared = JSON.parse(source.replace(/^\s*\/\/.*$/gm, '')).tags;
        expect(generated.tags).toEqual(declared);
    });
});

describe('the generated config is course-agnostic in shape', () => {
    it.each(generated.lessons.map((l) => l.lessonId))(
        'lesson %s is a respond-then-record lesson (the terminal one closes)',
        (lessonId) => {
            const lesson = generated.lessons.find((l) => l.lessonId === lessonId);
            const branches = lesson.steps.filter((s) => s.responseType === 'branching');
            const responses = lesson.steps.filter((s) => s.responseType === 'friendClosedResponse');
            // The seed lesson asks; every later lesson answers AND records —
            // except the chain's terminal lesson, which closes instead.
            const expected = lessonId === 'a'
                ? { steps: 16, branches: 3, responses: 12 }
                : lessonId === 'f'
                    ? { steps: 33, branches: 4, responses: 28 }
                    : { steps: 43, branches: 6, responses: 36 };
            expect(lesson.steps).toHaveLength(expected.steps);
            expect(branches).toHaveLength(expected.branches);
            expect(responses).toHaveLength(expected.responses);
        }
    );

    it.each(generated.lessons.map((l) => l.lessonId))(
        'every response step in lesson %s plays a take or is a text-only closing take, with a plain-phrase subtitle in all 6 locales',
        (lessonId) => {
            const lesson = generated.lessons.find((l) => l.lessonId === lessonId);
            for (const step of lesson.steps) {
                if (step.responseType !== 'friendClosedResponse') continue;
                // Only the terminal lesson's goodbye takes have no video: the
                // learner records their own voice, and nothing is published.
                if (!step.simpleVideoUrl) {
                    expect(lessonId, `${lessonId}: text-only response outside the closing block`).toBe('f');
                    expect(step.publishLessonId, `${lessonId}: a closing take publishes nothing`).toBeUndefined();
                } else {
                    expect(TAKE_RE.test(step.simpleVideoUrl), `${lessonId}: ${step.simpleVideoUrl}`).toBe(true);
                }
                expect(step.cue, `${lessonId}: ${step.simpleVideoUrl || 'closing'} cue count`).toHaveLength(1);
                expect(Object.keys(step.subtitles || {}), `${lessonId}: ${step.simpleVideoUrl || 'closing'} locales`)
                    .toHaveLength(LOCALES.length);
                for (const locale of LOCALES) {
                    const text = step.subtitles[locale];
                    expect(text, `${lessonId}: ${step.simpleVideoUrl || 'closing'} ${locale}`).toBeTypeOf('string');
                    expect(text, `${lessonId}: ${step.simpleVideoUrl || 'closing'} ${locale} carries timings`).not.toContain('-->');
                    expect(text, `${lessonId}: ${step.simpleVideoUrl || 'closing'} ${locale} != its cue`).toBe(step.cue[0][locale]);
                }
            }
        }
    );

    it('the terminal lesson has exactly four text-only closing takes', () => {
        const closing = generated.lessons
            .find((l) => l.lessonId === 'f').steps
            .filter((s) => s.responseType === 'friendClosedResponse' && !s.simpleVideoUrl);
        expect(closing).toHaveLength(4);
    });

    it('no step references a take-group video (the combined video)', () => {
        for (const lesson of generated.lessons) {
            for (const step of lesson.steps) {
                const url = step.simpleVideoUrl;
                if (!url || url.includes('{friendCode}')) continue;
                expect(TAKE_RE.test(url), `${lesson.lessonId}: ${url} is not a take`).toBe(true);
            }
        }
    });
});
