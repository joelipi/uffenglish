// scripts/seed-master-columns.test.js
// Story 050, Task 4: the seed script appends the config columns to the published
// overlay master and pre-fills the current course from friendchain.json. It
// writes nothing to the sheet (pure builder + CLI emitting CSV).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    CONFIG_COLUMNS,
    INTRO_VIDEOS,
    LOCALIZATION_COLUMNS,
    ROW_PURPOSE_COLUMN,
    buildSeededCsv,
    courseNameFromTitle,
    lessonIdFromVideoFile,
    rowPurposeFor,
    serializeCsv,
    successSubtitlesFromFriendchain,
} from './seed-master-columns.mjs';
import { parseCsv, buildCourseConfig } from './lib/sheet-config-utils.js';
import { planSheetTranslations, buildBatchUpdatePayload } from './lib/sheet-translate-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/seed-master-columns.mjs');
const FRIENDCHAIN = JSON.parse(readFileSync(path.join(ROOT, 'src/config/friendchain.json'), 'utf8'));

const MASTER_HEADER = 'title_text,Order,phrase,subtitle_text,filename,join,video_file';
function masterFixture() {
    const rows = [];
    const add = (videoFile, join = '') => {
        rows.push(`Friend<br>Challenge,${String(rows.length + 1).padStart(2, '0')},Phrase ${rows.length + 1},<aside>x</aside>,${videoFile}_take01,${join},${videoFile}`);
    };
    add('wouldyourather_a01');
    add('wouldyourather_b01_i', 'wouldyourather_b01');
    add('wouldyourather_b01_ii', 'wouldyourather_b01');
    add('wouldyourather_c01');
    add('wouldyourather_d01_i', 'wouldyourather_d01');
    add('wouldyourather_d01_ii', 'wouldyourather_d01');
    add('wouldyourather_e01');
    add('wouldyourather_f01_i', 'wouldyourather_f01');
    add('wouldyourather_f01_ii', 'wouldyourather_f01');
    return [MASTER_HEADER, ...rows].join('\n');
}

const ASK = new Set(['a', 'c', 'e']);

function tmpDir() {
    return mkdtempSync(path.join(os.tmpdir(), 'uff-seed-'));
}

let server;
let baseUrl;

