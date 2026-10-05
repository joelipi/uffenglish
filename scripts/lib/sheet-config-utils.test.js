// Unit tests for the sheet -> config transform (story 042, Tasks 1-3).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    parseCsv,
    isVideoRow,
    unescapeSrt,
    buildSteps,
    buildCourseConfig,
    buildCourseConfigs,
    findMissingColumns,
    isValidCourseId,
    isMasterFormat,
    RESPONSE_TYPES,
    RECAP_SOURCES,
    RECAP_OVERLAYS,
} from './sheet-config-utils.js';
import {
    SHEET_LANGUAGES,
    TRANSLATABLE_FIELDS,
    localizedColumn,
} from './sheet-translate-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('parseCsv', () => {
    it('keeps quoted comma-containing fields and decodes "" escapes', () => {
        const { rows } = parseCsv('a,b\n"x, y","he said ""hi"""\n');
        expect(rows[0].a).toBe('x, y');
        expect(rows[0].b).toBe('he said "hi"');
    });

    it('tolerates CRLF, a trailing newline, and blank lines', () => {
        const { rows } = parseCsv('a,b\r\n1,2\r\n\r\n3,4\r\n');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({ a: '1', b: '2' });
        expect(rows[1]).toEqual({ a: '3', b: '4' });
    });

    it('lower-cases and trims header keys', () => {
        const { headers, rows } = parseCsv('  Video_File ,Order\nfoo,1\n');
        expect(headers).toEqual(['video_file', 'order']);
        expect(rows[0]).toEqual({ video_file: 'foo', order: '1' });
    });

    it('resolves a missing trailing field to "" without throwing', () => {
        const { rows } = parseCsv('a,b,c\n1,2\n');
        expect(rows[0]).toEqual({ a: '1', b: '2', c: '' });
    });

    it('handles a quoted field containing a newline', () => {
        const { rows } = parseCsv('a,b\n"line1\nline2",z\n');
        expect(rows[0].a).toBe('line1\nline2');
    });
});

describe('isVideoRow', () => {
    it('skips a row whose video-related columns are all blank', () => {
        expect(isVideoRow({ filename: '', video_file: '', subtitle_text: '', srt: '', phrase: 'x' })).toBe(false);
    });
    it('keeps a row with a video_file', () => {
        expect(isVideoRow({ video_file: 'testvideointro' })).toBe(true);
    });
});

describe('unescapeSrt', () => {
    it('turns the JSON-escaped form back into literal newlines', () => {
        expect(unescapeSrt('1\\n00:00:00,000 --> 00:00:01,000\\nHi')).toBe('1\n00:00:00,000 --> 00:00:01,000\nHi');
    });
    it('preserves a literal backslash that is not a JSON escape', () => {
        expect(unescapeSrt('a\\b')).toBe('a\\b');
    });
});

describe('buildSteps', () => {
    it('collapses multiple rows sharing a video_file into one step', () => {
        const steps = buildSteps([
            { video_file: 'v', filename: 'v01', order: '1', response_type: 'viewAndContinue', subtitle_text: 'a' },
            { video_file: 'v', filename: 'v02', order: '1', response_type: 'viewAndContinue', subtitle_text: 'b' },
        ]);
        expect(steps).toHaveLength(1);
    });

    it('groups by value, not row position', () => {
        const steps = buildSteps([
            { video_file: 'a', filename: 'a1', order: '1', response_type: 'viewAndContinue' },
            { video_file: 'b', filename: 'b1', order: '2', response_type: 'viewAndContinue' },
            { video_file: 'a', filename: 'a2', order: '1', response_type: 'viewAndContinue' },
        ]);
        expect(steps.map((s) => s.simpleVideoUrl)).toEqual(['a', 'b']);
    });

    it('emits cue as a single {en} object from the cue column', () => {
        const [step] = buildSteps([
            { video_file: 'q', filename: 'q1', order: '1', response_type: 'friendClosedResponse', cue: 'Q1' },
        ]);
        expect(step.cue).toEqual({ en: 'Q1' });
    });

    it('emits cue as an array from newline-separated cue_alt', () => {
        const [step] = buildSteps([
            { video_file: 'q', filename: 'q1', order: '1', response_type: 'friendClosedResponse', cue_alt: 'l1\nl2' },
        ]);
        expect(step.cue).toEqual([{ en: 'l1' }, { en: 'l2' }]);
    });

    it('throws when both cue and cue_alt are set', () => {
        expect(() => buildSteps([
            { video_file: 'q', filename: 'q1', order: '1', response_type: 'closedResponse', cue: 'x', cue_alt: 'y' },
        ])).toThrow(/q/);
    });

    it('throws on an unknown response_type', () => {
        expect(() => buildSteps([
            { video_file: 'q', filename: 'q1', order: '1', response_type: 'bogus' },
        ])).toThrow(/bogus/);
    });

    it('prefers srt (literal newlines) over subtitle_text', () => {
        const [step] = buildSteps([
            { video_file: 'v', filename: 'v1', order: '1', response_type: 'viewAndContinue', srt: '1\\n00:00 --> 00:01\\nHi', subtitle_text: 'plain' },
        ]);
        expect(step.subtitles.en).toContain('-->');
        expect(step.subtitles.en).toContain('\n');
    });

    it('falls back to subtitle_text verbatim', () => {
        const [step] = buildSteps([
            { video_file: 'v', filename: 'v1', order: '1', response_type: 'viewAndContinue', subtitle_text: 'plain text' },
        ]);
        expect(step.subtitles).toEqual({ en: 'plain text' });
    });

    it('omits subtitles when both srt and subtitle_text are blank', () => {
        const [step] = buildSteps([
            { video_file: 'v', filename: 'v1', order: '1', response_type: 'viewAndContinue' },
        ]);
        expect('subtitles' in step).toBe(false);
    });

    it('throws on a missing/non-numeric Order, naming the row', () => {
        expect(() => buildSteps([
            { video_file: 'v', filename: 'v1', order: 'x', response_type: 'viewAndContinue' },
        ])).toThrow(/v1/);
    });

    it('throws on a group with conflicting cue values', () => {
        expect(() => buildSteps([
            { video_file: 'q', filename: 'q1', order: '1', response_type: 'closedResponse', cue: 'A' },
            { video_file: 'q', filename: 'q2', order: '1', response_type: 'closedResponse', cue: 'B' },
        ])).toThrow(/conflicting cue/);
    });
});

