// src/config/health.test.js
// The health course: the same ABABAB shape as its wouldyourather sibling,
// with health content instead of preferences.
//
// It is authored the way every course is authored — `health.source.txt` ->
// `public/health.master.csv` -> this config — so this guard pins three
// things:
//
//   1. the SHAPE (7 lessons a..g, 3 ask/answer pairs + a closing lesson, one
//      take per step, a nested branch, the code-owned goodbye),
//   2. the CONTENT (health vocabulary only — the sibling's preference
//      questions must not leak in),
//   3. the PROVENANCE (the committed config is exactly what the committed
//      master CSV generates, so a hand-edited config cannot drift from the
//      sheet it came from).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import health from './health.json';
import {
    FRIEND_CLOSING_LINES,
    buildCourseConfigs,
    parseCsv,
    withCarriedTags,
} from '../../scripts/lib/sheet-config-utils.js';
import { strings } from '../data/strings.js';
import { courseTagStringKey } from '../modules/courses/course-tag-labels.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const LOCALES = ['en', 'es', 'pt', 'bn', 'fr', 'hi'];
const TRANSLATED = ['es', 'pt', 'bn', 'fr', 'hi'];
// A take of the health course: <course>-<lesson>-<step>-<take>.
const TAKE_RE = /^health-[a-g]-\d{2}-\d{2}$/;

/** The lesson title word in every locale ("Health A".."Health G"). */
const TOPIC = {
    en: 'Health',
    es: 'Salud',
    pt: 'Saúde',
    bn: 'স্বাস্থ্য',
    fr: 'Santé',
    hi: 'स्वास्थ्य',
};

/**
 * The health vocabulary the course teaches. Every topic contributes its own
 * words, so a course that swapped a topic for a non-health one loses a term
 * and this guard says which.
 */
const HEALTH_VOCABULARY = [
    'sleep', 'water', 'coffee', 'exercise', 'fruit', 'meat',
    'vitamins', 'medicine', 'doctor', 'vaccine', 'diet', 'habits',
    'problems',
];

/** The sibling course's topic words: none of them may appear in this course. */
const PREFERENCES_VOCABULARY = [
    'million', 'vacation', 'instrument', 'apartment', 'privacy', 'phone', 'salary',
];

/** Every English string the course speaks (cues and branch labels). */
function englishLines() {
    const lines = [];
    for (const lesson of health.lessons) {
        for (const step of lesson.steps) {
            for (const cue of step.cue || []) if (cue.en) lines.push(cue.en);
            for (const choice of step.chooseStep || []) if (choice.text?.en) lines.push(choice.text.en);
        }
    }
    return lines;
}

