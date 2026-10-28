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
    carryOverTranslations,
    translationCarryKey,
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
            closing: { id: 'c', title: 'Closing things' },
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

describe('sourceToRows course hero', () => {
    // The source `hero` banner rides the bridge like `course_name` (plain
    // scalar, never translated) so the generator can emit `courseHeroImage`;
    // without it every regeneration wipes the listings-page banner.
    it('carries the source hero onto every row', () => {
        const rows = sourceToRows({ ...SOURCE, hero: 'src/assets/img/demo.jpg' });
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) expect(row.hero).toBe('src/assets/img/demo.jpg');
    });

    it('blanks hero when the source names none', () => {
        const rows = sourceToRows(SOURCE);
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) expect(row.hero).toBe('');
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
    // The bridge must not be a hand-drifted copy of the master column
    // contract: pin it to the columns the generator's master path consumes,
    // the shared localization field map, and the level-pattern columns.
    it('contains every config column the generator master path consumes', async () => {
        const { REQUIRED_COLUMNS } = await import('./sheet-config-utils.js');
        const OPTIONAL_MASTER_COLUMNS = [
            'join', 'recap_sources', 'recap_overlay', 'unit', 'mission',
            'phrase', 'srt', 'next_step', 'choose_step_next', 'choose_step_text',
            'publish_lesson_id', 'intro_video',
        ];
        for (const col of [...REQUIRED_COLUMNS, ...OPTIONAL_MASTER_COLUMNS]) {
            expect(MASTER_HEADER).toContain(col);
        }
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
        // video_pipeline.py safe_get_value is case-sensitive; lower-case
        // spellings of these columns are silently ignored there.
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

describe('carryOverTranslations', () => {
    const translated = (rows) => rows.map((r) => ({
        ...r,
        phrase_es: r.phrase ? `ES:${r.phrase}` : '',
        lesson_title_es: r.lesson_title ? `ES:${r.lesson_title}` : '',
        srt: r.video_file === 'demo-a-01' ? '1\\n00:00 --> 00:01\\nHi' : '',
        srt_es: r.video_file === 'demo-a-01' ? '1\n00:00 --> 00:01\nHola' : '',
    }));

    it('carries lang cells whose English source is byte-identical', () => {
        const next = sourceToRows(SOURCE);
        const { rows, carried } = carryOverTranslations(translated(next), next);
        const take = rows.find((r) => r.filename === 'demo-a-01-01');
        expect(take.phrase_es).toBe('ES:Q1?');
        expect(take.lesson_title_es).toBe('ES:Ask things');
        // The step is unchanged, so the step-level pass restores its English
        // srt first — and the per-row pass then carries the matching srt_es.
        expect(take.srt).toBe('1\\n00:00 --> 00:01\\nHi');
        expect(take.srt_es).toBe('1\n00:00 --> 00:01\nHola');
        expect(carried).toBeGreaterThan(0);
    });

    it('carries srt_es only when the English srt cell is identical', () => {
        const base = sourceToRows(SOURCE);
        const prev = translated(base);
        const sameSrt = base.map((r) => ({
            ...r, srt: r.video_file === 'demo-a-01' ? '1\\n00:00 --> 00:01\\nHi' : '',
        }));
        const { rows } = carryOverTranslations(prev, sameSrt);
        expect(rows.find((r) => r.filename === 'demo-a-01-01').srt_es)
            .toBe('1\n00:00 --> 00:01\nHola');
    });

    it('blanks a step srt when one phrase is reworded (retimes the step)', () => {
        const prev = translated(sourceToRows(SOURCE)).map((r) => ({ ...r }));
        const changed = structuredClone(SOURCE);
        changed.pairs[0].topics[0].question[1] = 'Reworded second line?';
        const { rows } = carryOverTranslations(prev, sourceToRows(changed));
        const step = rows.filter((r) => r.video_file === 'demo-a-01');
        expect(step.every((r) => r.srt === '')).toBe(true);
        expect(step.every((r) => (r.srt_es || '') === '')).toBe(true);
    });

    it('blanks a step srt when take order changes (retimes the step)', () => {
        const mk = (phrases, srt) => phrases.map((phrase, i) => ({
            course_id: 'c', lesson_id: 'a', video_file: 'v',
            filename: `f${i}`, order: String(i + 1), phrase, srt,
        }));
        const prev = mk(['one', 'two'], 'S');
        const next = mk(['two', 'one'], '');
        const { rows, carried } = carryOverTranslations(prev, next);
        expect(rows.every((r) => r.srt === '')).toBe(true);
        expect(carried).toBe(0);
    });

    it('blanks a step srt when only the Order column changes', () => {
        const prev = [
            { course_id: 'c', lesson_id: 'a', video_file: 'v', filename: 'f1', order: '1', phrase: 'one', srt: 'S' },
            { course_id: 'c', lesson_id: 'a', video_file: 'v', filename: 'f2', order: '2', phrase: 'two', srt: 'S' },
        ];
        const next = prev.map((r) => ({ ...r, srt: '' }));
        next[0].order = '2';
        next[1].order = '1';
        const { rows } = carryOverTranslations(prev, next);
        expect(rows.every((r) => r.srt === '')).toBe(true);
    });

    it('keeps step srt across whitespace-only phrase edits', () => {
        const prev = [
            { course_id: 'c', lesson_id: 'a', video_file: 'v', filename: 'f1', order: '1', phrase: 'Q? ', srt: 'S' },
        ];
        const next = [{ ...prev[0], phrase: 'Q?', srt: '' }];
        const { rows } = carryOverTranslations(prev, next);
        expect(rows[0].srt).toBe('S');
    });

    it('keeps per-row translations lesson-scoped for identical reuse rows', () => {
        const prev = [
            { course_id: 'c', lesson_id: 'a', video_file: 'v', filename: '', phrase: 'Q', srt: 'S', srt_es: 'ES-A' },
            { course_id: 'c', lesson_id: 'b', video_file: 'v', filename: '', phrase: 'Q', srt: 'S', srt_es: 'ES-B' },
        ];
        const next = prev.map((r) => ({ ...r, srt: '', srt_es: '' }));
        const { rows } = carryOverTranslations(prev, next);
        expect(rows[0].srt_es).toBe('ES-A');
        expect(rows[1].srt_es).toBe('ES-B');
    });

    it('blanks a step whose committed srt diverges across rows', () => {        const prev = [
            { course_id: 'c', lesson_id: 'a', video_file: 'v', filename: 'f1', order: '1', phrase: 'Q1', srt: 'S1' },
            { course_id: 'c', lesson_id: 'a', video_file: 'v', filename: 'f2', order: '2', phrase: 'Q2', srt: 'S2' },
        ];
        const next = prev.map((r) => ({ ...r, srt: '' }));
        const { rows } = carryOverTranslations(prev, next);
        expect(rows.every((r) => r.srt === '')).toBe(true);
    });

    it('keeps translations when the English srt was already present and uniform', () => {
        // Idempotent regeneration: nothing to fill, nothing dropped.
        const base = [
            { course_id: 'c', lesson_id: 'a', video_file: 'v', filename: 'f1', order: '1', phrase: 'Q1', srt: 'S', srt_es: 'ES' },
            { course_id: 'c', lesson_id: 'a', video_file: 'v', filename: 'f2', order: '2', phrase: 'Q2', srt: 'S', srt_es: 'ES2' },
        ];
        const { rows, carried } = carryOverTranslations(base, base.map((r) => ({ ...r })));
        expect(rows[0].srt_es).toBe('ES');
        expect(rows[1].srt_es).toBe('ES2');
        expect(carried).toBe(0);
    });

    it('drops translations when the next English srt diverges mid-step (cells left untouched)', () => {
        const prev = [
            { course_id: 'c', lesson_id: 'a', video_file: 'v', filename: 'f1', order: '1', phrase: 'Q1', srt: 'S', srt_es: 'ES' },
            { course_id: 'c', lesson_id: 'a', video_file: 'v', filename: 'f2', order: '2', phrase: 'Q2', srt: 'S', srt_es: 'ES' },
        ];
        const next = prev.map((r) => ({ ...r, srt: '', srt_es: '' }));
        next[1].srt = 'OTHER';
        const { rows } = carryOverTranslations(prev, next);
        expect(rows.every((r) => (r.srt_es || '') === '')).toBe(true);
        expect(rows[1].srt).toBe('OTHER');
    });

    it('carries step srt onto blank-phrase rows of an unchanged step', () => {
        const prev = [
            { course_id: 'c', lesson_id: 'a', video_file: 'v', filename: 'f1', phrase: 'Q', srt: 'S' },
            { course_id: 'c', lesson_id: 'a', video_file: 'v', filename: '', phrase: '', srt: 'S' },
        ];
        const next = [
            { course_id: 'c', lesson_id: 'a', video_file: 'v', filename: 'f1', phrase: 'Q', srt: '' },
            { course_id: 'c', lesson_id: 'a', video_file: 'v', filename: '', phrase: '', srt: '' },
        ];
        const { rows } = carryOverTranslations(prev, next);
        expect(rows.map((r) => r.srt)).toEqual(['S', 'S']);
    });

    it('leaves srt blank for steps with no previous match', () => {
        const { rows } = carryOverTranslations([], sourceToRows(SOURCE));
        expect(rows.every((r) => (r.srt || '') === '')).toBe(true);
    });

    it('does not carry when the English source changed (translator refills the blank)', () => {
        const prev = translated(sourceToRows(SOURCE));
        const changed = structuredClone(SOURCE);
        changed.pairs[0].topics[0].question[0] = 'Q1 reworded?';
        const next = sourceToRows(changed);
        const { rows } = carryOverTranslations(prev, next);
        const take = rows.find((r) => r.filename === 'demo-a-01-01');
        expect(take.phrase).toBe('Q1 reworded?');
        expect(take.phrase_es).toBe('');
        // The untouched second take still carries.
        expect(rows.find((r) => r.filename === 'demo-a-01-02').phrase_es)
            .toBe('ES:Which is better, Q1?');
    });

    it('leaves rows with no previous match blank and never mutates its inputs', () => {
        const next = sourceToRows(SOURCE);
        const before = JSON.stringify(next);
        const { rows, carried } = carryOverTranslations([], next);
        expect(carried).toBe(0);
        expect(rows.every((r) => !r.phrase_es && !r.lesson_title_es)).toBe(true);
        expect(JSON.stringify(next)).toBe(before);
    });

    it('keys takes by filename and reuse rows by step+phrase (no cross-talk)', () => {
        const prev = sourceToRows(SOURCE).filter((r) => r.filename);
        const next = sourceToRows(SOURCE).filter((r) => !r.filename);
        expect(prev.length).toBeGreaterThan(0);
        expect(next.length).toBeGreaterThan(0);
        // Same phrases, disjoint key spaces: nothing carries.
        const { carried } = carryOverTranslations(translated(prev), next);
        expect(carried).toBe(0);
        expect(translationCarryKey({ filename: 'x' })).not.toBe(
            translationCarryKey({ filename: '', video_file: 'x', phrase: '' }));
    });
});

describe('bridge round-trip through the real generator', () => {    it('leaves no required column missing (the recorder/generator gate)', async () => {
        const { findMissingColumns } = await import('./sheet-config-utils.js');
        const { rows } = parseCsv(rowsToCsv(sourceToRows(SOURCE)));
        expect(findMissingColumns(rows)).toEqual([]);
    });

    it('parseCsv + buildCourseConfig accepts the output and builds all three lessons', () => {
        const csv = rowsToCsv(sourceToRows(SOURCE));
        // The CSV quotes and newlines survive a real parse.
        const { rows } = parseCsv(csv);
        expect(rows.length).toBeGreaterThan(0);
        const config = buildCourseConfig(rows);
        expect(config.courseId).toBe('demo');
        expect(config.lessons.map((l) => l.lessonId)).toEqual(['a', 'b', 'c']);
        // Every lesson opens on its intro.
        for (const lesson of config.lessons) {
            expect(lesson.steps[0].responseType).toBe('lessonIntro');
        }
        // The ask lesson opens on the first TAKE, and emits no success step
        // (AppLayout injects it at runtime).
        expect(config.lessons[0].steps[0].introBackgroundVideoUrl).toBe('demo-a-01-01');
        expect(config.lessons.flatMap((l) => l.steps).some((s) => s.responseType === 'success')).toBe(false);
        // A step is one TAKE with one phrase: the cue is that phrase alone and
        // the subtitle is the same phrase (no timings).
        const ask = config.lessons[0].steps.find((s) => s.simpleVideoUrl === 'demo-a-01-02');
        expect(ask.cue).toEqual([{ en: 'Which is better, Q1?' }]);
        expect(ask.subtitles).toEqual({ en: 'Which is better, Q1?' });
        // The ask lesson's branch offers the two question phrasings.
        const askBranch = config.lessons[0].steps.find((s) => s.responseType === 'branching');
        expect(askBranch.chooseStep.map((c) => c.nextStep)).toEqual([1, 2]);
        // The answer lesson's branch nests: one group per choice, each with
        // the two phrasings of that answer.
        const branch = config.lessons[1].steps.find((s) => s.responseType === 'branching');
        expect(branch.chooseStep.map((g) => g.text.en)).toEqual(['Pick one', 'Pick two', 'Pick three']);
        expect(branch.chooseStep.map((g) => g.chooseStep.length)).toEqual([2, 2, 2]);
        // This fixture has ONE pair, so its answer lesson still records the
        // question set back into the ask lesson's namespace, and the pair's
        // CLOSING lesson ends the chain: it answers the same questions and
        // closes with the code-owned goodbye block instead of recording a
        // question set nobody could answer. (Reuse-row expansion is covered by
        // the wouldyourather config guards, where lessons b-f are non-terminal.)
        expect(config.lessons[1].steps.some((s) => s.publishLessonId === 'a')).toBe(true);
        const goodbye = config.lessons[2].steps.filter(
            (s) => s.responseType === 'friendClosedResponse' && !s.simpleVideoUrl);
        expect(goodbye).toHaveLength(4);
        const closingBranch = config.lessons[2].steps.findLast((s) => s.responseType === 'branching');
        expect(closingBranch.chooseStep).toHaveLength(4);
        expect(closingBranch.chooseStep.map((c) => c.nextStep)).toEqual([1, 2, 3, 4]);
        // The closing lesson plays the pair's branch (the friend clip) and
        // answers the pair's questions — it is a second answer lesson.
        const closingBranchWithClip = config.lessons[2].steps.find(
            (s) => s.responseType === 'branching' && s.simpleVideoUrl);
        expect(closingBranchWithClip.simpleVideoUrl).toBe('{friendCode}{selfCode}-demo-a-01');
    });

    it('refuses a chain whose last pair has no closing lesson', () => {
        // Without it the chain would end on a question set nobody could
        // answer, and the goodbye would have no home.
        const noClosing = { ...SOURCE, pairs: [{ ...SOURCE.pairs[0], closing: undefined }] };
        const { rows } = parseCsv(rowsToCsv(sourceToRows(noClosing)));
        expect(() => buildCourseConfig(rows)).toThrow(/closing lesson/);
    });

    it('refuses a closing lesson on a pair that is not the last one', () => {
        const twoPairs = {
            ...SOURCE,
            pairs: [
                SOURCE.pairs[0],
                { ...SOURCE.pairs[0], ask: { id: 'd', title: 'D' }, answer: { id: 'e', title: 'E' } },
            ],
        };
        expect(() => sourceToRows(twoPairs)).toThrow(/only the LAST pair/);
    });
});

// stories/099-course-intro-clips: three short course-level opener clips,
// authored as ARRAYS OF SHORT LINES in the source. Each line is one take (one
// recorder prompt, one subtitle cue); the render concatenates them into the
// one clip the config references.
const INTROS = {
    first: ['Ask your friend which cartoon character you most resemble.', 'Have fun. Let us start.'],
    respond: ['Your friend is asking which cartoon character they resemble.', 'Let us have fun.'],
    ask: ['Now it is your turn to ask the same questions.', 'What cartoon characters do you resemble?'],
};
const withIntros = () => ({ ...SOURCE, intros: structuredClone(INTROS) });

describe('sourceToRows intro takes', () => {
    it('emits one take per line, grouped under the derived slug in canonical order', () => {
        const intro = sourceToRows(withIntros()).filter((r) => r.set_role === 'intro');
        expect(intro.map((r) => r.filename)).toEqual([
            'demo-intro-first-01', 'demo-intro-first-02',
            'demo-intro-respond-01', 'demo-intro-respond-02',
            'demo-intro-ask-01', 'demo-intro-ask-02',
        ]);
        expect(intro.map((r) => r.video_file)).toEqual([
            'demo-intro-first', 'demo-intro-first',
            'demo-intro-respond', 'demo-intro-respond',
            'demo-intro-ask', 'demo-intro-ask',
        ]);
        expect(intro.map((r) => r.phrase)).toEqual([
            ...INTROS.first, ...INTROS.respond, ...INTROS.ask,
        ]);
        expect(intro.map((r) => r.order)).toEqual(['1', '2', '1', '2', '1', '2']);
    });

    it('gives each take a lesson header but no pair coordinates and no burned overlay', () => {
        for (const row of sourceToRows(withIntros()).filter((r) => r.set_role === 'intro')) {
            expect(row.lesson_id).toBe('a');
            expect(row.lesson_title).toBe('Ask things');
            expect(row.response_type).toBe('viewAndContinue');
            expect(row.pair_index).toBe('');
            expect(row.topic_index).toBe('');
            expect(row.title_text).toBe('');
            expect(row.subtitle_text).toBe('');
            expect(row.footer_text).toBe('');
        }
    });

    it('emits no intro rows when the source declares none (opt-in)', () => {
        expect(sourceToRows(SOURCE).some((r) => r.set_role === 'intro')).toBe(false);
    });

    it('throws on a partial block', () => {
        expect(() => sourceToRows({ ...SOURCE, intros: { first: INTROS.first } }))
            .toThrow(/missing: respond, ask/);
    });

    it('throws on an unknown kind', () => {
        expect(() => sourceToRows({ ...SOURCE, intros: { ...INTROS, outro: ['bye'] } }))
            .toThrow(/unexpected: outro/);
    });

    it('throws when a kind is not a non-empty array of lines', () => {
        expect(() => sourceToRows({ ...SOURCE, intros: { ...INTROS, ask: 'one string' } }))
            .toThrow(/intros.ask.*non-empty array/);
        expect(() => sourceToRows({ ...SOURCE, intros: { ...INTROS, ask: [] } }))
            .toThrow(/intros.ask.*non-empty array/);
        expect(() => sourceToRows({ ...SOURCE, intros: { ...INTROS, ask: ['ok', '   '] } }))
            .toThrow(/intros.ask\[1\].*non-empty line/);
    });

    it('throws on too many lines or an over-long line (the recorder shows one line at a time)', () => {
        expect(() => sourceToRows({ ...SOURCE, intros: { ...INTROS, ask: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } }))
            .toThrow(/7 lines.*6 lines or fewer/);
        const long = Array.from({ length: 21 }, () => 'word').join(' ');
        expect(() => sourceToRows({ ...SOURCE, intros: { ...INTROS, ask: [long] } }))
            .toThrow(/is 21 words.*20 words or fewer/);
    });
});

describe('ABABAB intro placement', () => {
    const build = () => buildCourseConfig(sourceToRows(withIntros()));
    const introSlugs = (config) => new Set(JSON.stringify(config).match(/demo-intro-(?:first|respond|ask)/g) || []);

    it('puts the first-lesson clip on its first ask branch, and nothing else', () => {
        const a = build().lessons.find((l) => l.lessonId === 'a');
        const branches = a.steps.filter((s) => s.responseType === 'branching');
        expect(branches[0].simpleVideoUrl).toBe('demo-intro-first');
        expect(branches.slice(1).every((s) => s.simpleVideoUrl === undefined)).toBe(true);
        expect(a.steps.some((s) => s.responseType === 'viewAndContinue')).toBe(false);
        expect(JSON.stringify(a.steps)).not.toContain('demo-intro-ask');
    });

    it('opens every answer lesson with the respond clip, before the friend-clip branch', () => {
        const config = build();
        for (const lessonId of ['b', 'c']) {
            const lesson = config.lessons.find((l) => l.lessonId === lessonId);
            expect(lesson.steps[0].responseType).toBe('lessonIntro');
            expect(lesson.steps[1]).toEqual({
                responseType: 'viewAndContinue',
                simpleVideoUrl: 'demo-intro-respond',
            });
            expect(lesson.steps[2].responseType).toBe('branching');
            expect(lesson.steps[2].simpleVideoUrl).toBe('{friendCode}{selfCode}-demo-a-01');
        }
    });

    it('puts the "your turn" clip on the first record branch of a later lesson only', () => {
        const b = build().lessons.find((l) => l.lessonId === 'b');
        const introBranches = b.steps
            .filter((s) => s.responseType === 'branching' && String(s.simpleVideoUrl || '').includes('-intro-'));
        expect(introBranches).toHaveLength(1);
        expect(introBranches[0].simpleVideoUrl).toBe('demo-intro-ask');
    });

    it('gives the closing lesson the respond clip but never the "your turn" clip', () => {
        const closing = build().lessons.find((l) => l.lessonId === 'c');
        expect(closing.steps[1]).toEqual({
            responseType: 'viewAndContinue',
            simpleVideoUrl: 'demo-intro-respond',
        });
        expect(JSON.stringify(closing.steps)).not.toContain('demo-intro-ask');
    });

    it('emits exactly three distinct intro slugs across the whole config', () => {
        expect([...introSlugs(build())].sort())
            .toEqual(['demo-intro-ask', 'demo-intro-first', 'demo-intro-respond']);
    });

    it('carries the pipeline SRT onto every intro step, one cue per line', () => {
        // The render writes one SRT per step (JSON-escaped in the CSV) and the
        // translator fills srt_<lang>; the config gets timed subtitles.
        const srt = '1\\n00:00:00,000 --> 00:00:02,000\\nLine one\\n\\n2\\n00:00:02,000 --> 00:00:04,000\\nLine two';
        const rows = sourceToRows(withIntros()).map((row) => (
            row.set_role === 'intro' ? { ...row, srt } : row
        ));
        const config = buildCourseConfig(rows);
        const introSteps = config.lessons.flatMap((l) => l.steps).filter(
            (s) => String(s.simpleVideoUrl || '').includes('-intro-')
        );
        expect(introSteps.length).toBeGreaterThan(0);
        for (const step of introSteps) {
            expect(step.subtitles.en).toContain('-->');
            expect(step.subtitles.en.split('\n\n')).toHaveLength(2);
            expect(step.subtitles.en).toContain('Line one');
            expect(step.subtitles.en).toContain('Line two');
        }
    });

    it('emits no intro steps at all when the course declares none', () => {
        const config = buildCourseConfig(sourceToRows(SOURCE));
        expect(JSON.stringify(config)).not.toContain('-intro-');
        for (const lesson of config.lessons) {
            expect(lesson.steps.some((s) => s.responseType === 'viewAndContinue')).toBe(false);
        }
    });

    it('throws when a hand-edited sheet is missing one kind of intro take', () => {
        const rows = sourceToRows(withIntros()).filter((row) => row.video_file !== 'demo-intro-ask');
        expect(() => buildCourseConfig(rows)).toThrow(/intro clip\(s\) missing for ask/);
    });
});