describe('buildCourseConfig', () => {
    const base = {
        course_id: 'newcourse', course_name: 'New Course', lesson_id: 'a', lesson_title: 'Lesson A',
    };

    it('orders steps by numeric Order, ties by first-seen', () => {
        const config = buildCourseConfig([
            { ...base, video_file: 'third', filename: 'c', order: '3', response_type: 'viewAndContinue' },
            { ...base, video_file: 'first', filename: 'a', order: '1', response_type: 'viewAndContinue' },
            { ...base, video_file: 'second', filename: 'b', order: '2', response_type: 'viewAndContinue' },
        ]);
        expect(config.lessons[0].steps.map((s) => s.simpleVideoUrl)).toEqual(['first', 'second', 'third']);
    });

    it('builds a lessonIntro step with cue "" and introBackgroundVideoUrl', () => {
        const config = buildCourseConfig([
            { ...base, video_file: 'intro', filename: 'i1', order: '1', response_type: 'lessonIntro' },
        ]);
        expect(config.lessons[0].steps[0]).toEqual({
            cue: '', responseType: 'lessonIntro', introBackgroundVideoUrl: 'intro',
        });
    });

    it('omits mission when blank, adds it as {en} when present', () => {
        const without = buildCourseConfig([
            { ...base, video_file: 'v', filename: 'v1', order: '1', response_type: 'viewAndContinue' },
        ]);
        expect('mission' in without.lessons[0]).toBe(false);
        const withMission = buildCourseConfig([
            { ...base, mission: 'Talk about X', video_file: 'v', filename: 'v1', order: '1', response_type: 'viewAndContinue' },
        ]);
        expect(withMission.lessons[0].mission).toEqual({ en: 'Talk about X' });
    });

    it('defaults recapSources/recapOverlay when blank', () => {
        const config = buildCourseConfig([
            { ...base, video_file: 'v', filename: 'v1', order: '1', response_type: 'viewAndContinue' },
        ]);
        expect(config.lessons[0].recapSources).toBe('none');
        expect(config.lessons[0].recapOverlay).toBe('shareCta');
    });

    it('throws on an invalid recap_sources value, naming the lesson', () => {
        expect(() => buildCourseConfig([
            { ...base, recap_sources: 'bogus', video_file: 'v', filename: 'v1', order: '1', response_type: 'viewAndContinue' },
        ])).toThrow(/lesson "a"/);
    });

    it('splits rows into two lessons', () => {
        const config = buildCourseConfig([
            { ...base, video_file: 'v', filename: 'v1', order: '1', response_type: 'viewAndContinue' },
            { ...base, lesson_id: 'b', lesson_title: 'Lesson B', video_file: 'w', filename: 'w1', order: '1', response_type: 'viewAndContinue' },
        ]);
        expect(config.lessons.map((l) => l.lessonId)).toEqual(['a', 'b']);
        expect(config.lessons[1].steps).toHaveLength(1);
    });

    it('throws when course-level values disagree across rows', () => {
        expect(() => buildCourseConfig([
            { ...base, video_file: 'v', filename: 'v1', order: '1', response_type: 'viewAndContinue' },
            { ...base, course_name: 'OTHER', video_file: 'w', filename: 'w1', order: '2', response_type: 'viewAndContinue' },
        ])).toThrow(/course_name/);
    });

    it('throws on conflicting lesson_title values within a lesson', () => {
        expect(() => buildCourseConfig([
            { ...base, video_file: 'v', filename: 'v1', order: '1', response_type: 'viewAndContinue' },
            { ...base, lesson_title: 'OTHER', video_file: 'w', filename: 'w1', order: '2', response_type: 'viewAndContinue' },
        ])).toThrow(/lesson "a"/);
    });

    it('emits only the en key in every translation object', () => {
        const config = buildCourseConfig([
            { ...base, mission: 'M', video_file: 'v', filename: 'v1', order: '1', response_type: 'friendClosedResponse', cue: 'Q', subtitle_text: 'S' },
        ]);
        const lesson = config.lessons[0];
        expect(Object.keys(lesson.title)).toEqual(['en']);
        expect(Object.keys(lesson.mission)).toEqual(['en']);
        const step = lesson.steps[0];
        expect(Object.keys(step.cue)).toEqual(['en']);
        expect(Object.keys(step.subtitles)).toEqual(['en']);
    });

    it('exposes the canonical vocabularies', () => {
        expect(RESPONSE_TYPES).toContain('friendClosedResponse');
        expect(RECAP_SOURCES).toEqual(['system', 'friend', 'none']);
        expect(RECAP_OVERLAYS).toEqual(['fluency', 'shareCta', 'none']);
    });

    it('breaks Order ties by first-seen row order', () => {
        const config = buildCourseConfig([
            { ...base, video_file: 'first', filename: 'a', order: '1', response_type: 'viewAndContinue' },
            { ...base, video_file: 'second', filename: 'b', order: '1', response_type: 'viewAndContinue' },
        ]);
        expect(config.lessons[0].steps.map((s) => s.simpleVideoUrl)).toEqual(['first', 'second']);
    });

    it('matches a fully-formed fixture end to end', () => {
        const csv = [
            'course_id,course_name,lesson_id,lesson_title,recap_sources,recap_overlay,response_type,video_file,filename,order,cue,cue_alt,subtitle_text,srt',
            'demo,Demo Course,a,Lesson A,none,shareCta,lessonIntro,demo-intro,demo-intro01,1,,,,',
            'demo,Demo Course,a,Lesson A,none,shareCta,viewAndContinue,demo-v1,demo-v101,2,,,,Welcome.',
            'demo,Demo Course,a,Lesson A,none,shareCta,friendClosedResponse,demo-q,demo-q01,3,"Would you rather X?",,,',
            'demo,Demo Course,b,Lesson B,friend,shareCta,viewAndContinue,ab-model-w-response-01,ab1,1,,,,Hello.',
        ].join('\n');
        const { rows } = parseCsv(csv);
        const config = buildCourseConfig(rows);
        expect(config).toEqual({
            courseId: 'demo',
            courseName: 'Demo Course',
            lessons: [
                {
                    lessonId: 'a', recapSources: 'none', recapOverlay: 'shareCta',
                    title: { en: 'Lesson A' },
                    steps: [
                        { cue: '', responseType: 'lessonIntro', introBackgroundVideoUrl: 'demo-intro' },
                        { responseType: 'viewAndContinue', simpleVideoUrl: 'demo-v1', subtitles: { en: 'Welcome.' } },
                        { cue: { en: 'Would you rather X?' }, responseType: 'friendClosedResponse', simpleVideoUrl: 'demo-q' },
                    ],
                },
                {
                    lessonId: 'b', recapSources: 'friend', recapOverlay: 'shareCta',
                    title: { en: 'Lesson B' },
                    steps: [
                        { responseType: 'viewAndContinue', simpleVideoUrl: 'ab-model-w-response-01', subtitles: { en: 'Hello.' } },
                    ],
                },
            ],
        });
    });
});

