// scripts/optimize-videos.test.js
// Story 032: CLI flag/planning coverage for the R2 lesson-video optimizer.
import { describe, it, expect } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFaststart, MAX_VIDEO_WIDTH } from './lib/video-optimize-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/optimize-videos.mjs');
const SOURCE = readFileSync(SCRIPT, 'utf8');
const BAD_CDN = 'http://127.0.0.1:1/assets/videos/';

function runCli(args, env = {}) {
    return new Promise((resolve) => {
        execFile(
            'node',
            [SCRIPT, ...args],
            { cwd: ROOT, env: { ...process.env, VIDEO_CDN_BASE: BAD_CDN, ...env } },
            (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })
        );
    });
}

function hasFfmpeg() {
    try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

const ffmpegIt = hasFfmpeg() ? it : it.skip;

function makeFixture(dir, slug, { faststart = false, wide = false } = {}) {
    const out = path.join(dir, `${slug}.mp4`);
    const size = wide ? '1280x720' : '320x240';
    const args = [
        '-y', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=10`,
        '-f', 'lavfi', '-i', 'sine=frequency=440',
        '-t', '1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        ...(faststart ? ['-movflags', '+faststart'] : []),
        out,
    ];
    execFileSync('ffmpeg', args);
    return out;
}

function tmpDir() {
    return mkdtempSync(path.join(os.tmpdir(), 'uff-opt-test-'));
}

describe('optimize-videos CLI', () => {
    it('--help documents the flags', async () => {
        const { code, stdout } = await runCli(['--help']);
        expect(code).toBe(0);
        for (const flag of ['--slug', '--upload', '--force', '--dry-run', '--video-dir']) {
            expect(stdout).toContain(flag);
        }
    });

    it('rejects a VIDEO_OUT_DIR inside the repo root', async () => {
        const inside = path.join(ROOT, 'scripts', '__tmp_opt_out__');
        const { code, stderr } = await runCli(['--slug=x', '--dry-run'], { VIDEO_OUT_DIR: inside });
        expect(code).not.toBe(0);
        expect(stderr).toContain('outside the repo root');
        expect(existsSync(inside)).toBe(false);
    });

    it('source guards: imports the utils and keeps upload/out-dir contracts', () => {
        expect(SOURCE).toContain("from './lib/video-optimize-utils.js'");
        for (const name of ['collectVideoTargets', 'planVideoOptimize', 'remuxArgs', 'reencodeArgs', 'isFaststart']) {
            expect(SOURCE).toContain(name);
        }
        expect(SOURCE).toContain("'r2', 'object', 'put'");
        expect(SOURCE).toContain('--upload');
        expect(SOURCE).toContain("path.join(os.tmpdir(), 'uff-videos')");
        expect(SOURCE).toContain('outside the repo root');
    });
});

describe('optimize-videos CLI — planning', () => {
    ffmpegIt('plans a remux for a non-faststart clip (dry run writes nothing)', async () => {
        const srcDir = tmpDir();
        const outDir = tmpDir();
        makeFixture(srcDir, 'testvideointro', { faststart: false });
        try {
            const { code, stdout } = await runCli(
                ['--slug=testvideointro', `--video-dir=${srcDir}`, '--dry-run'],
                { VIDEO_OUT_DIR: outDir }
            );
            expect(code).toBe(0);
            expect(stdout).toContain('OPT testvideointro remux');
            expect(existsSync(path.join(outDir, 'testvideointro.mp4'))).toBe(false);
        } finally {
            rmSync(srcDir, { recursive: true, force: true });
            rmSync(outDir, { recursive: true, force: true });
        }
    });

    ffmpegIt('skips an already-faststart clip within budget', async () => {
        const srcDir = tmpDir();
        const outDir = tmpDir();
        makeFixture(srcDir, 'testvideointro', { faststart: true });
        try {
            const { code, stdout } = await runCli(
                ['--slug=testvideointro', `--video-dir=${srcDir}`, '--dry-run'],
                { VIDEO_OUT_DIR: outDir }
            );
            expect(code).toBe(0);
            expect(stdout).toContain('SKIP testvideointro');
        } finally {
            rmSync(srcDir, { recursive: true, force: true });
            rmSync(outDir, { recursive: true, force: true });
        }
    });

    it('reports a missing source without aborting', async () => {
        const srcDir = tmpDir();
        const outDir = tmpDir();
        try {
            const { code, stdout } = await runCli(
                ['--slug=missing-clip', `--video-dir=${srcDir}`],
                { VIDEO_OUT_DIR: outDir }
            );
            expect(code).toBe(0);
            expect(stdout).toContain('MISS missing-clip');
        } finally {
            rmSync(srcDir, { recursive: true, force: true });
            rmSync(outDir, { recursive: true, force: true });
        }
    });
});

describe('optimize-videos CLI — ffmpeg integration', () => {
    ffmpegIt('writes a faststart output and caps the width', async () => {
        const srcDir = tmpDir();
        const outDir = tmpDir();
        makeFixture(srcDir, 'wideclip', { faststart: false, wide: true });
        try {
            const { code, stdout } = await runCli(
                ['--slug=wideclip', `--video-dir=${srcDir}`],
                { VIDEO_OUT_DIR: outDir }
            );
            expect(code).toBe(0);
            expect(stdout).toContain('OPT wideclip reencode');

            const out = path.join(outDir, 'wideclip.mp4');
            expect(existsSync(out)).toBe(true);
            expect(isFaststart(readFileSync(out))).toBe(true);

            const width = Number(
                execFileSync('ffprobe', [
                    '-v', 'error', '-select_streams', 'v:0',
                    '-show_entries', 'stream=width', '-of', 'csv=p=0', out,
                ]).toString().trim()
            );
            expect(width).toBeLessThanOrEqual(MAX_VIDEO_WIDTH);
        } finally {
            rmSync(srcDir, { recursive: true, force: true });
            rmSync(outDir, { recursive: true, force: true });
        }
    });

    ffmpegIt('does not spawn wrangler without --upload', async () => {
        const srcDir = tmpDir();
        const outDir = tmpDir();
        const binDir = tmpDir();
        const marker = path.join(binDir, 'wrangler-called');
        makeFixture(srcDir, 'noclip', { faststart: false });
        const shim = path.join(binDir, 'npx');
        writeFileSync(shim, `#!/bin/sh\necho "$@" >> "${marker}"\nexit 0\n`);
        chmodSync(shim, 0o755);
        try {
            const { code } = await runCli(
                ['--slug=noclip', `--video-dir=${srcDir}`],
                {
                    VIDEO_OUT_DIR: outDir,
                    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
                }
            );
            expect(code).toBe(0);
            expect(existsSync(marker)).toBe(false);
        } finally {
            rmSync(srcDir, { recursive: true, force: true });
            rmSync(outDir, { recursive: true, force: true });
            rmSync(binDir, { recursive: true, force: true });
        }
    });
});
