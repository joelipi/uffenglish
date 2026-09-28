#!/usr/bin/env node
// Generates slug-keyed posters (640w jpg + LQIP) from each course's first-step
// introBackgroundVideoUrl mp4 at 0.2s. Posters are written to an OS temp work
// dir — never into the repo — and pushed to R2 as assets/videos/<slug>.jpg,
// the sibling of assets/videos/<slug>.mp4. Source videos are downloaded from
// R2 (the authoring CDN) into a temp cache, so no local video files are needed.
//
// Usage:
//   node scripts/generate-thumbnails.mjs                # generate targets absent OR stale on R2
//   node scripts/generate-thumbnails.mjs --force        # re-render every intro slug
//   node scripts/generate-thumbnails.mjs --upload       # upload work-dir posters to R2
//   node scripts/generate-thumbnails.mjs --video-dir=X  # prefer local mp4s over R2 download
//
// Requires ffmpeg on PATH for generation. --upload uses wrangler r2 object put
// (needs authenticated wrangler or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID env).
//
// New-video flow: upload the intro mp4 to R2 assets/videos/<slug>.mp4 and add a
// lesson referencing it in any src/config/*.json. Then either run this script
// (generate + --upload) or just push — deploy.yml runs generate/upload/verify
// automatically before build. No poster is ever committed.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    FRAME_AT_SECONDS,
    POSTER_WIDTH,
    POSTER_QUALITY,
    POSTER_MAX_BYTES,
    LQIP_WIDTH,
    exceedsPosterBudget,
    introTargets,
    isPosterStale,
    loadConfigs,
    planPosterRun,
    posterFilename,
    posterR2Key,
    posterSourceUrl,
    formatLqipModule,
} from './lib/poster-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(ROOT, 'src/config');
// POSTER_LQIP_PATH is a test seam (like POSTER_OUT_DIR) so a scratch run does
// not rewrite the committed module; production always uses the default.
const GENERATED_PATH = process.env.POSTER_LQIP_PATH
    ? path.resolve(process.env.POSTER_LQIP_PATH)
    : path.join(ROOT, 'src/generated/poster-lqips.js');
// POSTER_CDN_BASE is a test seam; production always uses the R2 CDN.
const CDN_POSTER_BASE =
    process.env.POSTER_CDN_BASE || 'https://r2.ultrafastfluency.com/assets/videos/';

const HELP = `Generate slug-keyed posters for every course's first-step intro video.

Usage:
  node scripts/generate-thumbnails.mjs [--force] [--upload] [--video-dir=DIR]

Flags:
  --force          Ignore R2 existence/freshness; re-render every intro slug
  --upload         Upload the work-dir posters to R2 (uff/assets/videos/<slug>.jpg)
  --video-dir=DIR  Prefer <DIR>/<slug>.mp4 over downloading from R2
  --help, -h       Show this help

Without --force, a slug is (re)generated when its poster is absent from R2 OR
when its source .mp4 has a newer Last-Modified than the published .jpg.

Posters are written to os.tmpdir()/uff-posters (override POSTER_OUT_DIR) and
never into the repo. Requires ffmpeg on PATH; --upload needs Cloudflare creds.`;

function run(bin, args) {
    return new Promise((resolve, reject) => {
        execFile(bin, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) { err.stderr = stderr; return reject(err); }
            resolve(stdout);
        });
    });
}

// Work dir for generated posters. Never inside the repo: the app always fetches
// posters from R2 (in dev via the existing /assets/videos/ Vite proxy), so a
// local copy has no purpose.
function resolveOutDir() {
    const outDir = process.env.POSTER_OUT_DIR
        ? path.resolve(process.env.POSTER_OUT_DIR)
        : path.join(os.tmpdir(), 'uff-posters');
    const rel = path.relative(ROOT, outDir);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
        throw new Error(`POSTER_OUT_DIR must be outside the repo root (got ${outDir})`);
    }
    return outDir;
}

async function ensureFfmpeg() {
    try {
        await run('ffmpeg', ['-version']);
        await run('ffprobe', ['-version']);
    } catch {
        console.error('ERROR: ffmpeg and ffprobe are required on PATH.\n  Install:  sudo apt-get install -y ffmpeg   (macOS: brew install ffmpeg)');
        process.exit(1);
    }
}

// Poster and source-video URLs under the (overridable) R2 CDN base. The poster
// HEAD and the staleness HEAD share the same base, so a test can fake both.
function posterHeadUrl(slug) {
    return `${CDN_POSTER_BASE}${posterFilename(slug)}`;
}

function videoHeadUrl(slug) {
    return `${CDN_POSTER_BASE}${slug}.mp4`;
}

