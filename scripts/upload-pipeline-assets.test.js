// CLI tests for scripts/upload-pipeline-assets.mjs (story 040, Task 8): the
// dry-run never spawns npx, and --upload routes through an `npx` PATH shim that
// records argv (mirrors scripts/optimize-videos.test.js).

import { describe, it, expect, afterEach } from 'vitest';
import { wranglerCommand } from './lib/cli-utils.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'scripts', 'upload-pipeline-assets.mjs');

const tmpDirs = [];
function tmpDir(prefix) {
    const d = mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(d);
    return d;
}
afterEach(() => {
    while (tmpDirs.length) rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

function makeAssetsDir() {
    const dir = tmpDir('uff-assets-');
    for (const sub of ['fonts', 'backgrounds', 'audio', 'overlays']) {
        mkdirSync(path.join(dir, sub), { recursive: true });
    }
    writeFileSync(path.join(dir, 'fonts', 'Kalam-Bold.ttf'), 'font');
    writeFileSync(path.join(dir, 'backgrounds', 'bg.mp4'), 'video');
    writeFileSync(path.join(dir, 'audio', 'track.mp3'), 'audio');
    writeFileSync(path.join(dir, 'overlays', 'lower.png'), 'image');
    // Present on purpose: story 052 makes the uploader ignore it (it is the
    // post-render output, not an input), so tests assert it is never uploaded.
    writeFileSync(path.join(dir, 'video_data.csv'), 'filename\nlesson_01\n');
    return dir;
}

function makeNpxShim(marker) {
    const binDir = tmpDir('uff-assets-bin-');
    const shim = path.join(binDir, 'npx');
    // Report a wrangler 3.x so no --remote arg is added; record argv.
    writeFileSync(shim, `#!/bin/sh\nif [ "$1" = "wrangler" ] && [ "$2" = "--version" ]; then echo "3.114.17"; exit 0; fi\necho "$@" >> "${marker}"\nexit 0\n`);
    chmodSync(shim, 0o755);
    return binDir;
}

async function runCli(args, env = {}) {
    try {
        const { stdout, stderr } = await execFileAsync('node', [CLI, ...args], {
            cwd: ROOT,
            env: { ...process.env, ...env },
        });
        return { code: 0, stdout, stderr };
    } catch (err) {
        return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    }
}

describe('upload-pipeline-assets CLI', () => {
    it('--help documents the flags', async () => {
        const { stdout } = await runCli(['--help']);
        for (const flag of ['--assets-dir', '--dry-run', '--upload']) {
            expect(stdout).toContain(flag);
        }
    });

    it('--dry-run prints DRY lines and spawns no npx', async () => {
        const marker = path.join(tmpDir('uff-assets-marker-'), 'npx.log');
        const binDir = makeNpxShim(marker);
        const assetsDir = makeAssetsDir();
        const { code, stdout } = await runCli(['--assets-dir=' + assetsDir, '--dry-run'], {
            PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        });
        expect(code).toBe(0);
        expect(stdout).toContain('DRY pipeline-assets/fonts/Kalam-Bold.ttf');
        // Story 052: video_data.csv is a post-render output, never uploaded.
        expect(stdout).not.toContain('video_data.csv');
        // The shim would have created the marker if it ran.
        let ran = true;
        try { readFileSync(marker, 'utf8'); } catch { ran = false; }
        expect(ran).toBe(false);
    });

    it('--upload routes each asset through npx wrangler r2 object put with content-type', async () => {
        const marker = path.join(tmpDir('uff-assets-marker-'), 'npx.log');
        const binDir = makeNpxShim(marker);
        const assetsDir = makeAssetsDir();
        const { code } = await runCli(['--assets-dir=' + assetsDir, '--upload'], {
            PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        });
        expect(code).toBe(0);
        const log = readFileSync(marker, 'utf8');
        // Story 041: assets go to the private bucket (default uff-private).
        expect(log).toContain('wrangler r2 object put uff-private/pipeline-assets/fonts/Kalam-Bold.ttf');
        expect(log).toContain('--content-type font/ttf');
        // Story 052: the uploader never clobbers the post-render video_data.csv.
        expect(log).not.toContain('video_data.csv');
        // The public bucket prefix is never used.
        expect(log).not.toMatch(/\buff\/pipeline-assets/);
    });

    it('honours PIPELINE_PRIVATE_BUCKET for the target bucket', async () => {
        const marker = path.join(tmpDir('uff-assets-marker-'), 'npx.log');
        const binDir = makeNpxShim(marker);
        const assetsDir = makeAssetsDir();
        const { code } = await runCli(['--assets-dir=' + assetsDir, '--upload'], {
            PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
            PIPELINE_PRIVATE_BUCKET: 'custom-bucket',
        });
        expect(code).toBe(0);
        const log = readFileSync(marker, 'utf8');
        expect(log).toContain('wrangler r2 object put custom-bucket/pipeline-assets/');
    });

    it('fails fast without --assets-dir', async () => {
        const { code, stderr } = await runCli([]);
        expect(code).toBe(1);
        expect(stderr).toContain('--assets-dir');
    });

    it('reads PIPELINE_PRIVATE_BUCKET and never hardcodes a uff/ bucket prefix (source)', () => {
        const src = readFileSync(CLI, 'utf8');
        expect(src).toContain('PIPELINE_PRIVATE_BUCKET');
        // No literal `uff/` bucket prefix (the string `uff-private` is fine).
        expect(src).not.toMatch(/\buff\/pipeline-assets/);
    });
});

describe('cli-utils wranglerCommand', () => {
    it('uses `npx wrangler` on POSIX', () => {
        expect(wranglerCommand(['r2', 'object', 'put'], 'linux')).toEqual({
            bin: 'npx',
            args: ['wrangler', 'r2', 'object', 'put'],
        });
    });

    it('runs the local wrangler JS with node on Windows (npx.cmd cannot be execFile-d)', () => {
        const { bin, args } = wranglerCommand(['r2', 'object', 'put'], 'win32');
        expect(bin).toBe(process.execPath);
        expect(args[0]).toMatch(/node_modules[\\/]wrangler[\\/]bin[\\/]wrangler\.js$/);
        expect(args.slice(1)).toEqual(['r2', 'object', 'put']);
    });
});

describe('upload-pipeline-assets — package wiring', () => {
    it('package.json exposes both asset uploader scripts', () => {
        const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.scripts['pipeline:upload-assets']).toBe('node scripts/upload-pipeline-assets.mjs --upload');
        expect(pkg.scripts['pipeline:upload-assets:dry']).toBe('node scripts/upload-pipeline-assets.mjs --dry-run');
    });
});
