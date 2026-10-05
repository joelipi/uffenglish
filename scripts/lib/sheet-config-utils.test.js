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
    isValidCourseId,
    RESPONSE_TYPES,
    RECAP_SOURCES,
    RECAP_OVERLAYS,
} from './sheet-config-utils.js';

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
