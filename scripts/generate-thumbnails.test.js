// scripts/generate-thumbnails.test.js
// CLI wiring and behaviour for the slug-keyed, R2-only poster generator
// (stories/011-auto-intro-poster, Task 2).
import { describe, it, expect } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/generate-thumbnails.mjs');
const SOURCE = readFileSync(SCRIPT, 'utf8');

const INTRO_SLUGS = [
    'testvideo01',
    'do_you_have_rolls_too',
    'do_you_have_dark_chocolate',
    'gtests-1-0',
    'gtests-0-1-1',
];

function runCli(args, env = {}) {
    return new Promise((resolve) => {
        execFile('node', [SCRIPT, ...args], { cwd: ROOT, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
            resolve({ code: err ? err.code : 0, stdout, stderr });
        });
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

describe('generate-thumbnails.mjs source', () => {
    it('imports the pure planner from ./lib/poster-utils.js', () => {
        expect(SOURCE).toContain("from './lib/poster-utils.js'");
        expect(SOURCE).toContain('introTargets');
        expect(SOURCE).toContain('planPosterRun');
    });

    it('scans every src/config/*.json via the shared loader (no model.json-only read)', () => {
        expect(SOURCE).toMatch(/CONFIG_DIR/);
        expect(SOURCE).toContain('loadConfigs');
        expect(SOURCE).not.toMatch(/MODEL_PATH/);
    });

    it('writes to an OS temp work dir and honours POSTER_OUT_DIR', () => {
        expect(SOURCE).toContain('POSTER_OUT_DIR');
        expect(SOURCE).toMatch(/os\.tmpdir\(\)/);
        expect(SOURCE).not.toMatch(/public\/assets\/posters/);
    });

    it('checks poster existence via an R2 HEAD on the slug sibling', () => {
        expect(SOURCE).toContain('https://r2.ultrafastfluency.com/assets/videos/');
        expect(SOURCE).toMatch(/method:\s*'HEAD'/);
    });

    it('encodes with the tuned filter/quality and checks the byte budget', () => {
        expect(SOURCE).toContain('POSTER_WIDTH');
        expect(SOURCE).toMatch(/scale=\$\{POSTER_WIDTH\}:-2/);
        expect(SOURCE).toContain('POSTER_QUALITY');
        expect(SOURCE).toContain('exceedsPosterBudget');
    });

    it('uploads to the slug sibling R2 key', () => {
        expect(SOURCE).toContain('posterR2Key');
        expect(SOURCE).toMatch(/r2',\s*'object',\s*'put'/);
    });
});

describe('generate-thumbnails.mjs CLI', () => {
    it('exits 0 and prints the supported flags for --help', async () => {
        const { code, stdout } = await runCli(['--help']);
        expect(code).toBe(0);
        expect(stdout).toContain('--force');
        expect(stdout).toContain('--upload');
    });
});

// ffmpeg + network required. CI installs ffmpeg AFTER `npm test`, so this is
// skipped there and exercised locally / by the acceptance reviewer.
const integration = hasFfmpeg() ? describe : describe.skip;
integration('generate-thumbnails.mjs --force integration', () => {
    it('writes <scratch>/<slug>.jpg for all five slugs and nothing into the repo', async () => {
        const scratch = mkdtempSync(path.join(os.tmpdir(), 'uff-posters-test-'));
        const lqipPath = path.join(scratch, 'poster-lqips.js');
        try {
            const { code, stdout } = await runCli(['--force'], {
                POSTER_OUT_DIR: scratch,
                POSTER_LQIP_PATH: lqipPath,
            });
            expect(code).toBe(0);
            for (const slug of INTRO_SLUGS) {
                expect(stdout).toContain(slug);
                expect(existsSync(path.join(scratch, `${slug}.jpg`))).toBe(true);
                // Nothing leaks into the repo root or public/.
                expect(existsSync(path.join(ROOT, `${slug}.jpg`))).toBe(false);
                expect(existsSync(path.join(ROOT, 'public', `${slug}.jpg`))).toBe(false);
            }
            // LQIP module written to the scratch seam, not the repo.
            expect(existsSync(lqipPath)).toBe(true);
        } finally {
            rmSync(scratch, { recursive: true, force: true });
        }
    }, 300000);
});

describe('no committed poster images', () => {
    it('public/assets/posters does not exist', () => {
        expect(existsSync(path.join(ROOT, 'public/assets/posters'))).toBe(false);
    });

    it('git tracks no jpg/jpeg/mp4 under public/', () => {
        const out = execFileSync('git', ['ls-files', 'public'], { cwd: ROOT, encoding: 'utf8' });
        const media = out.split('\n').filter((f) => /\.(jpg|jpeg|mp4)$/i.test(f));
        expect(media).toEqual([]);
    });
});
