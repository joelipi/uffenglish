#!/usr/bin/env node
// Web-optimizes lesson videos on R2: remuxes each referenced mp4 to +faststart
// and re-encodes it only when it exceeds the width/bitrate budget. Source mp4s
// are downloaded from R2 (the authoring CDN) into a temp cache; optimized files
// are written to an OS temp work dir — never into the repo — and pushed back to
// R2 as assets/videos/<slug>.mp4 with --upload.
//
// This is a MANUAL remediation tool. It is deliberately NOT wired into CI: a
// re-encode is lossy and CPU-heavy, so an operator runs it. See
// stories/032-optimize-r2-videos for the rationale.
//
// Usage:
//   node scripts/optimize-videos.mjs                      # optimize all config-referenced clips
//   node scripts/optimize-videos.mjs --slug=testvideointro [--slug=a,b]
//   node scripts/optimize-videos.mjs --force              # remux even faststart clips
//   node scripts/optimize-videos.mjs --dry-run            # plan only, write nothing
//   node scripts/optimize-videos.mjs --upload             # push optimized files to R2
//   node scripts/optimize-videos.mjs --video-dir=DIR      # prefer local <slug>.mp4
//
// Requires ffmpeg + ffprobe on PATH. --upload uses `wrangler r2 object put`
// (needs authenticated wrangler or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID).
//
// Env seams: VIDEO_CDN_BASE, VIDEO_OUT_DIR, VIDEO_CACHE_DIR.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigs } from './lib/poster-utils.js';
import {
    collectVideoTargets,
    planVideoOptimize,
    isFaststart,
    remuxArgs,
    reencodeArgs,
    videoFilename,
    videoR2Key,
    videoSourceUrl,
    FASTSTART_HEAD_BYTES,
    DEFAULT_CDN_BASE,
} from './lib/video-optimize-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(ROOT, 'src/config');
const CDN_BASE = process.env.VIDEO_CDN_BASE || DEFAULT_CDN_BASE;

const HELP = `Web-optimize lesson videos on R2 (faststart + width/bitrate budget).

Usage:
  node scripts/optimize-videos.mjs [options]

Options:
  --slug=<a,b>       Only these slugs (skips config discovery)
  --video-dir=DIR    Prefer <DIR>/<slug>.mp4 over downloading from R2
  --force            Remux even videos that are already +faststart
  --dry-run          Probe + plan only; write nothing, never upload
  --upload           Upload optimized files to R2 (uff/assets/videos/<slug>.mp4)
  --help, -h         Show this help

Without --slug, every distinct video slug in src/config/*.json is targeted.
Optimized files land in os.tmpdir()/uff-videos (override VIDEO_OUT_DIR).
Requires ffmpeg + ffprobe; --upload needs Cloudflare creds.`;

function run(bin, args) {
    return new Promise((resolve, reject) => {
        execFile(bin, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) { err.stderr = stderr; return reject(err); }
            resolve(stdout);
        });
    });
}

// Work dir for optimized files. Never inside the repo: nothing here is committed.
function resolveOutDir() {
    const outDir = process.env.VIDEO_OUT_DIR
        ? path.resolve(process.env.VIDEO_OUT_DIR)
        : path.join(os.tmpdir(), 'uff-videos');
    const rel = path.relative(ROOT, outDir);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
        throw new Error(`VIDEO_OUT_DIR must be outside the repo root (got ${outDir})`);
    }
    return outDir;
}

function resolveCacheDir() {
    return process.env.VIDEO_CACHE_DIR
        ? path.resolve(process.env.VIDEO_CACHE_DIR)
        : path.join(os.tmpdir(), 'uff-videos-cache');
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

async function readHead(file) {
    const fh = await fs.open(file, 'r');
    try {
        const buf = Buffer.alloc(FASTSTART_HEAD_BYTES);
        const { bytesRead } = await fh.read(buf, 0, FASTSTART_HEAD_BYTES, 0);
        return buf.subarray(0, bytesRead);
    } finally {
        await fh.close();
    }
}

async function probeFile(file) {
    const out = await run('ffprobe', [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        file,
    ]);
    const data = JSON.parse(out);
    const rawBitrate = data?.format?.bit_rate;
    const totalBitrateBps = rawBitrate != null && Number.isFinite(Number(rawBitrate)) ? Number(rawBitrate) : null;
    const video = (data?.streams || []).find((s) => s.codec_type === 'video');
    const width = video?.width != null && Number.isFinite(Number(video.width)) ? Number(video.width) : null;
    return { width, totalBitrateBps };
}

async function download(url, dest) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed HTTP ${res.status} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(dest, buf);
    return dest;
}