// Story 049, Task 4: the language columns are consumed into the existing
// `{en,es,pt,bn}` objects, additively (back-compat: no columns -> `{en}`).
describe('buildCourseConfig localization columns', () => {
    const base = {
        course_id: 'c', course_name: 'C', lesson_id: 'a', lesson_title: 'Lesson A',
    };

    it('builds lesson.title from lesson_title + language columns (blank key omitted)', () => {
        const config = buildCourseConfig([
            {
                ...base, lesson_title_es: 'Lección A', lesson_title_pt: 'Lição A', lesson_title_bn: '',
                video_file: 'v', filename: 'v1', order: '1', response_type: 'viewAndContinue',
            },
        ]);
        expect(config.lessons[0].title).toEqual({ en: 'Lesson A', es: 'Lección A', pt: 'Lição A' });
    });

    it('uses the first non-blank language value across the lesson rows (no conflict throw)', () => {
        const config = buildCourseConfig([
            { ...base, lesson_title_es: '', video_file: 'v', filename: 'v1', order: '1', response_type: 'viewAndContinue' },
            { ...base, lesson_title_es: 'Lección', video_file: 'w', filename: 'w1', order: '2', response_type: 'viewAndContinue' },
        ]);
        expect(config.lessons[0].title.es).toBe('Lección');
    });

    it('adds mission languages', () => {
        const config = buildCourseConfig([
            { ...base, mission: 'Talk', mission_pt: 'Falar', video_file: 'v', filename: 'v1', order: '1', response_type: 'viewAndContinue' },
        ]);
        expect(config.lessons[0].mission).toEqual({ en: 'Talk', pt: 'Falar' });
    });

    it('builds a single cue as {en,es,bn}', () => {
        const [step] = buildSteps([
            { video_file: 'q', filename: 'q1', order: '1', response_type: 'friendClosedResponse', cue: 'Q?', cue_es: '¿Q?', cue_bn: 'প্র?' },
        ]);
        expect(step.cue).toEqual({ en: 'Q?', es: '¿Q?', bn: 'প্র?' });
    });

    it('pairs cue_alt_<lang> lines by index and omits unpaired languages', () => {
        const [step] = buildSteps([
            {
                video_file: 'q', filename: 'q1', order: '1', response_type: 'friendClosedResponse',
                cue_alt: 'A\nB', cue_alt_es: 'A-es\nB-es', cue_alt_bn: 'A-bn',
            },
        ]);
        expect(step.cue).toEqual([
            { en: 'A', es: 'A-es', bn: 'A-bn' },
            { en: 'B', es: 'B-es' },
        ]);
    });

    it('builds subtitle_text as {en,es}', () => {
        const [step] = buildSteps([
            { video_file: 'v', filename: 'v1', order: '1', response_type: 'viewAndContinue', subtitle_text: 'Hi.', subtitle_text_es: 'Hola.' },
        ]);
        expect(step.subtitles).toEqual({ en: 'Hi.', es: 'Hola.' });
    });

    it('keeps the srt branch {en} even when subtitle_text_es is present', () => {
        const [step] = buildSteps([
            { video_file: 'v', filename: 'v1', order: '1', response_type: 'viewAndContinue', srt: '1\\n00:00 --> 00:01\\nHi', subtitle_text: 'Hi.', subtitle_text_es: 'Hola.' },
        ]);
        expect(Object.keys(step.subtitles)).toEqual(['en']);
    });

    it('ignores a stray cue_alt_es on a single-cue step', () => {
        const [step] = buildSteps([
            { video_file: 'q', filename: 'q1', order: '1', response_type: 'friendClosedResponse', cue: 'Q', cue_es: 'Q-es', cue_alt_es: 'stray' },
        ]);
        expect(step.cue).toEqual({ en: 'Q', es: 'Q-es' });
    });

    it('ignores a stray cue_es on a cue_alt step', () => {
        const [step] = buildSteps([
            { video_file: 'q', filename: 'q1', order: '1', response_type: 'friendClosedResponse', cue_alt: 'A\nB', cue_alt_es: 'A-es\nB-es', cue_es: 'stray' },
        ]);
        expect(step.cue).toEqual([{ en: 'A', es: 'A-es' }, { en: 'B', es: 'B-es' }]);
    });

    it('pairs cue_alt translations per row so a mid-group blank cell does not shift a later row', () => {
        const [step] = buildSteps([
            { video_file: 'q', filename: 'q1', order: '1', response_type: 'friendClosedResponse', cue_alt: 'A', cue_alt_es: '' },
            { video_file: 'q', filename: 'q2', order: '1', response_type: 'friendClosedResponse', cue_alt: 'B', cue_alt_es: 'B-es' },
        ]);
        expect(step.cue).toEqual([{ en: 'A' }, { en: 'B', es: 'B-es' }]);
    });

    it('never reports the optional language columns missing', () => {
        expect(findMissingColumns([
            { ...COURSE, video_file: 'v', filename: 'f1', order: '1', response_type: 'viewAndContinue' },
        ])).toEqual([]);
    });
});

