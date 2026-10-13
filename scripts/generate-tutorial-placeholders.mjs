#!/usr/bin/env node
// Generates the five per-step-type tutorial placeholder videos: a portrait
// 720×1280 clip per step type that simply shows the tutorial script on screen
// (white wrapped text on the app's #1a3a5a card colour), with no audio track.
// They stand in until the narrated videos are recorded.
//
// Encoding runs in real Chrome (Playwright, `channel: 'chrome'`): Node has no
// VideoEncoder (`typeof VideoEncoder === 'undefined'`) and ffmpeg is not
// installed here, while Chromium ships H.264/AAC for MediaRecorder. The
// repo's bundled Chromium lacks H.264, so `channel: 'chrome'` is required —
// run `npx playwright install chrome` first.
//
// Videos are written OUTSIDE the repo (public/assets/videos/*.mp4 is
// gitignored — lesson media is never committed), then uploaded to R2 by hand
// (this script prints the exact `wrangler r2 object put` commands).
//
// Usage:
//   node scripts/generate-tutorial-placeholders.mjs --help
//   node scripts/generate-tutorial-placeholders.mjs [--out=<dir>] [--duration=<sec> | --auto-duration]
//
// Default output dir: <os.tmpdir()>/uff-tutorial-placeholders
// Default duration : auto (each clip is 12-20 s, scaled by its script length
//                    inside the 10-30 s window the story specifies).

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { Input, BufferSource, ALL_FORMATS } from 'mediabunny';
import { flagValue, resolveDirOutsideRepo } from './lib/cli-utils.js';
import { TUTORIAL_STEP_TYPES, TUTORIAL_SCRIPTS, TUTORIAL_VIDEO_WIDTH, TUTORIAL_VIDEO_HEIGHT, getTutorialSlug } from '../src/modules/video/tutorial-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const R2_BUCKET = 'uff';
const MEDIA_RECORDER_MIME = 'video/mp4;codecs=avc1.42E01E';
const INK = '#ffffff';
const BACKGROUND = '#1a3a5a';
// Spoken-tutorial pace used to size each clip: ~2.5 words/second plus ~2 s of
// air, clamped into the story's 10-30 s window.
const SECONDS_PER_WORD = 0.4;
const MIN_SECONDS = 10;
const MAX_SECONDS = 30;
const PADDING_SECONDS = 2;

function wordCount(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
}

function autoDurationSec(script) {
    return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(wordCount(script) * SECONDS_PER_WORD) + PADDING_SECONDS));
}

function helpText(o) {
    const lines = [
        'Generate the per-step-type tutorial placeholder videos.',
        '',
        'Options:',
        '  --out=<dir>        staging directory (must be outside the repo)',
        '  --duration=<sec>   force every clip to this length (10-30)',
        '  --auto-duration    size each clip from its script length (default)',
        '  --help             this text, plus the R2 upload commands',
        '',
        `Requires real Chrome for H.264: npx playwright install chrome  (bundled Chromium fails).`,
        '',
        'After generating, upload each clip to R2:',
        ...TUTORIAL_STEP_TYPES.map((t) => `  npx wrangler r2 object put ${R2_BUCKET}/assets/videos/${getTutorialSlug(t)}.mp4 --file <out>/${getTutorialSlug(t)}.mp4 --content-type video/mp4`),
        '',
        `Default output directory: ${o}`,
    ];
    return lines.join('\n');
}