// HEAD an R2 object once per run. Returns `{ ok, lastModified }`; a network
// error is a miss (`ok: false`), matching the old existence check. The cache is
// what lets the existence check and the staleness check share one poster HEAD.
const headCache = new Map();
async function headObject(url) {
    if (!headCache.has(url)) {
        headCache.set(url, (async () => {
            try {
                const res = await fetch(url, { method: 'HEAD' });
                return { ok: res.ok, lastModified: res.headers.get('last-modified') };
            } catch {
                return { ok: false, lastModified: null };
            }
        })());
    }
    return headCache.get(url);
}

// R2 HEAD existence check — the source of truth for "poster already published".
async function r2PosterExists(slug) {
    const { ok } = await headObject(posterHeadUrl(slug));
    return ok;
}

// A published poster is stale when its source .mp4 was modified after it. Only
// consulted for slugs whose poster already exists (see planPosterRun), so this
// logs `STALE <slug>` during planning, before the GEN line it triggers.
async function r2PosterStale(slug) {
    const [{ lastModified: videoLastModified }, { lastModified: posterLastModified }] =
        await Promise.all([headObject(videoHeadUrl(slug)), headObject(posterHeadUrl(slug))]);
    const stale = isPosterStale({ videoLastModified, posterLastModified });
    if (stale) {
        console.log(`STALE ${slug}: ${slug}.mp4 is newer than ${posterFilename(slug)}`);
    }
    return stale;
}

async function resolveSource(slug, videoDir) {
    // 1) Explicit --video-dir
    if (videoDir) {
        const local = path.join(videoDir, `${slug}.mp4`);
        try { await fs.stat(local); return local; } catch {}
    }
    // 2) Repo-local (gitignored) mp4, if present
    const repoLocal = path.join(ROOT, 'public/assets/videos', `${slug}.mp4`);
    try { await fs.stat(repoLocal); return repoLocal; } catch {}

    // 3) Download from R2 (source of truth)
    const cacheDir = path.join(os.tmpdir(), 'uff-posters-cache');
    await fs.mkdir(cacheDir, { recursive: true });
    const cached = path.join(cacheDir, `${slug}.mp4`);
    try {
        await fs.stat(cached);
        console.log(`CACHE hit ${slug}.mp4`);
        return cached;
    } catch {}

    const url = posterSourceUrl(slug);
    console.log(`DOWNLOAD ${slug}.mp4 from R2…`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed HTTP ${res.status} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(cached, buf);
    return cached;
}

async function generateOne(slug, videoDir, outDir) {
    const src = await resolveSource(slug, videoDir);
    const outJpg = path.join(outDir, posterFilename(slug));
    console.log(`GEN ${slug}: ${slug}.mp4 @${FRAME_AT_SECONDS}s -> ${posterFilename(slug)}`);
    await run('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-ss', String(FRAME_AT_SECONDS),
        '-i', src,
        '-vframes', '1',
        '-vf', `scale=${POSTER_WIDTH}:-2`,
        '-q:v', String(POSTER_QUALITY),
        outJpg,
    ]);
    const { size } = await fs.stat(outJpg);
    if (exceedsPosterBudget(size)) {
        console.warn(`WARN ${posterFilename(slug)} is ${size} bytes (> ${POSTER_MAX_BYTES} budget)`);
    }
    return outJpg;
}

// LQIP for one slug: downscale the work-dir poster, or the published R2 poster
// when it was skipped (already present) this run.
async function lqipFor(slug, outDir) {
    let posterPath = path.join(outDir, posterFilename(slug));
    try {
        await fs.stat(posterPath);
    } catch {
        const url = `${CDN_POSTER_BASE}${posterFilename(slug)}`;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            posterPath = path.join(outDir, posterFilename(slug));
            await fs.writeFile(posterPath, Buffer.from(await res.arrayBuffer()));
        } catch (e) {
            console.warn(`WARN: no poster available for LQIP ${slug} (${e.message})`);
            return null;
        }
    }
    const lqipPath = path.join(outDir, `${slug}.lqip.jpg`);
    await run('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-i', posterPath,
        '-vframes', '1',
        '-vf', `scale=${LQIP_WIDTH}:-2`,
        '-q:v', '15',
        lqipPath,
    ]);
    const b64 = (await fs.readFile(lqipPath)).toString('base64');
    await fs.unlink(lqipPath).catch(() => {});
    return `data:image/jpeg;base64,${b64}`;
}

async function writeGenerated(lqips) {
    await fs.mkdir(path.dirname(GENERATED_PATH), { recursive: true });
    await fs.writeFile(GENERATED_PATH, formatLqipModule(lqips), 'utf8');
    console.log(`Wrote ${GENERATED_PATH} (${Object.keys(lqips).length} entries)`);
}