// Story 049: the generator's English source reads are derived from
// TRANSLATABLE_FIELDS (sourceOf), so this pins that every shared field is
// consumed and none is silently dropped.
describe('shared translatable-field parity', () => {
    it('consumes every field in TRANSLATABLE_FIELDS', () => {
        const es = (field) => localizedColumn(field, 'es');
        const rows = [
            {
                course_id: 'c', course_name: 'C', lesson_id: 'a', lesson_title: 'L', mission: 'M',
                video_file: 'v1', filename: 'f1', order: '1', response_type: 'closedResponse',
                cue: 'Q', subtitle_text: 'S',
                [es('lesson_title')]: 'L-es', [es('mission')]: 'M-es',
                [es('cue')]: 'Q-es', [es('subtitle_text')]: 'S-es',
            },
            {
                course_id: 'c', course_name: 'C', lesson_id: 'a', lesson_title: 'L', mission: 'M',
                video_file: 'v2', filename: 'f2', order: '2', response_type: 'closedResponse',
                cue_alt: 'A\nB', [es('cue_alt')]: 'A-es\nB-es',
            },
        ];
        const lesson = buildCourseConfig(rows).lessons[0];
        expect(lesson.title.es).toBe('L-es');
        expect(lesson.mission.es).toBe('M-es');
        expect(lesson.steps[0].cue.es).toBe('Q-es');
        expect(lesson.steps[0].subtitles.es).toBe('S-es');
        expect(lesson.steps[1].cue[0].es).toBe('A-es');
        // The generator's consumed field set is exactly the shared set.
        expect(TRANSLATABLE_FIELDS.map((f) => f.field).sort()).toEqual([
            'cue', 'cue_alt', 'lesson_title', 'mission', 'phrase', 'subtitle_text',
        ]);
        // `phrase` is consumed by the master path (one cue element per row).
        const master = buildCourseConfig([{
            course_id: 'c', course_name: 'C', lesson_id: 'a', lesson_title: 'L',
            response_type: 'friendClosedResponse', video_file: 'v', filename: 'f',
            order: '1', phrase: 'Q', phrase_es: 'Q-es',
        }]);
        expect(master.lessons[0].steps[0].cue).toEqual([{ en: 'Q', es: 'Q-es' }]);
    });
});

