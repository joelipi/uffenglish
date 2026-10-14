// Unit tests for the source -> master-sheet bridge (Option A). The bridge output
// must satisfy every existing consumer, so the strongest test feeds it through
// the real generator (parseCsv + buildCourseConfig) and asserts the structure.
import { describe, it, expect } from 'vitest';
import {
    BLANK_RUNG,
    MASTER_HEADER,
    parseSourceConfig,
    overlayFor,
    csvField,
    sourceToRows,
    rowsToCsv,
} from './source-bridge-utils.js';
import { parseCsv, buildCourseConfig } from './sheet-config-utils.js';

const SOURCE = {
    course: 'demo',
    title: 'Demo Course',
    video_title: 'Demo Title',
    mission: 'talk demo',
    levels: { A1: 'X', A2: 'Y', B1: 'Z', B2: 'W', C1: 'V' },
    rungs: ['A1', 'A2'],
    pairs: [
        {
            ask: { id: 'a', title: 'Ask things' },
            answer: { id: 'b', title: 'Answer things' },
            topics: [
                {
                    question: ['Q1?', 'Which is better, Q1?'],
                    choices: ['Pick one', 'Pick two', 'Pick three'],
                    answers: [['A1.', 'A1 is better.'], ['A2.', 'A2 is better.'], ['A3.', 'A3 is better.']],
                },
            ],
        },
    ],
};

describe('parseSourceConfig', () => {
    it('strips full-line // comments, then strict-parses', () => {
        expect(parseSourceConfig('// note\n{"course":"c"}')).toEqual({ course: 'c' });
    });

    it('throws with context on invalid JSON', () => {
        expect(() => parseSourceConfig('{nope')).toThrow(/not valid JSON/);
    });
});

describe('overlayFor', () => {
    it('fills progressively: plain above, bold current, blank below', () => {
        const phrases = ['one', 'two'];
        expect(overlayFor(phrases, ['A1', 'A2'], 0)).toBe(
            `<aside><strong><b>A1</b> one</strong><br><b>A2</b> ${BLANK_RUNG}</aside>`
        );
        expect(overlayFor(phrases, ['A1', 'A2'], 1)).toBe(
            `<aside><b>A1</b> one<br><strong><b>A2</b> two</strong></aside>`
        );
    });

    it('matches the observed sheet cell shape (take 2 of c01)', () => {
        expect(overlayFor(
            ['Speak every language or play every instrument?',
                'Which is better: speaking every language or playing every instrument?'],
            ['A1', 'A2'], 1, 'c01'
        )).toBe(
            '<aside><b>A1</b> Speak every language or play every instrument?' +
            '<br><strong><b>A2</b> Which is better: speaking every language or playing every instrument?</strong></aside>'
        );
    });

    it('throws naming the step on out-of-range take index', () => {
        expect(() => overlayFor(['a', 'b'], ['A1', 'A2'], 2, 'b topic 1'))
            .toThrow(/b topic 1.*take index 2 is out of range/);
    });

    it('throws naming the step when phrases and rungs disagree', () => {
        expect(() => overlayFor(['a', 'b', 'c'], ['A1', 'A2'], 0, 'b topic 1'))
            .toThrow(/b topic 1.*3 phrase\(s\) but 2 rung/);
    });
});

describe('csvField', () => {
    it('quotes commas, quotes, and newlines (RFC-4180)', () => {
        expect(csvField('plain')).toBe('plain');
        expect(csvField('a,b')).toBe('"a,b"');
        expect(csvField('say "hi"')).toBe('"say ""hi"""');
        expect(csvField('l1\nl2')).toBe('"l1\nl2"');
    });
});

describe('sourceToRows slugs', () => {
    it('derives step, take, and friend slugs from position', () => {
        const rows = sourceToRows(SOURCE);
        const videos = [...new Set(rows.map((r) => r.video_file))];
        expect(videos).toEqual([
            'demo-a-01',
            'demo-a-01', // reuse rows share the ask slug (no takes of their own)
            '{friendCode}{selfCode}-demo-a-01',
            'demo-b-01', 'demo-b-02', 'demo-b-03',
        ].filter((v, i, a) => a.indexOf(v) === i));
        const takes = rows.filter((r) => r.filename).map((r) => r.filename);
        expect(takes).toEqual([
            'demo-a-01-01', 'demo-a-01-02',
            'demo-b-01-01', 'demo-b-01-02',
            'demo-b-02-01', 'demo-b-02-02',
            'demo-b-03-01', 'demo-b-03-02',
        ]);
    });
});

describe('sourceToRows routing', () => {
    it('emits positional choice targets and advance-past-group next_steps', () => {
        const rows = sourceToRows(SOURCE);
        const branch = rows.find((r) => r.response_type === 'branching');
        expect(branch.choose_step_next).toBe('1\n2\n3');
        expect(branch.choose_step_text).toBe('Pick one\nPick two\nPick three');
        const options = rows.filter((r) => r.video_file.startsWith('demo-b-'));
        expect(options.map((r) => r.next_step)).toEqual(['3', '3', '2', '2', '1', '1']);
    });

    it('throws when choices and answer groups disagree', () => {
        const bad = structuredClone(SOURCE);
        bad.pairs[0].topics[0].answers.push(['Extra.']);
        expect(() => sourceToRows(bad)).toThrow(/3 choice\(s\) but 4 answer group/);
        delete bad.pairs[0].topics[0].answers;
        expect(() => sourceToRows(bad)).toThrow(/3 choice\(s\) but no answer group/);
    });
});

