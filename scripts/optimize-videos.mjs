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

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigs } from './lib/poster-utils.js';
import {
    ensureFfmpeg,
    flagValue,
    resolveDirOutsideRepo,
    run,
    uploadObjectToR2,
    wranglerMajor,
} from './lib/cli-utils.js';
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
    MAX_VIDEO_WIDTH,
    MAX_TOTAL_BITRATE_BPS,
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
    // Lesson clips are small after optimization; buffering the (possibly large)
    // source keeps the implementation simple. Switch to a stream pipe if a
    // single source ever becomes big enough to spike memory.
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

function reasonFor(action, probe) {
    if (action === 'reencode') {
        const bits = [];
        if (probe.width != null && probe.width > MAX_VIDEO_WIDTH) bits.push(`width ${probe.width}`);
        if (probe.totalBitrateBps != null && probe.totalBitrateBps > MAX_TOTAL_BITRATE_BPS) {
            bits.push(`bitrate ${probe.totalBitrateBps}`);
        }
        return bits.length ? bits.join(', ') : 'over budget';
    }
    if (action === 'remux') return probe.faststart === true ? 'forced' : 'not faststart';
    return 'already optimized';
}

function parseTargets(args) {
    const slugsValue = flagValue(args, '--slug');
    if (slugsValue !== undefined) {
        const slugs = [...new Set(slugsValue.split(',').map((s) => s.trim()).filter(Boolean))];
        if (!slugs.length) throw new Error('--slug requires at least one slug');
        return slugs.map((slug) => ({ slug }));
    }
    return null; // caller falls back to config discovery
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
    const videoDir = flagValue(args, '--video-dir');

    const outDir = resolveDirOutsideRepo(ROOT, {
        envValue: process.env.VIDEO_OUT_DIR,
        defaultDir: path.join(os.tmpdir(), 'uff-videos'),
        label: 'VIDEO_OUT_DIR',
    });
    const cacheDir = resolveDirOutsideRepo(ROOT, {
        envValue: process.env.VIDEO_CACHE_DIR,
        defaultDir: path.join(os.tmpdir(), 'uff-videos-cache'),
        label: 'VIDEO_CACHE_DIR',
    });
    await ensureFfmpeg();

    let targets = parseTargets(args);
    if (!targets) {
        const configs = await loadConfigs(CONFIG_DIR, {
            onParseError: (file, e) => console.error(`ERROR parsing src/config/${file}: ${e.message}`),
        });
        targets = collectVideoTargets(configs);
    }

    if (!dryRun) await fs.mkdir(outDir, { recursive: true });

    const remoteArg = upload && (await wranglerMajor()) >= 4 ? '--remote' : null;
    const counts = { optimized: 0, skipped: 0, missing: 0, failed: 0, uploaded: 0 };

    for (const { slug } of targets) {
        let src;
        try {
            src = await resolveSource(slug, videoDir, cacheDir);
        } catch (e) {
            console.log(`MISS ${slug}: ${e.message}`);
            counts.missing++;
            continue;
        }

        let probe;
        try {
            const head = await readHead(src);
            const faststart = isFaststart(head);
            const { width, totalBitrateBps } = await probeFile(src);
            probe = { slug, faststart, width, totalBitrateBps };
        } catch (e) {
            console.log(`FAIL ${slug}: probe failed (${e.message})`);
            counts.failed++;
            continue;
        }

        const [{ action }] = planVideoOptimize({ probes: [probe], force });
        if (action === 'skip') {
            console.log(`SKIP ${slug} already optimized`);
            counts.skipped++;
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
            console.error(`FAIL ${slug}: ffmpeg ${action} failed:`, e.message);
            counts.failed++;
            continue;
        }
        counts.optimized++;
        if (upload) {
            try {
                await uploadObjectToR2({
                    r2Key: `uff/${videoR2Key(slug)}`,
                    file: out,
                    contentType: 'video/mp4',
                    remoteArg,
                });
                console.log(`UPLOAD ${videoR2Key(slug)}`);
                counts.uploaded++;
            } catch (e) {
                console.error(`FAIL ${slug}: upload failed:`, e.message);
                counts.failed++;
            }
        }
    }

    console.log(
        `Done: ${counts.optimized} optimized, ${counts.skipped} skipped, ` +
        `${counts.missing} missing, ${counts.failed} failed` +
        (upload ? `, ${counts.uploaded} uploaded` : '') +
        (dryRun ? ' (dry run)' : '')
    );
}

main().catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
});
