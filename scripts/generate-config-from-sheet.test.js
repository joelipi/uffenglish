// scripts/generate-config-from-sheet.test.js
// Story 042: CLI surface, never-overwrite, and the URL source guard.
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

const FIXTURE_CSV = [
    'course_id,course_name,lesson_id,lesson_title,recap_sources,recap_overlay,response_type,video_file,filename,order,cue,cue_alt,subtitle_text,srt',
    'demo,Demo Course,a,Lesson A,none,shareCta,lessonIntro,demo-intro,demo-intro01,1,,,,',
    'demo,Demo Course,a,Lesson A,none,shareCta,viewAndContinue,demo-v1,demo-v101,2,,,,Welcome.',
].join('\n');

const BAD_CSV = [
    'course_id,course_name,lesson_id,lesson_title,response_type,video_file,filename,order',
    'demo,Demo Course,a,Lesson A,bogus,demo-v,demo-v1,1',
].join('\n');

let server;
let baseUrl;

beforeAll(async () => {
    server = http.createServer((req, res) => {
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
        for (const flag of ['--sheet-url', '--course', '--out', '--dry-run', '--force']) {
            expect(stdout).toContain(flag);
        }
    });

    it('a bare --course errors', async () => {
        const { code, stderr } = await runCli(['--course']);
        expect(code).not.toBe(0);
        expect(stderr).toContain('--course requires a value');
    });

    it('--dry-run prints the target and writes nothing', async () => {
        const dir = tmpDir();
        const out = path.join(dir, 'demo.json');
        try {
            const { code, stdout } = await runCli([`--sheet-url=${baseUrl}`, `--out=${out}`, '--dry-run']);
            expect(code).toBe(0);
            expect(stdout).toContain(out);
            expect(existsSync(out)).toBe(false);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('writes a new config and refuses to overwrite without --force', async () => {
        const dir = tmpDir();
        const out = path.join(dir, 'demo.json');
        try {
            const first = await runCli([`--sheet-url=${baseUrl}`, `--out=${out}`]);
            expect(first.code).toBe(0);
            expect(existsSync(out)).toBe(true);
            const bytes = readFileSync(out, 'utf8');
            expect(JSON.parse(bytes).courseId).toBe('demo');

            const second = await runCli([`--sheet-url=${baseUrl}`, `--out=${out}`]);
            expect(second.code).not.toBe(0);
            expect(second.stderr).toContain('refusing to overwrite');
            expect(readFileSync(out, 'utf8')).toBe(bytes);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('--force replaces an existing config', async () => {
        const dir = tmpDir();
        const out = path.join(dir, 'demo.json');
        try {
            writeFileSync(out, '{"stale":true}\n');
            const { code } = await runCli([`--sheet-url=${baseUrl}`, `--out=${out}`, '--force']);
            expect(code).toBe(0);
            expect(JSON.parse(readFileSync(out, 'utf8')).courseId).toBe('demo');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('exits non-zero on an unknown response_type and writes nothing', async () => {
        const dir = tmpDir();
        const out = path.join(dir, 'bad.json');
        try {
            const { code, stderr } = await runCli([`--sheet-url=${baseUrl}/bad`, `--out=${out}`]);
            expect(code).not.toBe(0);
            expect(stderr).toContain('bogus');
            expect(existsSync(out)).toBe(false);
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

    it('--course overrides the sheet course_id and the output filename', async () => {
        const dir = tmpDir();
        try {
            const { code, stdout } = await runCli([`--sheet-url=${baseUrl}`, `--course=custom`, `--out=${path.join(dir, 'custom.json')}`]);
            expect(code).toBe(0);
            expect(stdout).toContain('custom.json');
            expect(JSON.parse(readFileSync(path.join(dir, 'custom.json'), 'utf8')).courseId).toBe('custom');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('rejects an unsafe courseId (path traversal) without writing', async () => {
        const dir = tmpDir();
        try {
            const out = path.join(dir, 'x.json');
            const { code, stderr } = await runCli([`--sheet-url=${baseUrl}`, '--course=../evil', `--out=${out}`]);
            expect(code).not.toBe(0);
            expect(stderr).toContain('invalid courseId');
            expect(existsSync(out)).toBe(false);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('does not touch the tracked allow-list when writing via --out', async () => {
        const dir = tmpDir();
        const listPath = path.join(ROOT, 'scripts/lib/generated-configs.json');
        const before = readFileSync(listPath, 'utf8');
        try {
            const { code } = await runCli([`--sheet-url=${baseUrl}`, `--out=${path.join(dir, 'demo.json')}`]);
            expect(code).toBe(0);
            expect(readFileSync(listPath, 'utf8')).toBe(before);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('registers the course in the allow-list when writing the default path', async () => {
        const dir = tmpDir();
        const listPath = path.join(dir, 'allow.json');
        try {
            const { code } = await runCli(
                [`--sheet-url=${baseUrl}`, '--course=regtest'],
                { GENERATED_CONFIGS_ALLOWLIST: listPath, CONFIG_OUT_DIR: dir }
            );
            expect(code).toBe(0);
            expect(JSON.parse(readFileSync(listPath, 'utf8'))).toContain('regtest');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});