describe('sourceToRows lesson framing', () => {
    it('points intro_video at each lesson first video; ask=none, answer=friend', () => {
        const rows = sourceToRows(SOURCE);
        const ask = rows.filter((r) => r.lesson_id === 'a');
        const ans = rows.filter((r) => r.lesson_id === 'b');
        expect(new Set(ask.map((r) => r.intro_video))).toEqual(new Set(['demo-a-01']));
        expect(new Set(ans.map((r) => r.intro_video))).toEqual(new Set(['{friendCode}{selfCode}-demo-a-01']));
        expect(new Set(ask.map((r) => r.recap_sources))).toEqual(new Set(['none']));
        expect(new Set(ans.map((r) => r.recap_sources))).toEqual(new Set(['friend']));
        expect(new Set(rows.map((r) => r.recap_overlay))).toEqual(new Set(['shareCta']));
    });

    it('emits levels, title, and mission consistently on every row', () => {
        const rows = sourceToRows(SOURCE);
        for (const r of rows) {
            expect(r.a1).toBe('X');
            expect(r.title_text).toBe('Demo Title');
            expect(r.mission).toBe('talk demo');
        }
    });

    it('throws instead of serializing a malformed level object', () => {
        const bad = structuredClone(SOURCE);
        bad.levels = { A1: { fr: 'x' } };
        expect(() => sourceToRows(bad)).toThrow(/level "A1" must be a string or \{en\} object/);
    });

    it('emits no success columns (the success step is app-injected)', () => {
        const rows = sourceToRows(SOURCE);
        expect(rows.every((r) => !r.success_video && !r.success_srt)).toBe(true);
    });
});

describe('MASTER_HEADER parity with the shared column contracts', () => {
    // The bridge must not be a third, hand-drifted copy of the master column
    // contract: pin it to the seed's config columns, the shared localization
    // field map, and the level-pattern columns.
    it('contains every config column the seed declares', async () => {
        const { CONFIG_COLUMNS } = await import('../../scripts/seed-master-columns.mjs');
        for (const col of CONFIG_COLUMNS) expect(MASTER_HEADER).toContain(col);
    });

    it('contains every derived localization column', async () => {
        const { LOCALIZATION_FIELDS, SHEET_LANGUAGES, localizedColumn } =
            await import('./sheet-translate-utils.js');
        for (const f of LOCALIZATION_FIELDS) {
            for (const lang of SHEET_LANGUAGES) {
                expect(MASTER_HEADER).toContain(localizedColumn(f.field, lang));
            }
        }
    });

    it('emits the sound-effect columns with the casing the pipeline reads', () => {
        // video_pipeline.py safe_get_value is case-sensitive; the live sheet's
        // lower-case spellings are silently ignored there.
        for (const col of ['bgSound', 'endSoundEffect', 'bgMusic']) {
            expect(MASTER_HEADER).toContain(col);
        }
        expect(MASTER_HEADER).toContain('dutch_tilt');
    });

    it('emits the level-pattern columns from the generator (never re-declared)', async () => {
        const { LEVEL_PATTERN_COLUMNS: generatorLevels } = await import('./sheet-config-utils.js');
        for (const col of generatorLevels) expect(MASTER_HEADER).toContain(col);
    });

    it('has no duplicate columns', () => {
        expect(new Set(MASTER_HEADER).size).toBe(MASTER_HEADER.length);
    });
});

describe('bridge round-trip through the real generator', () => {
    it('leaves no required column missing (the recorder/generator gate)', async () => {
        const { findMissingColumns } = await import('./sheet-config-utils.js');
        const { rows } = parseCsv(rowsToCsv(sourceToRows(SOURCE)));
        expect(findMissingColumns(rows)).toEqual([]);
    });

    it('parseCsv + buildCourseConfig accepts the output and builds both lessons', () => {
        const csv = rowsToCsv(sourceToRows(SOURCE));
        // The CSV quotes and newlines survive a real parse.
        const { rows } = parseCsv(csv);
        expect(rows.length).toBeGreaterThan(0);
        const config = buildCourseConfig(rows);
        expect(config.courseId).toBe('demo');
        expect(config.lessons.map((l) => l.lessonId)).toEqual(['a', 'b']);
        // The old generator synthesizes the lessonIntro opener from intro_video…
        for (const lesson of config.lessons) {
            expect(lesson.steps[0].responseType).toBe('lessonIntro');
        }
        expect(config.lessons[0].steps[0].introBackgroundVideoUrl).toBe('demo-a-01');
        // …and emits no success step (AppLayout injects it at runtime).
        expect(config.lessons.flatMap((l) => l.steps).some((s) => s.responseType === 'success')).toBe(false);
        // The ask cue is the two phrases in order; the branch carries 3 choices.
        const ask = config.lessons[0].steps.find((s) => s.simpleVideoUrl === 'demo-a-01');
        expect(ask.cue).toEqual([{ en: 'Q1?' }, { en: 'Which is better, Q1?' }]);
        const branch = config.lessons[1].steps.find((s) => s.responseType === 'branching');
        expect(branch.chooseStep.map((c) => c.nextStep)).toEqual([1, 2, 3]);
        // Reuse rows expand to a full step republished under the ask lesson.
        const repub = config.lessons[1].steps.find((s) => s.publishLessonId === 'a');
        expect(repub.simpleVideoUrl).toBe('demo-a-01');
        expect(repub.cue).toHaveLength(2);
    });
});
