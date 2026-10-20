// scripts/generate-config-from-sheet.test.js
// Story 047 (extends 046/042): multi-course generation, overwrite-on-re-run,
// best-effort skips, and the no---force overwrite source guard.
// per-course allow-list, best-effort skips, and the URL source guard.
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateConfigsFromRows } from './generate-config-from-sheet.mjs';
import { parseCsv } from './lib/sheet-config-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/generate-config-from-sheet.mjs');

const HEADER = 'course_id,course_name,lesson_id,lesson_title,response_type,video_file,filename,order,recap_sources,subtitle_text';
// Two complete courses.
const FIXTURE_CSV = [
    HEADER,
    'alpha,Alpha,a,Lesson A,viewAndContinue,alpha-v1,alpha-v101,1,none,Hi.',
    'beta,Beta,b,Lesson B,friendClosedResponse,ab-model-w-response-01,ab1,1,friend,Q?',
].join('\n');

// Course A missing lesson_title; course B complete.
const MIXED_CSV = [
    HEADER,
    'alpha,Alpha,a,,viewAndContinue,alpha-v1,alpha-v101,1,none,Hi.',
    'beta,Beta,b,Lesson B,viewAndContinue,beta-v1,beta-v101,1,none,Bye.',
].join('\n');

// Course with an unknown response_type (structural error).
const BAD_CSV = [
    HEADER,
    'bad,Bad,a,Lesson A,bogus,bad-v1,bad-v101,1,none,X.',
    'beta,Beta,b,Lesson B,viewAndContinue,beta-v1,beta-v101,1,none,Bye.',
].join('\n');

// Story 050: an overlay-master CSV with the config columns filled.
const MASTER_HEADER = [
    'title_text', 'Order', 'phrase', 'subtitle_text', 'filename', 'join', 'video_file',
    'course_id', 'course_name', 'lesson_id', 'lesson_title', 'response_type',
    'recap_sources', 'recap_overlay', 'intro_video', 'success_video', 'success_srt', 'srt',
].join(',');
const MASTER_CSV = [
    MASTER_HEADER,
    'Would you rather,01,Q1,<aside>x</aside>,m1,,master-a01,wvr,WVR,a,Lesson A,friendClosedResponse,none,shareCta,intro,success,The end.,',
    'Would you rather,02,Q2,,m2,,master-a01,wvr,WVR,a,Lesson A,friendClosedResponse,none,shareCta,,,',
    'Would you rather,03,O1,,m3,wvr-b01,master-b01_i,wvr,WVR,b,Lesson B,friendClosedResponse,friend,shareCta,,,',
    'Would you rather,04,O2,,m4,wvr-b01,master-b01_ii,wvr,WVR,b,Lesson B,friendClosedResponse,friend,shareCta,,,',
].join('\n');
// Same master shape, but lesson a has no lesson_title (a required config column).
const MASTER_MISSING_CSV = [
    MASTER_HEADER,
    'Would you rather,01,Q1,,m1,,master-a01,wvr,WVR,a,,friendClosedResponse,none,shareCta,,,',
].join('\n');

// Fixture CSVs live in temp files: the CLI reads the master CSV from disk
// (`--csv`), never over HTTP.
function csvIn(dir, content, name = 'in.csv') {
    const file = path.join(dir, name);
    writeFileSync(file, content);
    return `--csv=${file}`;
}

function runCli(args, env = {}) {
    return new Promise((resolve) => {
        execFile('node', [SCRIPT, ...args], { cwd: ROOT, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
            resolve({ code: err ? err.code : 0, stdout, stderr });
        });
    });
}

function tmpDir() {
    return mkdtempSync(path.join(os.tmpdir(), 'uff-gencfg-'));
}