async function wranglerMajor() {
    try {
        const out = await run('npx', ['wrangler', '--version']);
        const m = /(?:wrangler\s+)?(\d+)\./.exec(out);
        return m ? parseInt(m[1], 10) : 0;
    } catch {
        return 0;
    }
}

async function uploadAll(targets, outDir) {
    if (!process.env.CLOUDFLARE_API_TOKEN) {
        console.warn('WARN: CLOUDFLARE_API_TOKEN not set — upload will likely fail (run `wrangler login` or export the token).');
    }
    // wrangler >=4 targets the LOCAL R2 emulator by default and needs --remote;
    // wrangler 3.x is remote-only and rejects the --remote flag.
    const major = await wranglerMajor();
    const remoteArg = major >= 4 ? '--remote' : null;
    console.log(`Uploading ${targets.length} poster(s) to R2 (wrangler ${major || '?'})…`);
    let failed = 0;
    for (const { slug } of targets) {
        const file = path.join(outDir, posterFilename(slug));
        try { await fs.stat(file); } catch {
            console.warn(`SKIP upload ${slug}: ${posterFilename(slug)} not in work dir (already on R2?)`);
            continue;
        }
        try {
            const args = ['wrangler', 'r2', 'object', 'put'];
            if (remoteArg) args.push(remoteArg);
            args.push(`uff/${posterR2Key(slug)}`, '--file', file, '--content-type', 'image/jpeg');
            await run('npx', args);
            console.log(`UPLOAD ${posterR2Key(slug)}`);
        } catch (e) {
            console.error(`UPLOAD FAIL ${slug}:`, e.message);
            failed++;
        }
    }
    // Non-fatal: a poster-upload failure must NOT block the app deploy. The app
    // degrades gracefully (LQIP -> video frame reveal) when a poster is missing
    // on R2, and verify-thumbnails reports R2 state.
    if (failed) {
        console.warn(`--upload: ${failed}/${targets.length} poster uploads failed. ` +
            'The app still works (LQIP/gradient fallback). Check the R2 permission on your ' +
            'CLOUDFLARE_API_TOKEN (needs Account > Workers R2 Storage > Edit).');
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log(HELP);
        return;
    }
    const force = args.includes('--force');
    const upload = args.includes('--upload');
    const videoDirArg = args.find((a) => a.startsWith('--video-dir'));
    const videoDir = videoDirArg ? videoDirArg.split('=')[1] : undefined;

    const outDir = resolveOutDir();
    const configs = await loadConfigs(CONFIG_DIR, {
        onParseError: (file, e) => console.error(`ERROR parsing src/config/${file}: ${e.message}`),
    });
    const allTargets = introTargets(configs);

    if (upload) {
        await uploadAll(allTargets, outDir);
        return;
    }

    await ensureFfmpeg();
    await fs.mkdir(outDir, { recursive: true });

    let moduleText = null;
    try { moduleText = await fs.readFile(GENERATED_PATH, 'utf8'); } catch {}
    const plan = await planPosterRun({
        configs,
        // --force targets every slug, so `posterExists` is always false and
        // staleness is never consulted.
        posterExists: force ? () => false : r2PosterExists,
        posterStale: force ? () => false : r2PosterStale,
        moduleText,
    });

    let failed = 0;
    for (const { slug } of plan.targets) {
        try {
            await generateOne(slug, videoDir, outDir);
        } catch (e) {
            console.error(`ERROR ${slug}:`, e.message, '\n  Ensure the video is uploaded to R2 as assets/videos/<slug>.mp4');
            failed++;
        }
    }

    if (plan.rebuild) {
        const lqips = {};
        let lqipMissing = 0;
        for (const { slug } of allTargets) {
            try {
                const dataUri = await lqipFor(slug, outDir);
                if (dataUri) lqips[slug] = dataUri;
                else lqipMissing++;
            } catch (e) {
                console.error(`ERROR LQIP ${slug}:`, e.message);
                lqipMissing++;
            }
        }
        // Never rewrite the committed module with a partial map: a transient R2
        // failure would otherwise drop entries while the process still exits 0.
        if (lqipMissing) {
            failed += lqipMissing;
            console.error(`ERROR: ${lqipMissing} LQIP(s) unavailable — leaving ${GENERATED_PATH} unchanged. Re-run with R2 access (or --force).`);
        } else {
            await writeGenerated(lqips);
        }
    } else {
        console.log('Posters up to date; LQIP module unchanged.');
    }

    console.log('\nPosters ready in work dir. Publish to R2 with: node scripts/generate-thumbnails.mjs --upload');
    if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