async function resolveSource(slug, videoDir, cacheDir) {
    const filename = videoFilename(slug);
    if (videoDir) {
        const local = path.join(videoDir, filename);
        try { await fs.stat(local); console.log(`COPY ${slug} from ${videoDir}`); return local; } catch {}
    }
    const repoLocal = path.join(ROOT, 'public/assets/videos', filename);
    try { await fs.stat(repoLocal); console.log(`COPY ${slug} from public/assets/videos`); return repoLocal; } catch {}

    await fs.mkdir(cacheDir, { recursive: true });
    const cached = path.join(cacheDir, filename);
    try {
        await fs.stat(cached);
        console.log(`CACHE hit ${slug}.mp4`);
        return cached;
    } catch {}

    const url = videoSourceUrl(slug, CDN_BASE);
    console.log(`DOWNLOAD ${slug}.mp4 from R2…`);
    return download(url, cached);
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

async function uploadOne(slug, outDir, remoteArg) {
    const file = path.join(outDir, videoFilename(slug));
    try { await fs.stat(file); } catch {
        console.warn(`SKIP upload ${slug}: ${videoFilename(slug)} not in work dir`);
        return false;
    }
    const args = ['wrangler', 'r2', 'object', 'put'];
    if (remoteArg) args.push(remoteArg);
    args.push(`uff/${videoR2Key(slug)}`, '--file', file, '--content-type', 'video/mp4');
    try {
        await run('npx', args);
        console.log(`UPLOAD ${videoR2Key(slug)}`);
        return true;
    } catch (e) {
        console.error(`UPLOAD FAIL ${slug}:`, e.message);
        return false;
    }
}

function reasonFor(action, probe) {
    if (action === 'reencode') {
        const bits = [];
        if (probe.width != null && probe.width > 720) bits.push(`width ${probe.width}`);
        if (probe.totalBitrateBps != null && probe.totalBitrateBps > 1_500_000) bits.push(`bitrate ${probe.totalBitrateBps}`);
        return bits.length ? bits.join(', ') : 'over budget';
    }
    if (action === 'remux') return 'not faststart';
    return 'already optimized';
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log(HELP);
        return;
    }
    const upload = args.includes('--upload');
    const force = args.includes('--force');
    const dryRun = args.includes('--dry-run');
    const slugsArg = args.find((a) => a.startsWith('--slug'));
    const videoDirArg = args.find((a) => a.startsWith('--video-dir'));
    const videoDir = videoDirArg ? videoDirArg.split('=')[1] : undefined;

    const outDir = resolveOutDir();
    const cacheDir = resolveCacheDir();
    await ensureFfmpeg();

    let targets;
    if (slugsArg) {
        const slugs = slugsArg.split('=')[1] ? slugsArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
        targets = [...new Set(slugs)].map((slug) => ({ slug }));
    } else {
        const configs = await loadConfigs(CONFIG_DIR, {
            onParseError: (file, e) => console.error(`ERROR parsing src/config/${file}: ${e.message}`),
        });
        targets = collectVideoTargets(configs);
    }

    if (!dryRun) await fs.mkdir(outDir, { recursive: true });

    const remoteArg = upload ? ((await wranglerMajor()) >= 4 ? '--remote' : null) : null;
    let optimized = 0;
    let skipped = 0;
    let missing = 0;
    let uploaded = 0;

    for (const { slug } of targets) {
        let src;
        try {
            src = await resolveSource(slug, videoDir, cacheDir);
        } catch (e) {
            console.log(`MISS ${slug}: ${e.message}`);
            missing++;
            continue;
        }

        let probe;
        try {
            const head = await readHead(src);
            const faststart = isFaststart(head);
            const { width, totalBitrateBps } = await probeFile(src);
            probe = { slug, faststart, width, totalBitrateBps };
        } catch (e) {
            console.log(`MISS ${slug}: probe failed (${e.message})`);
            missing++;
            continue;
        }

        const [{ action }] = planVideoOptimize({ probes: [probe], force });
        if (action === 'skip') {
            console.log(`SKIP ${slug} already optimized`);
            skipped++;
            continue;
        }
        console.log(`OPT ${slug} ${action} (${reasonFor(action, probe)})`);
        if (dryRun) continue;

        const out = path.join(outDir, videoFilename(slug));
        try {
            const ffmpegArgs = action === 'remux'
                ? remuxArgs({ src, out })
                : reencodeArgs({ src, out });
            await run('ffmpeg', ffmpegArgs);
        } catch (e) {
            console.error(`OPT FAIL ${slug}:`, e.message);
            missing++;
            continue;
        }
        optimized++;
        if (upload) {
            if (await uploadOne(slug, outDir, remoteArg)) uploaded++;
        }
    }

    console.log(
        `Done: ${optimized} optimized, ${skipped} skipped, ${missing} missing` +
        (upload ? `, ${uploaded} uploaded` : '') +
        (dryRun ? ' (dry run)' : '')
    );
}

main().catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
});