describe('generate-config-from-sheet CLI', () => {
    it('--help exits 0 and documents the flags', async () => {
        const { code, stdout } = await runCli(['--help']);
        expect(code).toBe(0);
        for (const flag of ['--csv', '--course', '--out', '--dry-run', '--check']) {
            expect(stdout).toContain(flag);
        }
        expect(stdout).not.toContain('--force');
        expect(stdout).not.toContain('--sheet-url');
        expect(stdout).not.toContain('--from-api');
        expect(stdout).not.toContain('--sheet-id');
        expect(stdout).not.toContain('--tab');
    });

    it('a bare --course errors', async () => {
        const { code, stderr } = await runCli(['--course']);
        expect(code).not.toBe(0);
        expect(stderr).toContain('--course requires a value');
    });

    it('writes one config per course', async () => {
        const dir = tmpDir();
        try {
            const { code, stdout } = await runCli([`${csvIn(dir, FIXTURE_CSV)}`, `--out=${dir}`]);
            expect(code).toBe(0);
            expect(JSON.parse(readFileSync(path.join(dir, 'alpha.json'), 'utf8')).courseId).toBe('alpha');
            expect(JSON.parse(readFileSync(path.join(dir, 'beta.json'), 'utf8')).courseId).toBe('beta');
            expect(stdout).toContain(`WROTE ${path.join(dir, 'alpha.json')}`);
            expect(stdout).toContain(`WROTE ${path.join(dir, 'beta.json')}`);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('overwrites existing files on a no-flag re-run (content updated)', async () => {
        const dir = tmpDir();
        try {
            await runCli([`${csvIn(dir, FIXTURE_CSV)}`, `--out=${dir}`]);
            // Corrupt both, then a plain re-run (no --force) must rewrite both.
            writeFileSync(path.join(dir, 'alpha.json'), '{"stale":true}');
            writeFileSync(path.join(dir, 'beta.json'), '{"stale":true}');
            const { code } = await runCli([`${csvIn(dir, FIXTURE_CSV)}`, `--out=${dir}`]);
            expect(code).toBe(0);
            expect(JSON.parse(readFileSync(path.join(dir, 'alpha.json'), 'utf8')).courseId).toBe('alpha');
            expect(JSON.parse(readFileSync(path.join(dir, 'beta.json'), 'utf8')).courseId).toBe('beta');
            // No temp file left beside the configs.
            expect(readdirSync(dir).some((f) => f.includes('.tmp-'))).toBe(false);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('CI path: --check over already-present configs exits 0 and rewrites', async () => {
        const dir = tmpDir();
        try {
            await runCli([`${csvIn(dir, FIXTURE_CSV)}`, `--out=${dir}`]);
            // Corrupt, then the exact configs.yml invocation (--check, no --force).
            writeFileSync(path.join(dir, 'alpha.json'), '{"stale":true}');
            const { code, stdout } = await runCli([`${csvIn(dir, FIXTURE_CSV)}`, `--out=${dir}`, '--check']);
            expect(code).toBe(0);
            expect(JSON.parse(readFileSync(path.join(dir, 'alpha.json'), 'utf8')).courseId).toBe('alpha');
            expect(stdout).toContain('SKIPPED 0 course(s), WROTE 2');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('reports skips, writes the rest, and exits non-zero without --check', async () => {
        const dir = tmpDir();
        try {
            const { code, stderr } = await runCli([`${csvIn(dir, MIXED_CSV)}`, `--out=${dir}`]);
            expect(code).toBe(1);
            expect(stderr).toContain('SKIP course "alpha": missing required column(s): lesson_title (lesson "a")');
            expect(existsSync(path.join(dir, 'alpha.json'))).toBe(false);
            expect(existsSync(path.join(dir, 'beta.json'))).toBe(true);
            expect(stderr).toContain('ERROR: 1 course(s) skipped');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('--check exits 0 on skips and prints a summary', async () => {
        const dir = tmpDir();
        try {
            const { code, stdout, stderr } = await runCli([`${csvIn(dir, MIXED_CSV)}`, `--out=${dir}`, '--check']);
            expect(code).toBe(0);
            expect(existsSync(path.join(dir, 'beta.json'))).toBe(true);
            expect(existsSync(path.join(dir, 'alpha.json'))).toBe(false);
            expect(stderr).toContain('SKIP course "alpha"');
            expect(stdout).toContain('SKIPPED 1 course(s), WROTE 1');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('--check reports a structural error and still writes the valid course', async () => {
        const dir = tmpDir();
        try {
            const { code, stderr } = await runCli([`${csvIn(dir, BAD_CSV)}`, `--out=${dir}`, '--check']);
            expect(code).toBe(0);
            expect(existsSync(path.join(dir, 'beta.json'))).toBe(true);
            expect(stderr).toContain('SKIP course "bad":');
            expect(stderr).not.toContain('missing required column(s)');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('registers both courseIds in the allow-list for a default-path run', async () => {
        const dir = tmpDir();
        const listPath = path.join(dir, 'allow.json');
        try {
            const { code } = await runCli(
                [`${csvIn(dir, FIXTURE_CSV)}`],
                { GENERATED_CONFIGS_ALLOWLIST: listPath, CONFIG_OUT_DIR: dir }
            );
            expect(code).toBe(0);
            expect(JSON.parse(readFileSync(listPath, 'utf8'))).toEqual(['alpha', 'beta']);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('--out does not touch the tracked allow-list', async () => {
        const dir = tmpDir();
        const listPath = path.join(ROOT, 'scripts/lib/generated-configs.json');
        const before = readFileSync(listPath, 'utf8');
        try {
            await runCli([`${csvIn(dir, FIXTURE_CSV)}`, `--out=${dir}`]);
            expect(readFileSync(listPath, 'utf8')).toBe(before);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('--course filters to one course', async () => {
        const dir = tmpDir();
        try {
            const { code, stdout } = await runCli([`${csvIn(dir, FIXTURE_CSV)}`, '--course=beta', `--out=${dir}`]);
            expect(code).toBe(0);
            expect(existsSync(path.join(dir, 'beta.json'))).toBe(true);
            expect(existsSync(path.join(dir, 'alpha.json'))).toBe(false);
            expect(stdout).not.toContain('alpha.json');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('--course with an unknown id writes nothing and errors', async () => {
        const dir = tmpDir();
        try {
            const { code, stderr } = await runCli([`${csvIn(dir, FIXTURE_CSV)}`, '--course=missing', `--out=${dir}`]);
            expect(code).not.toBe(0);
            expect(stderr).toContain('no course "missing" in the CSV');
            expect(existsSync(path.join(dir, 'missing.json'))).toBe(false);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('rejects an unsafe CSV courseId without writing outside the dir', async () => {
        const dir = tmpDir();
        try {
            const csv = [HEADER, '../evil,Evil,a,L,viewAndContinue,evil-v1,evil-v101,1,none,X.'].join('\n');
            // Default mode: the invalid courseId is a skip -> non-zero exit.
            const { code, stderr } = await runCli([csvIn(dir, csv, 'evil.csv'), `--out=${dir}`]);
            expect(code).not.toBe(0);
            expect(stderr).toContain('invalid courseId');
            expect(existsSync(path.join(dir, '..', 'evil.json'))).toBe(false);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('--dry-run prints both would-be paths and writes neither', async () => {
        const dir = tmpDir();
        try {
            const { code, stdout } = await runCli([`${csvIn(dir, FIXTURE_CSV)}`, `--out=${dir}`, '--dry-run']);
            expect(code).toBe(0);
            expect(stdout).toContain('alpha.json');
            expect(stdout).toContain('beta.json');
            expect(existsSync(path.join(dir, 'alpha.json'))).toBe(false);
            expect(existsSync(path.join(dir, 'beta.json'))).toBe(false);
            expect(readdirSync(dir).filter((f) => f.endsWith('.json'))).toEqual([]);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('writes 2-space JSON with exactly one trailing newline, idempotently', async () => {
        const dir = tmpDir();
        try {
            await runCli([`${csvIn(dir, FIXTURE_CSV)}`, `--out=${dir}`]);
            const first = readFileSync(path.join(dir, 'alpha.json'), 'utf8');
            expect(first.endsWith('}\n')).toBe(true);
            expect(first.endsWith('}\n\n')).toBe(false);
            expect(first).toContain('\n  "courseId"');
            await runCli([`${csvIn(dir, FIXTURE_CSV)}`, `--out=${dir}`]);
            expect(readFileSync(path.join(dir, 'alpha.json'), 'utf8')).toBe(first);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('surfaces a write failure instead of silently skipping', async () => {
        const dir = tmpDir();
        try {
            // Make alpha.json a directory so the rename fails.
            const { mkdirSync } = await import('node:fs');
            mkdirSync(path.join(dir, 'alpha.json'));
            const { code, stderr } = await runCli([`${csvIn(dir, FIXTURE_CSV)}`, `--out=${dir}`, '--check']);
            expect(code).not.toBe(0);
            expect(stderr).toContain('ERROR:');
            // The failed write's temp file was cleaned up (no stray *.tmp-*).
            expect(readdirSync(dir).some((f) => f.includes('.tmp-'))).toBe(false);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('default run reads the committed master CSV (source guard)', () => {
        // The default input is the committed store, not a URL: the CLI must
        // resolve it from the master-CSV glob, and the file must exist in the repo.
        const cli = readFileSync(SCRIPT, 'utf8');
        expect(cli).toContain(".endsWith('.master.csv')");
        expect(existsSync(path.join(ROOT, 'public/wouldyourather.master.csv'))).toBe(true);
    });
});

// Story 065, Task 6: the generator reads the committed master CSV from disk.
// `--csv` overrides the file; there is no Sheets API path anymore.
describe('generate-config-from-sheet disk input', () => {
    it('reads the default committed CSV when --csv is absent', async () => {
        const dir = tmpDir();
        try {
            const { code, stdout } = await runCli([`--out=${dir}`]);
            expect(code).toBe(0);
            const config = JSON.parse(readFileSync(path.join(dir, 'wouldyourather.json'), 'utf8'));
            expect(config.courseId).toBe('wouldyourather');
            expect(config.lessons.length).toBe(6);
            expect(stdout).toContain('wouldyourather.json');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('--csv reads the override file', async () => {
        const dir = tmpDir();
        try {
            const { code } = await runCli([`${csvIn(dir, FIXTURE_CSV)}`, `--out=${dir}`]);
            expect(code).toBe(0);
            expect(JSON.parse(readFileSync(path.join(dir, 'alpha.json'), 'utf8')).courseId).toBe('alpha');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('a missing --csv file exits non-zero naming the path', async () => {
        const dir = tmpDir();
        try {
            const missing = path.join(dir, 'nope.csv');
            const { code, stderr } = await runCli([`--csv=${missing}`, `--out=${dir}`]);
            expect(code).not.toBe(0);
            expect(stderr).toContain(missing);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});

// --require-videos: a course is skipped whole until every step rendered
// (carries an srt). Friend clips and authoring-shape courses never block,
// and without the flag behavior is unchanged.
describe('generate-config-from-sheet --require-videos', () => {
    const HEADER = [
        'title_text', 'order', 'phrase', 'filename', 'video_file', 'join', 'course_id',
        'course_name', 'lesson_id', 'lesson_title', 'response_type',
        'recap_sources', 'recap_overlay', 'srt',
    ].join(',');
    const row = () => [
        'T', '1', 'Q', 'f', 'v', '', 'c', 'C', 'a', 'A',
        'friendClosedResponse', 'none', 'shareCta', '',
    ].join(',');
    const csvOf = (rows) => [HEADER, ...rows].join(String.fromCharCode(10));
    // Column indexes into row(): video_file=4, join=5, filename=3.
    const V = (video, file, srt, join = '') => row().split(',').map((v, i) =>
        i === 4 ? video : i === 3 ? file : i === 5 ? join : i === 13 ? srt : v).join(',');

    const cases = [
        {
            name: 'generates a fully-rendered course',
            rows: () => [V('v1', 'f1', 'S1'), V('v2', 'f2', 'S2')],
            flags: ['--require-videos'], code: 0, files: ['c.json'], noFiles: [],
            json: { file: 'c.json', courseId: 'c' },
        },
        {
            name: 'skips a course with an unrendered step whole and reports it',
            rows: () => [V('v1', 'f1', 'S1'), V('v2', 'f2', '')],
            flags: ['--require-videos'], code: 1,
            errContains: ['SKIP course "c": videos pending for 1 step(s): step "v2" (lessons "a")'],
            files: [], noFiles: ['c.json'],
        },
        {
            name: 'a join shares one srt across its rows (pending until any row has it)',
            rows: () => [V('v1', 'f1', '', 'j'), V('v2', 'f2', '', 'j')],
            flags: ['--require-videos'], code: 1,
            errContains: ['step "j" (lessons "a")'], files: [], noFiles: ['c.json'],
        },
        {
            name: 'a join with srt on one row is complete',
            rows: () => [V('v1', 'f1', '', 'j'), V('v2', 'f2', 'S', 'j')],
            flags: ['--require-videos'], code: 0, files: ['c.json'], noFiles: [],
        },
        {
            name: 'an authoring-shape course never blocks (subtitles need no render)',
            rows: () => ['course_id,course_name,lesson_id,lesson_title,response_type,video_file,filename,order,recap_sources,cue'],
            flags: ['--require-videos'], code: 0, files: [], noFiles: [],
            customCsv: [
                'course_id,course_name,lesson_id,lesson_title,response_type,video_file,filename,order,recap_sources,cue',
                'c,C,a,A,viewAndContinue,v1,f1,1,none,Q?',
            ].join(String.fromCharCode(10)),
        },
        {
            name: 'a friend clip without srt never blocks its course',
            rows: () => [
                V('v1', 'f1', 'S1'),
                ['T', '1', '', '', '{friendCode}crs-a-01', '', 'c', 'C', 'a', 'A', 'friendClosedResponse', 'friend', 'shareCta', ''].join(','),
            ],
            flags: ['--require-videos'], code: 0, files: ['c.json'], noFiles: [],
        },
        {
            name: '--check keeps a pending skip non-fatal',
            rows: () => [V('v1', 'f1', '')],
            flags: ['--require-videos', '--check'], code: 0,
            outContains: ['SKIPPED 1 course(s), WROTE 0'], files: [], noFiles: ['c.json'],
        },
        {
            name: 'without the flag an srt-less course still generates',
            rows: () => [V('v1', 'f1', '')],
            flags: [], code: 0, files: ['c.json'], noFiles: [],
        },
    ];

    for (const t of cases) {
        it(t.name, async () => {
            const dir = tmpDir();
            try {
                const csv = t.customCsv || csvOf(t.rows());
                const { code, stdout, stderr } = await runCli([csvIn(dir, csv, 'm.csv'), `--out=${dir}`, ...t.flags]);
                expect(code).toBe(t.code);
                for (const s of t.errContains || []) expect(stderr).toContain(s);
                for (const s of t.outContains || []) expect(stdout).toContain(s);
                for (const f of t.files || []) expect(existsSync(path.join(dir, f))).toBe(true);
                for (const f of t.noFiles || []) expect(existsSync(path.join(dir, f))).toBe(false);
                if (t.json) {
                    expect(JSON.parse(readFileSync(path.join(dir, t.json.file), 'utf8')).courseId).toBe(t.json.courseId);
                }
            } finally { rmSync(dir, { recursive: true, force: true }); }
        });
    }
});

// Story 050, Task 2: the generator reads the overlay master (a `phrase` header).
describe('generate-config-from-sheet master format', () => {
    it('writes a valid config whose lessons/steps match a master fixture', async () => {
        const dir = tmpDir();
        try {
            const { code } = await runCli([`${csvIn(dir, MASTER_CSV)}`, `--out=${dir}`]);
            expect(code).toBe(0);
            const config = JSON.parse(readFileSync(path.join(dir, 'wvr.json'), 'utf8'));
            expect(config).toEqual({
                courseId: 'wvr',
                courseName: 'WVR',
                lessons: [
                    {
                        lessonId: 'a', recapSources: 'none', recapOverlay: 'shareCta',
                        title: { en: 'Lesson A' },
                        steps: [
                            { cue: '', responseType: 'lessonIntro', introBackgroundVideoUrl: 'intro' },
                            { responseType: 'friendClosedResponse', simpleVideoUrl: 'master-a01', cue: [{ en: 'Q1' }, { en: 'Q2' }] },
                            // No success step: it is code-owned (app-injected per lesson type).
                        ],
                    },
                    {
                        lessonId: 'b', recapSources: 'friend', recapOverlay: 'shareCta',
                        title: { en: 'Lesson B' },
                        steps: [
                            { responseType: 'friendClosedResponse', simpleVideoUrl: 'wvr-b01', cue: [{ en: 'O1' }, { en: 'O2' }] },
                        ],
                    },
                ],
            });
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('skips a master course missing a required config column and reports it', async () => {
        const dir = tmpDir();
        try {
            const { code, stderr } = await runCli([`${csvIn(dir, MASTER_MISSING_CSV)}`, `--out=${dir}`, '--check']);
            expect(code).toBe(0);
            expect(stderr).toContain('SKIP course "wvr": missing required column(s): lesson_title (lesson "a")');
            expect(existsSync(path.join(dir, 'wvr.json'))).toBe(false);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});

// Story 065, Task 6: the generator reads the committed master CSV from disk.
// The default path literal is pinned (the pipeline parity test asserts the
// three readers agree), and no Sheets/API surface may remain. The raw source
// is asserted (no comment stripping); each pin is proven failable.
describe('committed master CSV input (story 065, Task 6)', () => {
    const assertDiskContract = (cli) => {
        // Story 076: the generator reads every committed master CSV, and the
        // path is derived from the course id (no course is named).
        expect(cli).toContain("MASTER_CSV_GLOB = 'public/*.master.csv'");
        expect(cli).toContain(".endsWith('.master.csv')");
        expect(cli).not.toContain('SHEET_URL');
        expect(cli).not.toContain('docs.google.com');
        expect(cli).not.toContain('--from-api');
        expect(cli).not.toContain('GOOGLE_SERVICE_ACCOUNT_JSON');
        expect(cli).not.toContain('GOOGLE_SHEET_ID');
        expect(cli).not.toContain('loadRowsFromApi');
    };

    it('pins the committed path and carries no Sheets surface', () => {
        expect(() => assertDiskContract(readFileSync(SCRIPT, 'utf8'))).not.toThrow();
    });

    it('the guard can fail on each pinned token', () => {
        const good = readFileSync(SCRIPT, 'utf8');
        // replaceAll: the filter appears twice, and mutating only the first
        // would leave the guard green.
        expect(() => assertDiskContract(
            good.replaceAll(".endsWith('.master.csv')", ".endsWith('.csv')")
        )).toThrow();
        expect(() => assertDiskContract(
            good.replace("MASTER_CSV_GLOB = 'public/*.master.csv'", "MASTER_CSV_GLOB = 'public/one.csv'")
        )).toThrow();
        for (const injected of [
            "\n// export const SHEET_URL = 'x';\n",
            '\n// see docs.google.com/spreadsheets/d/x\n',
            '\n// retired: --from-api\n',
            '\n// GOOGLE_SERVICE_ACCOUNT_JSON\n',
        ]) {
            expect(() => assertDiskContract(good + injected), injected).toThrow();
        }
    });
});

// Story 047: the CLI overwrites unconditionally and has no --force. Guards read
// the raw source (it contains `https://` so no comment-stripping), and each is
// proven failable by mutating the real text.
describe('generate-config-from-sheet — overwrite source guard', () => {
    const read = () => readFileSync(SCRIPT, 'utf8');

    const assertOverwriteContract = (text) => {
        expect(text).not.toContain('refusing to overwrite');
        expect(text).not.toContain('--force');
        expect(text).toContain('await fs.rename(');
        expect(text).not.toContain('fs.access(');
    };

    it('the CLI no longer refuses to overwrite and has no --force', () => {
        expect(() => assertOverwriteContract(read())).not.toThrow();
    });

    it('the guard can fail on each mutation', () => {
        const good = read();
        const mutations = [
            good + '\n// refusing to overwrite\n',
            good + '\n// --force\n',
            good.replace('await fs.rename(', 'await fs.access('),
        ];
        for (const mutated of mutations) {
            expect(() => assertOverwriteContract(mutated)).toThrow();
        }
    });
});

// Story 057, Task 5: the docs pin the overlay-master mapping, the informational
// `row_purpose` column, and the friend-clip no-subtitles rule. Guards read the
// raw source (no comment stripping) and are proven failable per token.
describe('story 057 docs — overlay-master mapping + friend-clip rule', () => {
    const AUTHORING_DOC = path.join(ROOT, 'docs/video-pipeline/authoring-sheet.md');
    const PRODUCT_DOC = path.join(ROOT, 'docs/product.md');
    const STORY_LINK = 'stories/057-branching-friend-videos-subtitles/story.md';

    const assertDocs = ({ authoring, product }) => {
        // authoring-sheet.md: the mapping section, the join/video_file grouping
        // rule, and the informational row_purpose column.
        expect(authoring).toContain('## Overlay master → config fields');
        expect(authoring).toContain('a step is the `join` value when non-blank, else the `video_file`');
        expect(authoring).toContain('| `join` else `video_file` |');
        expect(authoring).toContain('`row_purpose`');
        expect(authoring).toContain('ignored by the generator and translator');
        // the friend-clip rule: a `{friendCode}` step gets no app subtitles.
        expect(authoring).toContain('A friend UGC clip gets no app `subtitles`');
        expect(authoring).toContain('whose key is a `{friendCode}`');
        // product.md: the app-behavior entry and the authoring entry, both linked.
        expect(product).toContain('Friend-recorded clips never show app subtitles');
        expect(product).toContain('Self-documenting overlay master');
        expect(product).toContain('`row_purpose`');
        expect(product).toContain(STORY_LINK);
    };

    const strip = (text, token) => text.split(token).join('');

    it('the docs pin the mapping, the row_purpose column, and the friend-clip rule', () => {
        expect(() => assertDocs({
            authoring: readFileSync(AUTHORING_DOC, 'utf8'),
            product: readFileSync(PRODUCT_DOC, 'utf8'),
        })).not.toThrow();
    });

    it('the guard can fail on each pinned token', () => {
        const authoring = readFileSync(AUTHORING_DOC, 'utf8');
        const product = readFileSync(PRODUCT_DOC, 'utf8');
        const authoringTokens = [
            '## Overlay master → config fields',
            'a step is the `join` value when non-blank, else the `video_file`',
            '| `join` else `video_file` |',
            '`row_purpose`',
            'ignored by the generator and translator',
            'A friend UGC clip gets no app `subtitles`',
            'whose key is a `{friendCode}`',
        ];
        for (const token of authoringTokens) {
            expect(() => assertDocs({ authoring: strip(authoring, token), product })).toThrow();
        }
        const productTokens = [
            'Friend-recorded clips never show app subtitles',
            'Self-documenting overlay master',
            '`row_purpose`',
            STORY_LINK,
        ];
        for (const token of productTokens) {
            expect(() => assertDocs({ authoring, product: strip(product, token) })).toThrow();
        }
    });
});