// The browser modules import runtime deps and cannot be imported here, so the
// canonical literals are pinned by parsing their source text.
describe('isValidCourseId', () => {
    it('accepts safe config-stem ids', () => {
        expect(isValidCourseId('demo')).toBe(true);
        expect(isValidCourseId('would-rather_2')).toBe(true);
    });
    it('rejects traversal, separators, leading dots, and non-strings', () => {
        for (const bad of ['../x', 'a/b', '.hidden', '', 'a.json', null, 42]) {
            expect(isValidCourseId(bad), String(bad)).toBe(false);
        }
    });
});

describe('canonical vocabulary parity with the browser modules', () => {
    const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

    it('RECAP_SOURCES / RECAP_OVERLAYS match video-processor-logic.js', () => {
        const src = read('../../src/modules/video/video-processor-logic.js');
        const arr = (name) => {
            const m = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(src);
            if (!m) throw new Error(`${name} not found`);
            return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
        };
        expect(RECAP_SOURCES).toEqual(arr('RECAP_SOURCES'));
        expect(RECAP_OVERLAYS).toEqual(arr('RECAP_OVERLAYS'));
    });

    it('FRIEND_VIDEO_REGEX matches video-source.js', () => {
        const src = read('../../src/modules/video/video-source.js');
        const m = /export const FRIEND_VIDEO_REGEX = \/(.+)\/i;/.exec(src);
        expect(m).not.toBeNull();
        const re = new RegExp(m[1], 'i');
        expect(re.test('ab-model-w-response-01')).toBe(true);
        expect(re.test('testvideoa01')).toBe(false);
    });
});

const COURSE = { course_id: 'c', course_name: 'C', lesson_id: 'a', lesson_title: 'L' };

describe('findMissingColumns', () => {
    it('reports course_name missing on every row as a course-wide miss', () => {
        const rows = [
            { ...COURSE, course_name: '', video_file: 'v', filename: 'f1', order: '1', response_type: 'viewAndContinue' },
        ];
        expect(findMissingColumns(rows)).toEqual([{ column: 'course_name', where: 'course' }]);
    });

    it('reports lesson_id missing on the offending row', () => {
        const rows = [
            { ...COURSE, lesson_id: '', video_file: 'v', filename: 'f9', order: '1', response_type: 'viewAndContinue' },
        ];
        expect(findMissingColumns(rows)).toContainEqual({ column: 'lesson_id', where: 'row "f9"' });
    });

    it('reports lesson_title missing per lesson', () => {
        const rows = [{ ...COURSE, lesson_title: '', video_file: 'v', filename: 'f1', order: '1', response_type: 'viewAndContinue' }];
        expect(findMissingColumns(rows)).toContainEqual({ column: 'lesson_title', where: 'lesson "a"' });
    });

    it('reports response_type missing per video_file group', () => {
        const rows = [{ ...COURSE, video_file: 'v', filename: 'f1', order: '1', response_type: '' }];
        expect(findMissingColumns(rows)).toContainEqual({ column: 'response_type', where: 'video_file "v"' });
    });

    it('reports a blank/non-numeric order', () => {
        const rows = [{ ...COURSE, video_file: 'v', filename: 'f1', order: 'x', response_type: 'viewAndContinue' }];
        expect(findMissingColumns(rows)).toContainEqual({ column: 'order', where: 'video_file "v" row "f1"' });
    });

    it('reports a row with no video_file', () => {
        const rows = [{ ...COURSE, video_file: '', filename: 'f1', order: '1', response_type: 'viewAndContinue' }];
        expect(findMissingColumns(rows)).toContainEqual({ column: 'video_file', where: 'row "f1"' });
    });

    it('ignores blank optional columns', () => {
        const rows = [{ ...COURSE, video_file: 'v', filename: 'f1', order: '1', response_type: 'viewAndContinue', recap_sources: '', mission: '', cue: '' }];
        expect(findMissingColumns(rows)).toEqual([]);
    });

    it('returns [] for a fully-populated valid course and for []', () => {
        expect(findMissingColumns([{ ...COURSE, video_file: 'v', filename: 'f1', order: '1', response_type: 'viewAndContinue' }])).toEqual([]);
        expect(findMissingColumns([])).toEqual([]);
    });

    it('is deterministic regardless of row order', () => {
        const a = { ...COURSE, course_id: 'c', video_file: 'v', filename: 'a', order: '1', response_type: '' };
        const b = { ...COURSE, course_id: 'c', lesson_id: '', video_file: 'w', filename: 'b', order: '1', response_type: 'viewAndContinue' };
        const forward = findMissingColumns([a, b]);
        const reverse = findMissingColumns([b, a]);
        expect(forward).toEqual(reverse);
        expect(forward).toEqual([...forward].sort((x, y) => x.where.localeCompare(y.where) || 0));
    });

    it('does not throw on conflicting values (never aborts the run)', () => {
        // Two rows in one course disagree on course_name -> the detector must not
        // throw (it reports existence, not agreement); the builder reports the
        // conflict per-course.
        const rows = [
            { ...COURSE, course_name: 'A', video_file: 'v', filename: 'f1', order: '1', response_type: 'viewAndContinue' },
            { ...COURSE, course_name: 'B', video_file: 'w', filename: 'f2', order: '1', response_type: 'viewAndContinue' },
        ];
        expect(() => findMissingColumns(rows)).not.toThrow();
        expect(findMissingColumns(rows)).toEqual([]);
    });

    it('groups video_file within a lesson, not across the course', () => {
        // Same video_file in two lessons with different response_type: valid for
        // buildSteps (independent steps), so the detector must NOT merge them.
        const rows = [
            { ...COURSE, lesson_id: 'a', video_file: 'dup', filename: 'a1', order: '1', response_type: 'viewAndContinue' },
            { ...COURSE, lesson_id: 'b', video_file: 'dup', filename: 'b1', order: '1', response_type: 'friendClosedResponse' },
        ];
        expect(findMissingColumns(rows)).toEqual([]);
    });
});