// A self-contained page: canvas + wrapped script text + MediaRecorder around
// canvas.captureStream(). Everything (layout, wrapping, recording) runs in the
// browser so the node process stays a driver.
function buildPage({ script, durationSec }) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;background:${BACKGROUND};height:100%}
        canvas{display:block}
    </style></head><body>
    <canvas id="c" width="${TUTORIAL_VIDEO_WIDTH}" height="${TUTORIAL_VIDEO_HEIGHT}"></canvas>
    <script>
        const script = ${JSON.stringify(script)};
        const canvas = document.getElementById('c');
        const ctx = canvas.getContext('2d');
        const INK = ${JSON.stringify(INK)};
        const BACKGROUND = ${JSON.stringify(BACKGROUND)};

        function wrap(text, maxWidth) {
            const words = text.split(/\\s+/);
            const lines = [];
            let line = '';
            for (const w of words) {
                const next = line ? line + ' ' + w : w;
                if (ctx.measureText(next).width > maxWidth && line) {
                    lines.push(line);
                    line = w;
                } else {
                    line = next;
                }
            }
            if (line) lines.push(line);
            return lines;
        }

        function draw() {
            ctx.fillStyle = BACKGROUND;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = INK;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '600 34px Inter, system-ui, sans-serif';
            const maxWidth = canvas.width - 96;
            const lines = wrap(script, maxWidth);
            const lineHeight = 46;
            const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
            lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, startY + i * lineHeight));
        }
        draw();

        window.recordScript = async (mimeType, durationSec) => {
            const stream = canvas.captureStream(10);
            const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_500_000 });
            const chunks = [];
            recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
            recorder.start();

            // Chrome emits canvas frames only when the canvas changes, so keep
            // repainting for the whole take — otherwise the muxer receives no
            // frames and writes an empty file.
            let frameId = 0;
            const paint = () => { draw(); frameId = requestAnimationFrame(paint); };
            paint();

            await new Promise((r) => setTimeout(r, durationSec * 1000));
            cancelAnimationFrame(frameId);

            const done = new Promise((r) => { recorder.onstop = r; });
            recorder.stop();
            await done;
            const blob = new Blob(chunks, { type: 'video/mp4' });
            const buffer = await blob.arrayBuffer();
            return Array.from(new Uint8Array(buffer));
        };
    </script></body></html>`;
}

// ISO-BMFF check: the `ftyp` box sits at byte offset 4 (see verifyMp4 in
// src/modules/video/transcode.web.js). Reads container metadata only, so it
// needs no WebCodecs and no decode pass.
async function probeMp4(file) {
    const bytes = new Uint8Array(await fs.readFile(file));
    if (bytes.length < 12) throw new Error('file too small to be an mp4');
    const isIsoBmff = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
    if (!isIsoBmff) throw new Error('not an ISO-BMFF mp4 (no ftyp box)');

    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
    try {
        const videoTrack = await input.getPrimaryVideoTrack();
        const audioTrack = await input.getPrimaryAudioTrack();
        if (!videoTrack) throw new Error('no video track');
        if (audioTrack) throw new Error('unexpected audio track');
        const width = await videoTrack.getCodedWidth();
        const height = await videoTrack.getCodedHeight();
        // Deliberately NOT the metadata-first path probeClipDurationSec uses:
        // Chrome MediaRecorder mp4s carry bogus container-header durations
        // (AGENTS.md documents 0.12 s on a 4 s clip), so the header value would
        // false-reject a good clip. The packet scan is the only honest read.
        // skipLiveWait keeps a live-flagged blob from blocking forever on an
        // already-ended stream (the documented transcode.web.js lesson).
        const duration = await videoTrack.computeDuration({ skipLiveWait: true });
        return { width, height, duration };
    } finally {
        input.dispose();
    }
}

/**
 * The clip contract every generated placeholder must satisfy: portrait
 * 720×1280 within the story's 10-30 s window. Pure (no IO) so it is unit
 * tested directly; `main()` also calls it on each real probe.
 */
export function assertClipContract({ slug, width, height, duration }) {
    if (width !== TUTORIAL_VIDEO_WIDTH || height !== TUTORIAL_VIDEO_HEIGHT) {
        throw new Error(`${slug}: expected ${TUTORIAL_VIDEO_WIDTH}x${TUTORIAL_VIDEO_HEIGHT}, got ${width}x${height}`);
    }
    if (!(duration >= MIN_SECONDS && duration <= MAX_SECONDS)) {
        throw new Error(`${slug}: duration ${duration}s outside the ${MIN_SECONDS}-${MAX_SECONDS}s window`);
    }
    return true;
}

async function renderOne({ browser, stepType, durationSec }) {
    const slug = getTutorialSlug(stepType);
    const script = TUTORIAL_SCRIPTS[stepType].en;

    const page = await browser.newPage({ viewport: { width: TUTORIAL_VIDEO_WIDTH, height: TUTORIAL_VIDEO_HEIGHT } });
    try {
        await page.setContent(buildPage({ script }), { waitUntil: 'load' });
        const frames = await page.evaluate(
            async ([mime, secs]) => window.recordScript(mime, secs),
            [MEDIA_RECORDER_MIME, durationSec]
        );
        return { slug, bytes: Buffer.from(frames) };
    } finally {
        await page.close();
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
        console.log(helpText(path.join(os.tmpdir(), 'uff-tutorial-placeholders')));
        return;
    }

    const outFlag = flagValue(args, '--out');
    const durationFlag = flagValue(args, '--duration');
    let forcedDuration = null;
    if (durationFlag !== undefined) {
        forcedDuration = Number(durationFlag);
        if (!Number.isFinite(forcedDuration) || forcedDuration < MIN_SECONDS || forcedDuration > MAX_SECONDS) {
            throw new Error(`--duration must be ${MIN_SECONDS}-${MAX_SECONDS} seconds`);
        }
    }

    const outDir = resolveDirOutsideRepo(ROOT, {
        envValue: outFlag,
        defaultDir: path.join(os.tmpdir(), 'uff-tutorial-placeholders'),
        label: '--out',
    });
    await fs.mkdir(outDir, { recursive: true });

    console.log(`[tutorial] writing ${TUTORIAL_STEP_TYPES.length} portrait ${TUTORIAL_VIDEO_WIDTH}x${TUTORIAL_VIDEO_HEIGHT} placeholders to ${outDir}`);

    // `channel: 'chrome'` is mandatory: Playwright's bundled Chromium has no
    // H.264, so MediaRecorder would produce an unplayable file.
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
        for (const stepType of TUTORIAL_STEP_TYPES) {
            const script = TUTORIAL_SCRIPTS[stepType].en;
            const duration = forcedDuration || autoDurationSec(script);
            const { slug, bytes } = await renderOne({ browser, stepType, durationSec: duration });
            const file = path.join(outDir, `${slug}.mp4`);
            await fs.writeFile(file, bytes);

            const probe = await probeMp4(file);
            assertClipContract({ slug, ...probe });
            console.log(`[tutorial] ${slug}.mp4  ${probe.width}x${probe.height}  ${probe.duration.toFixed(1)}s  ${wordCount(script)} words  → ${file}`);
        }
    } finally {
        await browser.close();
    }

    console.log('');
    console.log('[tutorial] done. Upload with:');
    for (const stepType of TUTORIAL_STEP_TYPES) {
        const slug = getTutorialSlug(stepType);
        console.log(`  npx wrangler r2 object put ${R2_BUCKET}/assets/videos/${slug}.mp4 --file ${path.join(outDir, `${slug}.mp4`)} --content-type video/mp4`);
    }
}

// Importable seams (the main() guard below keeps importing this module from
// starting a generation run). scripts/generate-tutorial-placeholders.test.js
// unit-tests the duration window, the page builder and the mp4 probe.
export { autoDurationSec, buildPage, probeMp4, helpText, R2_BUCKET, MIN_SECONDS, MAX_SECONDS };

// Repo script convention: a module whose exports are imported must not run
// main() at import time.
const invokedDirectly = process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
