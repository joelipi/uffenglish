// scripts/generate-config-from-sheet.test.js
// Story 047 (extends 046/042): multi-course generation, overwrite-on-re-run,
// best-effort skips, and the no---force overwrite source guard.
// per-course allow-list, best-effort skips, and the URL source guard.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRowsFromApi, generateConfigsFromRows } from './generate-config-from-sheet.mjs';
import { parseCsv } from './lib/sheet-config-utils.js';
import { PUBLISHED_GID } from './translate-sheet.mjs';

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

let server;
let baseUrl;

beforeAll(async () => {
    server = http.createServer((req, res) => {
        if (req.url.includes('master-missing')) { res.writeHead(200); res.end(MASTER_MISSING_CSV); return; }
        if (req.url.includes('master')) { res.writeHead(200); res.end(MASTER_CSV); return; }
        if (req.url.includes('mixed')) { res.writeHead(200); res.end(MIXED_CSV); return; }
        if (req.url.includes('bad')) { res.writeHead(200); res.end(BAD_CSV); return; }
        res.writeHead(200); res.end(FIXTURE_CSV);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/sheet`;
});

afterAll(() => { server?.close(); });

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
        for (const flag of ['--sheet-url', '--course', '--out', '--dry-run', '--check']) {
            expect(stdout).toContain(flag);
        }
        expect(stdout).not.toContain('--force');
    });

    it('a bare --course errors', async () => {
        const { code, stderr } = await runCli(['--course']);
        expect(code).not.toBe(0);
        expect(stderr).toContain('--course requires a value');
    });

    it('writes one config per course', async () => {
        const dir = tmpDir();
        try {
            const { code, stdout } = await runCli([`--sheet-url=${baseUrl}`, `--out=${dir}`]);
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
            await runCli([`--sheet-url=${baseUrl}`, `--out=${dir}`]);
            // Corrupt both, then a plain re-run (no --force) must rewrite both.
            writeFileSync(path.join(dir, 'alpha.json'), '{"stale":true}');
            writeFileSync(path.join(dir, 'beta.json'), '{"stale":true}');
            const { code } = await runCli([`--sheet-url=${baseUrl}`, `--out=${dir}`]);
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
            await runCli([`--sheet-url=${baseUrl}`, `--out=${dir}`]);
            // Corrupt, then the exact configs.yml invocation (--check, no --force).
            writeFileSync(path.join(dir, 'alpha.json'), '{"stale":true}');
            const { code, stdout } = await runCli([`--sheet-url=${baseUrl}`, `--out=${dir}`, '--check']);
            expect(code).toBe(0);
            expect(JSON.parse(readFileSync(path.join(dir, 'alpha.json'), 'utf8')).courseId).toBe('alpha');
            expect(stdout).toContain('SKIPPED 0 course(s), WROTE 2');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('reports skips, writes the rest, and exits non-zero without --check', async () => {
        const dir = tmpDir();
        try {
            const { code, stderr } = await runCli([`--sheet-url=${baseUrl}/mixed`, `--out=${dir}`]);
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
            const { code, stdout, stderr } = await runCli([`--sheet-url=${baseUrl}/mixed`, `--out=${dir}`, '--check']);
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
            const { code, stderr } = await runCli([`--sheet-url=${baseUrl}/bad`, `--out=${dir}`, '--check']);
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
                [`--sheet-url=${baseUrl}`],
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
            await runCli([`--sheet-url=${baseUrl}`, `--out=${dir}`]);
            expect(readFileSync(listPath, 'utf8')).toBe(before);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('--course filters to one course', async () => {
        const dir = tmpDir();
        try {
            const { code, stdout } = await runCli([`--sheet-url=${baseUrl}`, '--course=beta', `--out=${dir}`]);
            expect(code).toBe(0);
            expect(existsSync(path.join(dir, 'beta.json'))).toBe(true);
            expect(existsSync(path.join(dir, 'alpha.json'))).toBe(false);
            expect(stdout).not.toContain('alpha.json');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('--course with an unknown id writes nothing and errors', async () => {
        const dir = tmpDir();
        try {
            const { code, stderr } = await runCli([`--sheet-url=${baseUrl}`, '--course=missing', `--out=${dir}`]);
            expect(code).not.toBe(0);
            expect(stderr).toContain('no course "missing" in the sheet');
            expect(existsSync(path.join(dir, 'missing.json'))).toBe(false);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('rejects an unsafe sheet courseId without writing outside the dir', async () => {
        const dir = tmpDir();
        try {
            const csv = [HEADER, '../evil,Evil,a,L,viewAndContinue,evil-v1,evil-v101,1,none,X.'].join('\n');
            const badServer = http.createServer((_, res) => { res.writeHead(200); res.end(csv); });
            await new Promise((r) => badServer.listen(0, '127.0.0.1', r));
            const url = `http://127.0.0.1:${badServer.address().port}/s`;
            // Default mode: the invalid courseId is a skip -> non-zero exit.
            const { code, stderr } = await runCli([`--sheet-url=${url}`, `--out=${dir}`]);
            expect(code).not.toBe(0);
            expect(stderr).toContain('invalid courseId');
            expect(existsSync(path.join(dir, '..', 'evil.json'))).toBe(false);
            badServer.close();
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('--dry-run prints both would-be paths and writes neither', async () => {
        const dir = tmpDir();
        try {
            const { code, stdout } = await runCli([`--sheet-url=${baseUrl}`, `--out=${dir}`, '--dry-run']);
            expect(code).toBe(0);
            expect(stdout).toContain('alpha.json');
            expect(stdout).toContain('beta.json');
            expect(existsSync(path.join(dir, 'alpha.json'))).toBe(false);
            expect(existsSync(path.join(dir, 'beta.json'))).toBe(false);
            expect(readdirSync(dir).length).toBe(0);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('writes 2-space JSON with exactly one trailing newline, idempotently', async () => {
        const dir = tmpDir();
        try {
            await runCli([`--sheet-url=${baseUrl}`, `--out=${dir}`]);
            const first = readFileSync(path.join(dir, 'alpha.json'), 'utf8');
            expect(first.endsWith('}\n')).toBe(true);
            expect(first.endsWith('}\n\n')).toBe(false);
            expect(first).toContain('\n  "courseId"');
            await runCli([`--sheet-url=${baseUrl}`, `--out=${dir}`]);
            expect(readFileSync(path.join(dir, 'alpha.json'), 'utf8')).toBe(first);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('surfaces a write failure instead of silently skipping', async () => {
        const dir = tmpDir();
        try {
            // Make alpha.json a directory so the rename fails.
            const { mkdirSync } = await import('node:fs');
            mkdirSync(path.join(dir, 'alpha.json'));
            const { code, stderr } = await runCli([`--sheet-url=${baseUrl}`, `--out=${dir}`, '--check']);
            expect(code).not.toBe(0);
            expect(stderr).toContain('ERROR:');
            // The failed write's temp file was cleaned up (no stray *.tmp-*).
            expect(readdirSync(dir).some((f) => f.includes('.tmp-'))).toBe(false);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('default sheet URL matches the recorder page (source guard)', () => {
        const cli = readFileSync(SCRIPT, 'utf8');
        const recorder = readFileSync(path.join(ROOT, 'public/recorder.html'), 'utf8');
        // Raw source (no comment stripping): the URL contains `//`.
        const url = /https:\/\/docs\.google\.com\/spreadsheets\/[^'"]+/.exec(cli);
        expect(url).not.toBeNull();
        expect(recorder).toContain(url[0]);
    });
});

// Story 051, Task 3: `--from-api` reads the sheet via the Sheets API so a
// chained run sees fresh cells, producing the same rows/config as the CSV path.
describe('generate-config-from-sheet --from-api', () => {
    const valuesFromCsv = () => FIXTURE_CSV.split('\n').map((line) => line.split(','));

    it('reads the same header-keyed rows shape as the CSV path (injected seam)', async () => {
        const calls = [];
        const rows = await loadRowsFromApi({
            sheetId: 'S', tab: 'Sheet1',
            getValues: async (params) => { calls.push(params); return { values: valuesFromCsv() }; },
            getSpreadsheet: async () => ({ sheets: [{ properties: { sheetId: PUBLISHED_GID, title: 'Sheet1' } }] }),
        });
        expect(rows).toEqual(parseCsv(FIXTURE_CSV).rows);
        expect(calls[0].spreadsheetId).toBe('S');
        expect(calls[0].range).toContain('A1:ZZ');
    });

    it('resolves the tab from the published gid when --tab is absent', async () => {
        const calls = [];
        await loadRowsFromApi({
            sheetId: 'S',
            getValues: async (params) => { calls.push(params); return { values: [['course_id', 'course_name'], ['x', 'X']] }; },
            getSpreadsheet: async () => ({ sheets: [{ properties: { sheetId: PUBLISHED_GID, title: 'Master' } }] }),
        });
        expect(calls[0].range).toContain("'Master'!A1:ZZ");
    });

    it('does not require getSpreadsheet when a tab is supplied', async () => {
        const rows = await loadRowsFromApi({
            sheetId: 'S', tab: 'Sheet1',
            getValues: async () => ({ values: valuesFromCsv() }),
        });
        expect(rows).toEqual(parseCsv(FIXTURE_CSV).rows);
    });

    it('requires getSpreadsheet to resolve the tab when --tab is absent', async () => {
        await expect(loadRowsFromApi({
            sheetId: 'S',
            getValues: async () => ({ values: valuesFromCsv() }),
        })).rejects.toThrow(/Google Sheets client/);
    });

    it('writes the same config the CSV path would for identical cell values', async () => {
        const apiRows = await loadRowsFromApi({
            sheetId: 'S', tab: 'Sheet1',
            getValues: async () => ({ values: valuesFromCsv() }),
        });
        const csvRows = parseCsv(FIXTURE_CSV).rows;
        const apiDir = tmpDir();
        const csvDir = tmpDir();
        try {
            await generateConfigsFromRows({ rows: apiRows, outDir: apiDir, check: true, log: () => {}, errorLog: () => {} });
            await generateConfigsFromRows({ rows: csvRows, outDir: csvDir, check: true, log: () => {}, errorLog: () => {} });
            for (const name of ['alpha.json', 'beta.json']) {
                expect(readFileSync(path.join(apiDir, name), 'utf8'))
                    .toBe(readFileSync(path.join(csvDir, name), 'utf8'));
            }
        } finally {
            rmSync(apiDir, { recursive: true, force: true });
            rmSync(csvDir, { recursive: true, force: true });
        }
    });

    it('--from-api without GOOGLE_SERVICE_ACCOUNT_JSON exits non-zero naming it', async () => {
        const dir = tmpDir();
        try {
            const { code, stderr } = await runCli(['--from-api', `--out=${dir}`], { GOOGLE_SERVICE_ACCOUNT_JSON: '' });
            expect(code).not.toBe(0);
            expect(stderr).toContain('GOOGLE_SERVICE_ACCOUNT_JSON');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('--from-api without a sheet id exits non-zero naming it', async () => {
        const dir = tmpDir();
        try {
            const { code, stderr } = await runCli(
                ['--from-api', `--out=${dir}`],
                { GOOGLE_SERVICE_ACCOUNT_JSON: '{}', GOOGLE_SHEET_ID: '' }
            );
            expect(code).not.toBe(0);
            expect(stderr).toMatch(/GOOGLE_SHEET_ID|--sheet-id/);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('--help documents the API flags', async () => {
        const { code, stdout } = await runCli(['--help']);
        expect(code).toBe(0);
        for (const flag of ['--from-api', '--sheet-id', '--tab']) expect(stdout).toContain(flag);
    });
});

// Story 050, Task 2: the generator reads the overlay master (a `phrase` header).
describe('generate-config-from-sheet master format', () => {
    it('writes a valid config whose lessons/steps match a master fixture', async () => {
        const dir = tmpDir();
        try {
            const { code } = await runCli([`--sheet-url=${baseUrl}/master`, `--out=${dir}`]);
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
                            { responseType: 'success', simpleVideoUrl: 'success', subtitles: { en: 'The end.' } },
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
            const { code, stderr } = await runCli([`--sheet-url=${baseUrl}/master-missing`, `--out=${dir}`, '--check']);
            expect(code).toBe(0);
            expect(stderr).toContain('SKIP course "wvr": missing required column(s): lesson_title (lesson "a")');
            expect(existsSync(path.join(dir, 'wvr.json'))).toBe(false);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});

// Story 050, Task 3: all three consumers point at the live master (gid 242913338),
// and SHEET_URL stays byte-identical to the recorder URL. Guards read raw source
// (URLs contain `//`, so no comment-stripping) and are proven failable.
describe('published master URL (story 050, Task 3)', () => {
    const MASTER_PUBLISHED_ID = '2PACX-1vQZ7jFMJNnmylDoHxaqb1W8VyXi0OV4pSubCbqMGYkRgGimqWx3cs74n43-cFxqfue4KCiqWlhzvPkK';
    const readRecorder = () => readFileSync(path.join(ROOT, 'public/recorder.html'), 'utf8');
    const readTranslator = () => readFileSync(path.join(ROOT, 'scripts/translate-sheet.mjs'), 'utf8');

    const assertLiveMaster = ({ recorder, cli, translator }) => {
        expect(recorder).toContain(MASTER_PUBLISHED_ID);
        expect(recorder).toContain('gid=242913338');
        const url = /https:\/\/docs\.google\.com\/spreadsheets\/[^'"]+/.exec(cli);
        expect(url).not.toBeNull();
        expect(recorder).toContain(url[0]);
        expect(url[0]).toContain('gid=242913338');
        expect(translator).toContain('PUBLISHED_GID = 242913338');
    };

    it('SHEET_URL, the recorder URL, and PUBLISHED_GID all pin the live master', () => {
        expect(() => assertLiveMaster({
            recorder: readRecorder(), cli: readFileSync(SCRIPT, 'utf8'), translator: readTranslator(),
        })).not.toThrow();
    });

    it('the guard can fail on each mutation', () => {
        const recorder = readRecorder();
        const cli = readFileSync(SCRIPT, 'utf8');
        const translator = readTranslator();
        expect(() => assertLiveMaster({
            recorder: recorder.replace('gid=242913338', 'gid=289451687'), cli, translator,
        })).toThrow();
        expect(() => assertLiveMaster({
            recorder: recorder.replace(MASTER_PUBLISHED_ID, 'OLD-ID'), cli, translator,
        })).toThrow();
        expect(() => assertLiveMaster({
            recorder, cli, translator: translator.replace('PUBLISHED_GID = 242913338', 'PUBLISHED_GID = 289451687'),
        })).toThrow();
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
        // the friend-clip rule: a `-response-NN` step gets no app subtitles.
        expect(authoring).toContain('A friend UGC clip gets no app `subtitles`');
        expect(authoring).toContain('whose key ends in `-response-NN`');
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
            'whose key ends in `-response-NN`',
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
