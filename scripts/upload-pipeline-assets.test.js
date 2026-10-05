// CLI tests for scripts/upload-pipeline-assets.mjs (story 040, Task 8): the
// dry-run never spawns npx, and --upload routes through an `npx` PATH shim that
// records argv (mirrors scripts/optimize-videos.test.js).

import { describe, it, expect, afterEach } from 'vitest';
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
        expect(stdout).toContain('DRY pipeline-assets/video_data.csv');
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
        expect(log).toContain('wrangler r2 object put uff/pipeline-assets/fonts/Kalam-Bold.ttf');
        expect(log).toContain('--content-type font/ttf');
        expect(log).toContain('uff/pipeline-assets/video_data.csv');
        expect(log).toContain('--content-type text/csv');
    });

    it('fails fast without --assets-dir', async () => {
        const { code, stderr } = await runCli([]);
        expect(code).toBe(1);
        expect(stderr).toContain('--assets-dir');
    });
});

describe('upload-pipeline-assets — package wiring', () => {
    it('package.json exposes both asset uploader scripts', () => {
        const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.scripts['pipeline:upload-assets']).toBe('node scripts/upload-pipeline-assets.mjs --upload');
        expect(pkg.scripts['pipeline:upload-assets:dry']).toBe('node scripts/upload-pipeline-assets.mjs --dry-run');
    });
});