beforeAll(async () => {
    server = http.createServer((req, res) => { res.writeHead(200); res.end(masterFixture()); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/master`;
});

afterAll(() => { server?.close(); });

describe('seed-master-columns helpers', () => {
    it('courseNameFromTitle replaces <br> with a space', () => {
        expect(courseNameFromTitle('Friend<br>Challenge')).toBe('Friend Challenge');
        expect(courseNameFromTitle('A<br/>B')).toBe('A B');
    });

    it('lessonIdFromVideoFile takes the prefix letter', () => {
        expect(lessonIdFromVideoFile('wouldyourather_a01')).toBe('a');
        expect(lessonIdFromVideoFile('wouldyourather_b01_i')).toBe('b');
    });

    it('successSubtitlesFromFriendchain returns the canonical {en,es,pt,bn}', () => {
        const success = successSubtitlesFromFriendchain(FRIENDCHAIN);
        expect(Object.keys(success).sort()).toEqual(['bn', 'en', 'es', 'pt']);
        expect(success.en).toContain('share');
        // Identical across the 8 success steps -> one canonical value.
        expect(success.es.length).toBeGreaterThan(0);
    });

    it('successSubtitlesFromFriendchain rejects divergent success subtitles', () => {
        const divergent = {
            lessons: [
                { steps: [{ responseType: 'success', subtitles: { en: 'A' } }] },
                { steps: [{ responseType: 'success', subtitles: { en: 'B' } }] },
            ],
        };
        expect(() => successSubtitlesFromFriendchain(divergent)).toThrow(/not identical/);
    });

    it('serializeCsv quotes fields containing commas, quotes, and newlines', () => {
        const csv = serializeCsv(['a', 'b'], [{ a: 'x,y', b: 'he said "hi"\nbye' }]);
        expect(parseCsv(csv).rows[0]).toEqual({ a: 'x,y', b: 'he said "hi"\nbye' });
    });
});

describe('rowPurposeFor', () => {
    it('describes a step-defining row', () => {
        const purpose = rowPurposeFor({ video_file: 'wouldyourather_a01', phrase: 'Q', srt: 'x' });
        expect(purpose).toContain('step "wouldyourather_a01"');
        expect(purpose).toContain('→ simpleVideoUrl');
        expect(purpose).toContain('→ cue');
        expect(purpose).toContain('→ subtitles');
    });

    it('describes the branching friend row without claiming subtitles', () => {
        const purpose = rowPurposeFor({
            video_file: '{friendCode}wouldyourather-a-response-01', srt: 'x',
            choose_step_next: '1', choose_step_text: 'Yes',
        });
        expect(purpose).toContain('→ chooseStep');
        expect(purpose).toContain('friend UGC clip — no app subtitles');
        expect(purpose).not.toContain('→ subtitles');
    });

    it('describes join / intro / success / next_step / publish_lesson_id rows', () => {
        expect(rowPurposeFor({ join: 'grp', video_file: 'grp_i' })).toContain('joined step "grp"');
        expect(rowPurposeFor({ video_file: 'v', intro_video: 'intro' })).toContain('lessonIntro "intro"');
        expect(rowPurposeFor({ video_file: 'v', success_video: 'success' })).toContain('success "success"');
        expect(rowPurposeFor({ video_file: 'v', next_step: '2' })).toContain('→ nextStep');
        expect(rowPurposeFor({ video_file: 'v', publish_lesson_id: 'a' })).toContain('→ publishLessonId');
    });

    it('describes a row with no step key', () => {
        expect(rowPurposeFor({ filename: 'f' })).toContain('no step key');
    });
});

describe('buildSeededCsv', () => {
    const seeded = buildSeededCsv(masterFixture(), { friendchain: FRIENDCHAIN });
    const { headers, rows } = parseCsv(seeded);
    const success = successSubtitlesFromFriendchain(FRIENDCHAIN);

    it('appends every config column and every localization target', () => {
        for (const col of CONFIG_COLUMNS) expect(headers).toContain(col);
        for (const col of LOCALIZATION_COLUMNS) expect(headers).toContain(col);
    });

    it('CONFIG_COLUMNS includes the branching columns; LOCALIZATION_COLUMNS the choose_step_text targets', () => {
        for (const col of ['next_step', 'choose_step_next', 'choose_step_text']) {
            expect(CONFIG_COLUMNS).toContain(col);
        }
        for (const col of ['choose_step_text_es', 'choose_step_text_pt', 'choose_step_text_bn']) {
            expect(LOCALIZATION_COLUMNS).toContain(col);
        }
        // Story 056: the SRT cue-text translation targets are seeded too, so the
        // translator can localize captions once the pipeline fills `srt`.
        for (const col of ['srt_es', 'srt_pt', 'srt_bn']) {
            expect(LOCALIZATION_COLUMNS).toContain(col);
        }
    });

    it('emits each new column exactly once in the seeded header', () => {
        for (const col of ['next_step', 'choose_step_next', 'choose_step_text',
            'choose_step_text_es', 'choose_step_text_pt', 'choose_step_text_bn',
            'srt_es', 'srt_pt', 'srt_bn']) {
            expect(headers.filter((h) => h === col)).toHaveLength(1);
        }
    });

    it('seeds enough for the translator to build a payload (no missing columns)', () => {
        // The seeded master must carry every planned target column, or the
        // translator's buildBatchUpdatePayload throws "column not found".
        const plan = planSheetTranslations({
            rows, headers, sheetRows: rows.map((_, i) => i + 2), languages: ['es', 'pt', 'bn'],
        });
        expect(plan.length).toBeGreaterThan(0);
        expect(plan.some((p) => p.column === 'lesson_title_es')).toBe(true);
        expect(plan.some((p) => p.column === 'phrase_es')).toBe(true);
        for (const item of plan) expect(headers).toContain(item.column);
        const payload = buildBatchUpdatePayload({
            plan, headers, sheetTitle: 'Sheet1', translations: plan.map(() => 'T'),
        });
        expect(payload.valueInputOption).toBe('RAW');
        expect(payload.data).toHaveLength(plan.length);
    });

    it('pre-fills response_type/recap_overlay/success/srt on every content row', () => {
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            expect(row.response_type).toBe('friendClosedResponse');
            expect(row.recap_overlay).toBe('shareCta');
            expect(row.success_video).toBe('success');
            expect(row.success_srt).toBe(success.en);
            expect(row.success_srt_es).toBe(success.es);
            expect(row.success_srt_pt).toBe(success.pt);
            expect(row.success_srt_bn).toBe(success.bn);
            expect(row.srt).toBe('');
        }
    });

    it('sets recap_sources none for a/c/e and friend for b/d/f', () => {
        for (const row of rows) {
            expect(row.recap_sources).toBe(ASK.has(row.lesson_id) ? 'none' : 'friend');
        }
    });

    it('carries each lesson its intro_video', () => {
        for (const row of rows) {
            expect(row.intro_video).toBe(INTRO_VIDEOS[row.lesson_id]);
        }
        const lessonA = rows.find((r) => r.lesson_id === 'a');
        expect(lessonA.intro_video).toBe('intro');
        const lessonB = rows.find((r) => r.lesson_id === 'b');
        expect(lessonB.intro_video).toBe('{friendCode}wouldyourather-a-response-01');
    });

    it('sets course_id/course_name/lesson_id/lesson_title', () => {
        for (const row of rows) {
            expect(row.course_id).toBe('wouldyourather');
            expect(row.course_name).toBe('Friend Challenge');
            expect(row.lesson_id).toMatch(/^[a-f]$/);
            expect(row.lesson_title.trim().length).toBeGreaterThan(0);
        }
    });

    it('round-trips through parseCsv + buildCourseConfig with no further edits', () => {
        const config = buildCourseConfig(rows);
        expect(config.courseId).toBe('wouldyourather');
        expect(config.courseName).toBe('Friend Challenge');
        expect(config.lessons.map((l) => l.lessonId)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
        for (const lesson of config.lessons) {
            expect(lesson.steps[0].responseType).toBe('lessonIntro');
            expect(lesson.steps[lesson.steps.length - 1].responseType).toBe('success');
            expect(lesson.steps[lesson.steps.length - 1].subtitles.en).toBe(success.en);
        }
        // The joined lesson b is one step spanning both option videos.
        const b = config.lessons.find((l) => l.lessonId === 'b');
        const content = b.steps.filter((s) => s.responseType === 'friendClosedResponse');
        expect(content).toHaveLength(1);
        expect(content[0].simpleVideoUrl).toBe('wouldyourather_b01');
        expect(content[0].cue).toHaveLength(2);
    });

    it('appends the informational row_purpose column exactly once, filled on every row', () => {
        expect(headers.filter((h) => h === ROW_PURPOSE_COLUMN)).toHaveLength(1);
        for (const row of rows) expect(row[ROW_PURPOSE_COLUMN].trim().length).toBeGreaterThan(0);
    });

    it('keeps row_purpose out of CONFIG_COLUMNS and LOCALIZATION_COLUMNS', () => {
        expect(CONFIG_COLUMNS).not.toContain(ROW_PURPOSE_COLUMN);
        expect(LOCALIZATION_COLUMNS).not.toContain(ROW_PURPOSE_COLUMN);
    });

    it('the generator ignores row_purpose (deep-equal without it)', () => {
        const withColumn = buildCourseConfig(rows);
        const stripped = rows.map(({ [ROW_PURPOSE_COLUMN]: _drop, ...rest }) => rest);
        const withoutColumn = buildCourseConfig(stripped);
        expect(withColumn).toEqual(withoutColumn);
        expect(JSON.stringify(withColumn)).not.toContain(ROW_PURPOSE_COLUMN);
    });
});

describe('seed-master-columns CLI', () => {
    function runCli(args) {
        return new Promise((resolve) => {
            execFile('node', [SCRIPT, ...args], { cwd: ROOT, env: process.env }, (err, stdout, stderr) => {
                resolve({ code: err ? err.code : 0, stdout, stderr });
            });
        });
    }

    it('fetches the sheet and writes the seeded CSV to --out', async () => {
        const dir = tmpDir();
        try {
            const out = path.join(dir, 'seeded.csv');
            const { code } = await runCli([`--sheet-url=${baseUrl}`, `--out=${out}`]);
            expect(code).toBe(0);
            expect(existsSync(out)).toBe(true);
            const { headers } = parseCsv(readFileSync(out, 'utf8'));
            for (const col of CONFIG_COLUMNS) expect(headers).toContain(col);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('--help exits 0', async () => {
        const { code, stdout } = await runCli(['--help']);
        expect(code).toBe(0);
        expect(stdout).toContain('--out');
    });
});