describe('buildCourseConfigs', () => {
    const twoCourseCsv = [
        'course_id,course_name,lesson_id,lesson_title,response_type,video_file,filename,order,recap_sources',
        'alpha,Alpha,a,Lesson A,viewAndContinue,alpha-v1,alpha1,1,none',
        'beta,Beta,b,Lesson B,viewAndContinue,beta-v1,beta1,1,friend',
    ].join('\n');

    it('returns one entry per course in first-seen order', () => {
        const { rows } = parseCsv(twoCourseCsv);
        const results = buildCourseConfigs(rows);
        expect(results.map((r) => r.courseId)).toEqual(['alpha', 'beta']);
        for (const r of results) expect(r.config.courseId).toBe(r.courseId);
    });

    it('does not cross-contaminate lessons between courses', () => {
        const { rows } = parseCsv(twoCourseCsv);
        const [alpha, beta] = buildCourseConfigs(rows);
        expect(alpha.config.lessons.map((l) => l.lessonId)).toEqual(['a']);
        expect(beta.config.lessons.map((l) => l.lessonId)).toEqual(['b']);
    });

    it('skips a course with a missing required column but keeps the valid one', () => {
        const csv = [
            'course_id,course_name,lesson_id,lesson_title,response_type,video_file,filename,order',
            'alpha,Alpha,a,,viewAndContinue,alpha-v1,alpha1,1',
            'beta,Beta,b,Lesson B,viewAndContinue,beta-v1,beta1,1',
        ].join('\n');
        const results = buildCourseConfigs(parseCsv(csv).rows);
        const alpha = results.find((r) => r.courseId === 'alpha');
        const beta = results.find((r) => r.courseId === 'beta');
        expect(alpha.error.kind).toBe('missing-columns');
        expect(alpha.error.missing).toContainEqual({ column: 'lesson_title', where: 'lesson "a"' });
        expect('config' in alpha).toBe(false);
        expect(beta.config).toBeDefined();
    });

    it('isolates a structural error to its own course', () => {
        const csv = [
            'course_id,course_name,lesson_id,lesson_title,response_type,video_file,filename,order',
            'bad,Bad,a,Lesson A,wat,bad-v1,bad1,1',
            'beta,Beta,b,Lesson B,viewAndContinue,beta-v1,beta1,1',
        ].join('\n');
        const results = buildCourseConfigs(parseCsv(csv).rows);
        const bad = results.find((r) => r.courseId === 'bad');
        const beta = results.find((r) => r.courseId === 'beta');
        expect(bad.error.kind).toBe('error');
        expect(bad.error.message).toContain('wat');
        expect(beta.config).toBeDefined();
    });

    it('isolates a conflicting field in one course and still builds the other', () => {
        // Course alpha has two disagreeing course_name values (a structural
        // error); course beta is complete. The detector must not throw, and the
        // conflict must not abort beta.
        const csv = [
            'course_id,course_name,lesson_id,lesson_title,response_type,video_file,filename,order',
            'alpha,Alpha,a,Lesson A,viewAndContinue,a1,f1,1',
            'alpha,ALPHA-RENAMED,a,Lesson A,viewAndContinue,a2,f2,2',
            'beta,Beta,b,Lesson B,viewAndContinue,b1,g1,1',
        ].join('\n');
        let results;
        expect(() => { results = buildCourseConfigs(parseCsv(csv).rows); }).not.toThrow();
        const alpha = results.find((r) => r.courseId === 'alpha');
        const beta = results.find((r) => r.courseId === 'beta');
        expect(alpha.error.kind).toBe('error');
        expect(beta.config).toBeDefined();
    });

    it('partitions blank course_id rows and reports course_id missing', () => {
        const csv = [
            'course_id,course_name,lesson_id,lesson_title,response_type,video_file,filename,order',
            ',Noname,a,Lesson A,viewAndContinue,v1,f1,1',
        ].join('\n');
        const [only] = buildCourseConfigs(parseCsv(csv).rows);
        expect(only.courseId).toBe('');
        expect(only.error.kind).toBe('missing-columns');
        expect(only.error.missing).toContainEqual({ column: 'course_id', where: 'course' });
    });

    it('matches the single-course primitive on one course', () => {
        const csv = [
            'course_id,course_name,lesson_id,lesson_title,response_type,video_file,filename,order',
            'solo,Solo,a,Lesson A,viewAndContinue,solo-v1,solo1,1',
        ].join('\n');
        const { rows } = parseCsv(csv);
        const [entry] = buildCourseConfigs(rows);
        expect(entry.config).toEqual(buildCourseConfig(rows));
    });

    it('returns [] when every row is a blank spacer row', () => {
        const { rows } = parseCsv('course_id,course_name\n,\n,\n');
        expect(buildCourseConfigs(rows)).toEqual([]);
    });
});