describe('the health course has the ABABAB shape', () => {
    it('chains seven lessons: three ask/answer pairs and a closing lesson', () => {
        expect(health.lessons.map((l) => l.lessonId)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    });

    it.each(health.lessons.map((l) => l.lessonId))(
        'lesson %s is a respond-then-record lesson (the closing lesson closes instead)',
        (lessonId) => {
            const lesson = health.lessons.find((l) => l.lessonId === lessonId);
            const branches = lesson.steps.filter((s) => s.responseType === 'branching');
            const responses = lesson.steps.filter((s) => s.responseType === 'friendClosedResponse');
            // The seed lesson asks; every later lesson answers AND records —
            // except the chain's CLOSING lesson, which answers and says
            // goodbye instead of recording another question set.
            const expected = lessonId === 'a'
                ? { steps: 16, branches: 3, responses: 12 }
                : lessonId === 'g'
                    ? { steps: 33, branches: 4, responses: 28 }
                    : { steps: 43, branches: 6, responses: 36 };
            expect(lesson.steps).toHaveLength(expected.steps);
            expect(branches).toHaveLength(expected.branches);
            expect(responses).toHaveLength(expected.responses);
        },
    );

    it.each(health.lessons.map((l) => l.lessonId))(
        'every response step in lesson %s plays a take, with a plain-phrase subtitle in all 6 locales',
        (lessonId) => {
            const lesson = health.lessons.find((l) => l.lessonId === lessonId);
            for (const step of lesson.steps) {
                if (step.responseType !== 'friendClosedResponse') continue;
                // Only the closing lesson's goodbye takes have no video: the
                // learner records their own voice, and nothing is published.
                if (!step.simpleVideoUrl) {
                    expect(lessonId, `${lessonId}: text-only response outside the closing block`).toBe('g');
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
        },
    );

    it('the closing lesson has exactly four text-only closing takes', () => {
        const closing = health.lessons
            .find((l) => l.lessonId === 'g').steps
            .filter((s) => s.responseType === 'friendClosedResponse' && !s.simpleVideoUrl);
        expect(closing).toHaveLength(4);
    });

    it('the closing lesson says the code-owned goodbye, in every locale', () => {
        // The sign-off is lesson FRAMING: the generator owns the lines
        // (FRIEND_CLOSING_LINES), the sheet authors questions and answers.
        const lesson = health.lessons.find((l) => l.lessonId === 'g');
        const branch = lesson.steps.findLast((s) => s.responseType === 'branching');
        expect(branch.chooseStep.map((c) => c.text.en)).toEqual(FRIEND_CLOSING_LINES.map((l) => l.en));
        for (const [i, choice] of branch.chooseStep.entries()) {
            for (const locale of LOCALES) {
                expect(choice.text[locale], `goodbye ${i} ${locale}`).toBe(FRIEND_CLOSING_LINES[i][locale]);
            }
        }
    });

    it('no step references a take-group video (the combined video)', () => {
        for (const lesson of health.lessons) {
            for (const step of lesson.steps) {
                const url = step.simpleVideoUrl;
                if (!url || url.includes('{friendCode}')) continue;
                expect(TAKE_RE.test(url), `${lesson.lessonId}: ${url} is not a take`).toBe(true);
            }
        }
    });

    it('the friend clips live in the health namespace, never the sibling course\'s', () => {
        const friendUrls = health.lessons
            .flatMap((l) => l.steps)
            .map((s) => s.simpleVideoUrl || s.introBackgroundVideoUrl || '')
            .filter((url) => url.includes('{friendCode}'));
        expect(friendUrls.length).toBeGreaterThan(0);
        for (const url of friendUrls) {
            expect(url, `${url} is not a health friend clip`).toContain('-health-');
            expect(url, `${url} collides with the sibling course`).not.toContain('wouldyourather');
        }
    });
});

describe('the health course teaches health', () => {
    const lines = englishLines();

    it('speaks a health question in every topic', () => {
        expect(lines.length).toBeGreaterThan(0);
    });

    it.each(HEALTH_VOCABULARY)('teaches the vocabulary word "%s"', (word) => {
        const spoken = lines.join(' ').toLowerCase();
        expect(spoken, `no health line mentions "${word}"`).toContain(word);
    });

    it.each(PREFERENCES_VOCABULARY)('never speaks the sibling course\'s "%s"', (word) => {
        const spoken = lines.join(' ').toLowerCase();
        expect(spoken, `a preferences line leaked into the health course`).not.toContain(word);
    });
});

describe('the health course is localized', () => {
    it('the course name carries every locale', () => {
        expect(typeof health.courseName).toBe('object');
        for (const locale of LOCALES) {
            expect(health.courseName[locale], `courseName/${locale}`).toBeTruthy();
        }
    });

    it.each(health.lessons.map((l) => l.lessonId))(
        'lesson %s is titled "<topic> <letter>" in every locale',
        (lessonId) => {
            const lesson = health.lessons.find((l) => l.lessonId === lessonId);
            for (const locale of LOCALES) {
                expect(lesson.title[locale], `lesson ${lessonId} ${locale} title`)
                    .toBe(`${TOPIC[locale]} ${lessonId.toUpperCase()}`);
            }
        },
    );

    it.each(TRANSLATED)('every %s cue, choice and title is translated, not left in English', (locale) => {
        for (const lesson of health.lessons) {
            expect(lesson.title[locale], `lesson ${lesson.lessonId} missing ${locale} title`).toBeTypeOf('string');
            expect(lesson.title[locale].trim(), `lesson ${lesson.lessonId} ${locale} title is empty`).not.toBe('');
            expect(lesson.title[locale].trim(), `lesson ${lesson.lessonId} ${locale} title is still English`)
                .not.toBe(lesson.title.en.trim());
            for (const step of lesson.steps) {
                for (const cue of step.cue || []) {
                    expect(cue[locale], `lesson ${lesson.lessonId} cue ${locale} is empty`).toBeTypeOf('string');
                    expect(cue[locale].trim(), `lesson ${lesson.lessonId} cue ${locale} is still English`)
                        .not.toBe(cue.en.trim());
                }
                for (const choice of step.chooseStep || []) {
                    expect(choice.text[locale], `lesson ${lesson.lessonId} choice ${locale} is empty`).toBeTypeOf('string');
                    expect(choice.text[locale].trim(), `lesson ${lesson.lessonId} choice ${locale} is still English`)
                        .not.toBe(choice.text.en.trim());
                }
            }
        }
    });

    it.each(TRANSLATED)('every %s mission is translated', (locale) => {
        for (const lesson of health.lessons) {
            expect(lesson.mission[locale], `lesson ${lesson.lessonId} mission/${locale}`).toBeTypeOf('string');
            expect(lesson.mission[locale].trim().length, `lesson ${lesson.lessonId} mission/${locale} is empty`).toBeGreaterThan(0);
        }
    });
});

describe('the health course is the generated one', () => {
    it('the source file declares the health course', () => {
        const source = JSON.parse(
            readFileSync(path.join(ROOT, 'health.source.txt'), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
        );
        expect(source.course).toBe('health');
        expect(source.title).toBe('What is better for your health?');
        expect(source.mission).toBe('talk about health');
        expect(source.tags).toEqual(['health', 'wellness']);
        // The CEFR ladder: the mission dropdown shows these patterns.
        expect(Object.keys(source.levels).sort()).toEqual(['A1', 'A2', 'B1', 'B2', 'C1']);
        expect(source.rungs).toEqual(['A1', 'A2', 'B1', 'B2']);
        // Three ask/answer pairs, and the chain closes on the last one.
        expect(source.pairs.map((p) => [p.ask.id, p.answer.id]))
            .toEqual([['a', 'b'], ['c', 'd'], ['e', 'f']]);
        expect(source.pairs[0].closing).toBeUndefined();
        expect(source.pairs[2].closing.id).toBe('g');
        // Every topic keeps the model's structure: 4 question phrasings, 2
        // branch labels, and 2 answer groups of 4 phrasings.
        for (const pair of source.pairs) {
            expect(pair.topics).toHaveLength(3);
            for (const topic of pair.topics) {
                expect(topic.question).toHaveLength(4);
                expect(topic.choices).toHaveLength(2);
                expect(topic.answers).toHaveLength(2);
                for (const group of topic.answers) expect(group).toHaveLength(4);
            }
        }
    });

    it('the recorder\'s course picker lists the health course', () => {
        const index = JSON.parse(readFileSync(path.join(ROOT, 'public/courses.json'), 'utf8'));
        expect(index.courses).toContain('health');
    });

    it('carries the topics the source declares, each with a translated label', () => {
        const source = readFileSync(path.join(ROOT, 'health.source.txt'), 'utf8');
        const declared = JSON.parse(source.replace(/^\s*\/\/.*$/gm, '')).tags;
        expect(health.tags).toEqual(declared);
        for (const tag of health.tags) {
            const entry = strings[courseTagStringKey(tag)];
            expect(entry, `tag "${tag}" has no label`).toBeTruthy();
            for (const locale of LOCALES) {
                expect(entry[locale], `course_tag_${tag}/${locale}`).toBeTruthy();
            }
        }
    });

    it('is exactly what the committed master CSV generates', () => {
        // The committed sheet is the store every consumer reads, and the
        // generator OVERWRITES the config it owns. So the committed config
        // must be reproducible from the committed sheet (the course name's
        // translations are carried over from the previous file, which is the
        // generator's own `withCarriedTags`).
        const sheet = readFileSync(path.join(ROOT, 'public/health.master.csv'), 'utf8');
        const { rows } = parseCsv(sheet);
        const built = buildCourseConfigs(rows).find((r) => r.courseId === 'health');
        expect(built, 'the committed sheet must define the health course').toBeTruthy();
        expect(built.error, 'the committed sheet must generate the health course').toBeUndefined();
        expect(withCarriedTags(built.config, health)).toEqual(health);
    });
});
