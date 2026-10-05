// scripts/generate-config-from-sheet.test.js
// Story 046 (extends 042): multi-course generation, per-file never-overwrite,
// per-course allow-list, best-effort skips, and the URL source guard.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

let server;
let baseUrl;

beforeAll(async () => {
    server = http.createServer((req, res) => {
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
        for (const flag of ['--sheet-url', '--course', '--out', '--dry-run', '--check', '--force']) {
            expect(stdout).toContain(flag);
        }
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

    it('refuses to overwrite without --force (all files byte-identical)', async () => {
        const dir = tmpDir();
        try {
            await runCli([`--sheet-url=${baseUrl}`, `--out=${dir}`]);
            const beforeA = readFileSync(path.join(dir, 'alpha.json'), 'utf8');
            const beforeB = readFileSync(path.join(dir, 'beta.json'), 'utf8');
            const second = await runCli([`--sheet-url=${baseUrl}`, `--out=${dir}`]);
            expect(second.code).not.toBe(0);
            expect(second.stderr).toContain('refusing to overwrite');
            expect(readFileSync(path.join(dir, 'alpha.json'), 'utf8')).toBe(beforeA);
            expect(readFileSync(path.join(dir, 'beta.json'), 'utf8')).toBe(beforeB);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('--force replaces existing configs', async () => {
        const dir = tmpDir();
        try {
            await runCli([`--sheet-url=${baseUrl}`, `--out=${dir}`]);
            // Corrupt both, then --force must rewrite both.
            writeFileSync(path.join(dir, 'alpha.json'), '{"stale":true}');
            writeFileSync(path.join(dir, 'beta.json'), '{"stale":true}');
            const { code } = await runCli([`--sheet-url=${baseUrl}`, `--out=${dir}`, '--force']);
            expect(code).toBe(0);
            expect(JSON.parse(readFileSync(path.join(dir, 'alpha.json'), 'utf8')).courseId).toBe('alpha');
            expect(JSON.parse(readFileSync(path.join(dir, 'beta.json'), 'utf8')).courseId).toBe('beta');
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