// Story 049: the sample sheet gains the 15 localization columns (blank cells)
// and must still round-trip through parseCsv + buildCourseConfig.
// Story 050, Task 1: the overlay master (a `phrase` header) is a second sheet
// shape. Steps group by `join` (else `video_file`), the cue is an ordered array
// built from per-row `phrase`, subtitles come from `srt` only, and the
// lessonIntro/success steps are synthesized from the config columns.
describe('master format (overlay master)', () => {
    const base = {
        course_id: 'wouldyourather', course_name: 'Friend Challenge',
        lesson_id: 'a', lesson_title: 'Ask', response_type: 'friendClosedResponse',
    };
    const steps = (rows) => buildCourseConfig(rows).lessons[0].steps;

    it('isMasterFormat detects a phrase header (case-insensitive)', () => {
        expect(isMasterFormat(['title_text', 'Order', 'phrase', 'video_file'])).toBe(true);
        expect(isMasterFormat(['Phrase'])).toBe(true);
        expect(isMasterFormat(['cue', 'cue_alt', 'video_file'])).toBe(false);
        expect(isMasterFormat([])).toBe(false);
    });

    it('builds the cue as an array of {en} in Order order', () => {
        const rows = [1, 2, 3, 4].map((n) => ({
            ...base, video_file: 'v', filename: `f${n}`, order: String(n), phrase: `Q${n}`,
        }));
        expect(steps(rows)[0].cue).toEqual([{ en: 'Q1' }, { en: 'Q2' }, { en: 'Q3' }, { en: 'Q4' }]);
    });

    it('the cue array length varies with the row count (1, 4, 8)', () => {
        const one = steps([{ ...base, video_file: 'v', filename: 'f', order: '1', phrase: 'Q' }]);
        expect(one[0].cue).toHaveLength(1);

        const four = Array.from({ length: 4 }, (_, i) => ({
            ...base, video_file: 'v', filename: `f${i}`, order: String(i + 1), phrase: `Q${i}`,
        }));
        expect(steps(four)[0].cue).toHaveLength(4);

        const joined = [];
        for (let i = 0; i < 4; i++) {
            joined.push({ ...base, video_file: 'vA', filename: `a${i}`, order: String(i + 1), phrase: `A${i}`, join: 'joined' });
            joined.push({ ...base, video_file: 'vB', filename: `b${i}`, order: String(i + 1), phrase: `B${i}`, join: 'joined' });
        }
        const [step] = steps(joined);
        expect(step.cue).toHaveLength(8);
        expect(step.simpleVideoUrl).toBe('joined');
    });

    it('localizes each cue element and omits a blank language key', () => {
        const rows = [
            { ...base, video_file: 'v', filename: 'f1', order: '1', phrase: 'Q1', phrase_es: 'Q1-es' },
            { ...base, video_file: 'v', filename: 'f2', order: '2', phrase: 'Q2', phrase_bn: 'Q2-bn' },
        ];
        expect(steps(rows)[0].cue).toEqual([
            { en: 'Q1', es: 'Q1-es' },
            { en: 'Q2', bn: 'Q2-bn' },
        ]);
    });

    it('groups by join when set: one step spanning both video_files in first-seen order', () => {
        const rows = [
            { ...base, video_file: 'wouldyourather_b01_i', filename: 'b1', order: '1', phrase: 'O1', join: 'wouldyourather_b01' },
            { ...base, video_file: 'wouldyourather_b01_ii', filename: 'b2', order: '1', phrase: 'O2', join: 'wouldyourather_b01' },
        ];
        const all = steps(rows);
        expect(all).toHaveLength(1);
        expect(all[0].simpleVideoUrl).toBe('wouldyourather_b01');
        expect(all[0].cue).toEqual([{ en: 'O1' }, { en: 'O2' }]);
    });

    it('builds subtitles from the JSON-escaped srt column', () => {
        const rows = [{ ...base, video_file: 'v', filename: 'f', order: '1', phrase: 'Q', srt: '1\\n00:00 --> 00:01\\nHi' }];
        expect(steps(rows)[0].subtitles).toEqual({ en: '1\n00:00 --> 00:01\nHi' });
    });

    it('never uses the overlay subtitle_text when there is no srt', () => {
        const rows = [{ ...base, video_file: 'v', filename: 'f', order: '1', phrase: 'Q', subtitle_text: '<aside>🅰1️⃣</aside>' }];
        expect('subtitles' in steps(rows)[0]).toBe(false);
    });

    it('prepends a synthesized lessonIntro from intro_video', () => {
        const rows = [
            { ...base, video_file: 'v', filename: 'f1', order: '1', phrase: 'Q' },
            { ...base, video_file: 'v', filename: 'f2', order: '2', phrase: 'Q2', intro_video: 'intro' },
        ];
        expect(steps(rows)[0]).toEqual({ cue: '', responseType: 'lessonIntro', introBackgroundVideoUrl: 'intro' });
    });

    it('appends a synthesized success step from success_video + success_srt', () => {
        const rows = [{
            ...base, video_file: 'v', filename: 'f', order: '1', phrase: 'Q',
            success_video: 'success', success_srt: 'the end', success_srt_es: 'el fin',
        }];
        const all = steps(rows);
        expect(all[all.length - 1]).toEqual({
            responseType: 'success', simpleVideoUrl: 'success', subtitles: { en: 'the end', es: 'el fin' },
        });
    });

    it('omits a synthesized step when its video column is blank', () => {
        const rows = [{ ...base, video_file: 'v', filename: 'f', order: '1', phrase: 'Q', intro_video: '', success_video: '' }];
        const all = steps(rows);
        expect(all).toHaveLength(1);
        expect(all.some((s) => s.responseType === 'lessonIntro' || s.responseType === 'success')).toBe(false);
    });

    it('findMissingColumns reports required config columns and never the optional new ones', () => {
        const rows = [{
            course_id: '', course_name: 'C', lesson_id: 'a', lesson_title: 'L',
            response_type: '', video_file: 'v', filename: 'f', order: '1', phrase: 'Q',
            intro_video: '', success_video: '', success_srt: '', recap_sources: '',
        }];
        expect(findMissingColumns(rows)).toContainEqual({ column: 'course_id', where: 'course' });
        expect(findMissingColumns(rows)).toContainEqual({ column: 'response_type', where: 'video_file "v"' });
        expect(findMissingColumns(rows)).not.toContainEqual(expect.objectContaining({ column: 'intro_video' }));
    });

    it('findMissingColumns validates a joined step as one group', () => {
        const rows = [
            { course_id: 'c', course_name: 'C', lesson_id: 'a', lesson_title: 'L', response_type: '', video_file: 'v1', filename: 'f1', order: '1', phrase: 'Q1', join: 'J' },
            { course_id: 'c', course_name: 'C', lesson_id: 'a', lesson_title: 'L', response_type: '', video_file: 'v2', filename: 'f2', order: '1', phrase: 'Q2', join: 'J' },
        ];
        expect(findMissingColumns(rows).filter((m) => m.column === 'response_type'))
            .toEqual([{ column: 'response_type', where: 'video_file "J"' }]);
    });

    it('findMissingColumns never throws on a master row with no step key', () => {
        const rows = [{
            course_id: 'c', course_name: 'C', lesson_id: 'a', lesson_title: 'L',
            response_type: 'friendClosedResponse', video_file: '', filename: 'f', order: '1', phrase: 'Q',
        }];
        expect(() => findMissingColumns(rows)).not.toThrow();
        expect(findMissingColumns(rows)).toContainEqual({ column: 'video_file', where: 'row "f"' });
    });

    it('an authoring header (no phrase) still takes the authoring path', () => {
        const authoring = [{
            course_id: 'c', course_name: 'C', lesson_id: 'a', lesson_title: 'L',
            response_type: 'friendClosedResponse', video_file: 'v', filename: 'f', order: '1', cue: 'Q?',
        }];
        expect(buildCourseConfig(authoring).lessons[0].steps[0].cue).toEqual({ en: 'Q?' });
    });
});

describe('docs/video-pipeline/sample-sheet.csv round-trip', () => {
    const samplePath = path.join(__dirname, '../../docs/video-pipeline/sample-sheet.csv');
    const csv = readFileSync(samplePath, 'utf8');

    it('headers include all 15 authoring localization columns (phrase is master-only)', () => {
        const { headers } = parseCsv(csv);
        const authoringFields = TRANSLATABLE_FIELDS.filter((f) => f.field !== 'phrase');
        const expected = authoringFields.flatMap((f) =>
            SHEET_LANGUAGES.map((l) => localizedColumn(f.field, l)));
        expect(expected).toHaveLength(15);
        for (const col of expected) expect(headers).toContain(col);
        expect(headers).not.toContain('phrase_es');
    });

    it('still parses and generates a valid English-only config', () => {
        const { rows } = parseCsv(csv);
        expect(rows.length).toBeGreaterThan(0);
        const config = buildCourseConfig(rows);
        expect(config.courseId).toBe('demo');
        expect(config.lessons.length).toBeGreaterThan(0);
        // All language cells are blank in the sample -> `{en}` (back-compat).
        expect(config.lessons[0].title).toEqual({ en: 'Lesson Intro' });
    });
});
