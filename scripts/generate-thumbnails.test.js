// scripts/generate-thumbnails.test.js
// CLI wiring and behaviour for the slug-keyed, R2-only poster generator
// (stories/011-auto-intro-poster, Task 2).
import { describe, it, expect } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
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
const ALL_INTRO_SLUGS = [...INTRO_SLUGS, 'testvideointro'];

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

// Serve a fake R2 so the default (non --force) existence check is deterministic.
function withFakeR2(status, fn) {
    return new Promise((resolve, reject) => {
        const server = createServer((_req, res) => {
            res.writeHead(status, { 'content-type': 'image/jpeg' });
            res.end(status === 200 ? 'jpeg' : '');
        });
        server.listen(0, '127.0.0.1', async () => {
            const base = `http://127.0.0.1:${server.address().port}/assets/videos/`;
            try {
                resolve(await fn(base));
            } catch (e) {
                reject(e);
            } finally {
                server.close();
            }
        });
    });
}

// Fake R2 that serves a valid JPEG for every poster with per-slug Last-Modified
// headers, so one slug is provably stale (video newer than poster) and the rest
// are fresh. Records every request so the HEAD cache can be asserted.
function withFreshnessR2(staleSlug, jpegBody, fn) {
    return new Promise((resolve, reject) => {
        const seen = [];
        const server = createServer((req, res) => {
            seen.push(`${req.method} ${req.url}`);
            const pathname = req.url.split('?')[0];
            const isVideo = pathname.endsWith('.mp4');
            const slug = pathname.split('/').pop().replace(/\.(mp4|jpg)$/, '');
            const stale = slug === staleSlug;
            const lastModified = isVideo
                ? (stale ? 'Mon, 28 Sep 2026 02:27:08 GMT' : 'Sat, 20 Sep 2026 00:00:00 GMT')
                : (stale ? 'Sun, 27 Sep 2026 22:11:43 GMT' : 'Mon, 21 Sep 2026 00:00:00 GMT');
            res.writeHead(200, {
                'content-type': isVideo ? 'video/mp4' : 'image/jpeg',
                'last-modified': lastModified,
            });
            if (req.method === 'HEAD') { res.end(); return; }
            res.end(jpegBody);
        });
        server.listen(0, '127.0.0.1', async () => {
            const base = `http://127.0.0.1:${server.address().port}/assets/videos/`;
            try {
                resolve(await fn(base, seen));
            } catch (e) {
                reject(e);
            } finally {
                server.close();
            }
        });
    });
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
        // The wrangler `r2 object put` invocation is shared (scripts/lib/cli-utils.js)
        // so the poster and video uploaders cannot drift; the sibling key is what
        // this script owns.
        expect(SOURCE).toContain('uploadObjectToR2');
    });

    it('derives freshness from the .mp4 and .jpg Last-Modified headers', () => {
        expect(SOURCE).toContain('headObject');
        expect(SOURCE).toMatch(/last-modified/i);
        expect(SOURCE).toContain('isPosterStale');
        expect(SOURCE).toContain('r2PosterStale');
        // Both HEADs go through the overridable CDN base, and the video HEAD
        // reuses the canonical source URL rather than a second path definition.
        expect(SOURCE).toContain('CDN_POSTER_BASE');
        expect(SOURCE).toContain('posterSourceUrl(slug, CDN_POSTER_BASE)');
    });

    it('passes the staleness predicate into planPosterRun', () => {
        expect(SOURCE).toContain('posterStale: r2PosterStale');
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

// ffmpeg + network required. CI no longer installs ffmpeg (the Modal render owns
// posters), so this suite skips when ffmpeg is genuinely unavailable.
const integration = hasFfmpeg() ? describe : describe.skip;
integration('generate-thumbnails.mjs integration (ffmpeg + R2)', () => {
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

    it('missing-only mode (no --force) targets slugs absent on R2 via the async HEAD', async () => {
        const scratch = mkdtempSync(path.join(os.tmpdir(), 'uff-posters-test-'));
        const lqipPath = path.join(scratch, 'poster-lqips.js');
        try {
            // Fake R2 has no posters: every intro slug must be targeted.
            await withFakeR2(404, async (base) => {
                const { code } = await runCli([], {
                    POSTER_OUT_DIR: scratch,
                    POSTER_LQIP_PATH: lqipPath,
                    POSTER_CDN_BASE: base,
                });
                expect(code).toBe(0);
                for (const slug of INTRO_SLUGS) {
                    expect(existsSync(path.join(scratch, `${slug}.jpg`))).toBe(true);
                }
                expect(existsSync(lqipPath)).toBe(true);
            });
        } finally {
            rmSync(scratch, { recursive: true, force: true });
        }
    }, 300000);

    it('regenerates only the stale poster and rewrites the LQIP module (fake R2 + local video)', async () => {
        const staleSlug = 'testvideo01';
        const work = mkdtempSync(path.join(os.tmpdir(), 'uff-stale-test-'));
        const videoDir = path.join(work, 'videos');
        const outDir = path.join(work, 'posters');
        mkdirSync(videoDir, { recursive: true });
        mkdirSync(outDir, { recursive: true });
        const freshJpeg = path.join(work, 'poster.jpg');
        const lqipPath = path.join(work, 'poster-lqips.js');
        try {
            execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
                '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=1',
                '-pix_fmt', 'yuv420p', path.join(videoDir, `${staleSlug}.mp4`)]);
            execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
                '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1',
                '-vframes', '1', freshJpeg]);
            const jpegBody = readFileSync(freshJpeg);

            await withFreshnessR2(staleSlug, jpegBody, async (base, seen) => {
                const { code, stdout } = await runCli([`--video-dir=${videoDir}`], {
                    POSTER_OUT_DIR: outDir,
                    POSTER_LQIP_PATH: lqipPath,
                    POSTER_CDN_BASE: base,
                });
                expect(code).toBe(0);
                // Only the stale slug is regenerated. stdout is the reliable
                // signal: the LQIP step downloads every other poster into the
                // work dir too, so file presence alone would be misleading.
                expect(stdout).toContain(`STALE ${staleSlug}`);
                expect(stdout).toContain(`GEN ${staleSlug}`);
                for (const slug of ALL_INTRO_SLUGS.filter((s) => s !== staleSlug)) {
                    expect(stdout).not.toContain(`GEN ${slug}`);
                }
                expect(existsSync(path.join(outDir, `${staleSlug}.jpg`))).toBe(true);
                expect(existsSync(lqipPath)).toBe(true);
                // The HEAD cache means no method+path is requested twice.
                expect(new Set(seen).size).toBe(seen.length);
            });
        } finally {
            rmSync(work, { recursive: true, force: true });
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
