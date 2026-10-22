#!/usr/bin/env node
// Records the brief narrated-style walkthrough tutorial for the
// friendClosedResponse step: a real screen recording of the app playing the
// first friend-response step of the `wouldyourather-test` course's lesson A,
// with caption cards and a close-up of the three decision buttons.
//
// Why a screen recording and not the text-on-screen placeholder
// (scripts/generate-tutorial-placeholders.mjs) produces: this clip has to show
// the learner what the step LOOKS like and which buttons they can press, so it
// films the running app instead of printing its script. The recording is
// silent (the tutorial modal already renders the localized script as
// subtitles), portrait 720x1280, and lands in the same R2 slot as the
// placeholder it replaces: assets/videos/tutorial-friendClosedResponse.mp4.
//
// How it works: Playwright drives REAL Chrome (channel: 'chrome' — the bundled
// Chromium has no H.264) through the lesson, and the page is captured with the
// CDP screencast (change-driven JPEG frames, ~55 fps in practice). Each frame
// is drawn into a canvas inside the same page, and that canvas is recorded
// live with MediaRecorder, so the output is a real mp4 with no ffmpeg and no
// frame staging on disk. Node has no VideoEncoder, which is why the encode
// runs in the browser.
//
// Prerequisites:
//   npm run dev                     (or `--base=http://localhost:<port>`)
//   npx playwright install chrome   (real Chrome for H.264 MediaRecorder)
//
// Usage:
//   node scripts/record-tutorial-walkthrough.mjs --help
//   node scripts/record-tutorial-walkthrough.mjs [--out=<dir>] [--base=<url>]
//                                                [--course=<id>] [--lesson=<id>]
//
// The clip is written OUTSIDE the repo (lesson media is never committed) and
// uploaded to R2 by hand — the script prints the exact wrangler command.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { flagValue, resolveDirOutsideRepo } from './lib/cli-utils.js';
import {
    R2_BUCKET,
    assertClipContract,
    probeMp4,
    MIN_SECONDS,
    MAX_SECONDS,
} from './generate-tutorial-placeholders.mjs';
import {
    TUTORIAL_VIDEO_WIDTH,
    TUTORIAL_VIDEO_HEIGHT,
    getTutorialSlug,
} from '../src/modules/video/tutorial-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const STEP_TYPE = 'friendClosedResponse';
const SLUG = getTutorialSlug(STEP_TYPE);
const R2_KEY = `${R2_BUCKET}/assets/videos/${SLUG}.mp4`;

// The demo content: the first friend-response step of lesson A. Lesson A's
// first two steps are the lesson intro and a branching question, which are not
// part of the friend-response flow, so the walkthrough starts at the first
// `friendClosedResponse` step (the "million dollars" question).
export const DEFAULT_TARGET = { courseId: 'wouldyourather-test', lessonId: 'a' };

// 20 fps is enough for a UI walkthrough (the only continuous motion is the
// friend's clip) and keeps the per-frame JPEG decode + draw inside the page's
// frame budget while the screencast keeps feeding frames.
export const OUTPUT_FPS = 20;
const VIDEO_BITS_PER_SECOND = 3_000_000;
const MEDIA_RECORDER_MIME = 'video/mp4;codecs=avc1.42E01E';
const SCREENCAST_QUALITY = 82;

// Caption shown while the friend's question plays. The intro's real length is
// however long the clip is, so the schedule below is anchored to the moment
// the decision row appears, not to a fixed time.
export const INTRO_CAPTION = ['Your friend recorded a question', 'Watch it before you answer.'];
export const NOMINAL_INTRO_SECONDS = 7;

/**
 * The beats after the decision row mounts, as offsets in seconds. The first
 * beat names the row; the next three highlight one button at a time in the
 * close-up card; `record` presses the real microphone button; `end` fades in
 * the closing card; `finish` just marks the stop time.
 */
export const OVERLAY_BEATS = [
    { at: 0.0, action: 'overlay', caption: ['Now it is your turn', 'Three buttons appear.'] },
    { at: 1.2, action: 'card', highlight: 1, caption: ['Press REPEAT NOW', 'Say the line word for word.'] },
    { at: 4.7, action: 'highlight', highlight: 0, caption: ['REPLAY VIDEO', 'Hear your friend again.'] },
    { at: 7.2, action: 'highlight', highlight: 2, caption: ['WATCH TUTORIAL', 'Rewatch this guide any time.'] },
    { at: 9.7, action: 'record', caption: ['Then speak', 'Get every word right to move on.'] },
    { at: 14.1, action: 'end' },
    { at: 17.5, action: 'finish' },
];

const BEAT_ACTIONS = new Set(['overlay', 'card', 'highlight', 'record', 'end', 'finish']);
const MAX_TITLE_CHARS = 34;
const MAX_SUB_CHARS = 52;

/** Total scheduled seconds for a run whose intro lasted `introSeconds`. */
export function timelineSeconds(introSeconds = NOMINAL_INTRO_SECONDS) {
    return introSeconds + OVERLAY_BEATS[OVERLAY_BEATS.length - 1].at;
}

/**
 * Structural rules for the beat table. Exported so the unit tests pin them and
 * `main()` refuses to record a schedule that violates the clip contract.
 */
export function assertBeatSchedule(beats = OVERLAY_BEATS) {
    if (!Array.isArray(beats) || beats.length < 2) throw new Error('beat schedule must have at least two beats');
    let previous = -1;
    let sawFinish = false;
    for (const beat of beats) {
        if (!BEAT_ACTIONS.has(beat.action)) throw new Error(`unknown beat action: ${beat.action}`);
        if (typeof beat.at !== 'number' || !Number.isFinite(beat.at) || beat.at < 0) {
            throw new Error(`beat at must be a non-negative number (got ${beat.at})`);
        }
        if (beat.at < previous) throw new Error(`beats must be ordered (${beat.at} after ${previous})`);
        previous = beat.at;
        if (beat.action === 'finish') sawFinish = true;
        if (beat.caption) {
            const [title, sub] = beat.caption;
            if (typeof title !== 'string' || !title.trim()) throw new Error('caption title is required');
            if (typeof sub !== 'string' || !sub.trim()) throw new Error('caption subtitle is required');
            if (title.length > MAX_TITLE_CHARS) throw new Error(`caption title too long: ${title}`);
            if (sub.length > MAX_SUB_CHARS) throw new Error(`caption subtitle too long: ${sub}`);
        }
        if ((beat.action === 'card' || beat.action === 'highlight')
            && !(Number.isInteger(beat.highlight) && beat.highlight >= 0 && beat.highlight <= 2)) {
            throw new Error(`beat ${beat.action} needs highlight 0-2`);
        }
    }
    if (!sawFinish) throw new Error('beat schedule must end with a finish beat');
    return true;
}

// The walkthrough layer: caption bar, dim veil, close-up card and closing card.
// Kept as plain CSS/markup strings so the unit tests can pin the pieces, and
// injected into the page by `installWalkthroughLayer`.
export const WALKTHROUGH_STYLE = `
#tw-layer{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
#tw-veil{position:absolute;inset:0;background:rgba(4,24,40,.74);opacity:0;transition:opacity .35s ease}
#tw-caption{position:absolute;left:0;right:0;top:0;padding:36px 28px 46px;background:linear-gradient(to bottom,rgba(4,24,40,.97) 0%,rgba(4,24,40,.93) 55%,rgba(4,24,40,0) 100%);color:#fff;text-align:center;opacity:0;transition:opacity .3s ease}
#tw-caption h2{margin:0;font-size:34px;line-height:1.12;font-weight:800;letter-spacing:-.2px}
#tw-caption p{margin:12px 0 0;font-size:23px;line-height:1.35;color:#c9e9ff;font-weight:500}
#tw-card{position:absolute;left:26px;right:26px;top:330px;padding:26px 16px 24px;border-radius:26px;background:linear-gradient(180deg,#2f86c9 0%,#00b4cf 100%);box-shadow:0 24px 70px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.16) inset;transform:translateY(26px) scale(.97);opacity:0;transition:opacity .35s ease,transform .35s ease}
#tw-card.on{opacity:1;transform:none}
#tw-card .tw-row{display:flex;align-items:flex-start;gap:2px}
#tw-card .ivp-choice-col{flex:1;min-width:0;text-align:center}
#tw-card .ivp-choice-label{min-height:56px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:16px}
#tw-card .ivp-choice-label-text{font-size:19px;line-height:1.2;font-weight:700;letter-spacing:.3px;color:#fff}
#tw-card .call-btn{width:92px;height:92px;margin:0 auto;font-size:38px;position:relative}
#tw-card .tw-on .call-btn{box-shadow:0 0 0 5px #ffd54a,0 0 44px 12px rgba(255,213,74,.55)}
#tw-card .tw-on .call-btn::after{content:'';position:absolute;inset:-5px;border-radius:999px;border:4px solid rgba(255,213,74,.9);animation:twTap 1.1s ease-out infinite}
@keyframes twTap{0%{transform:scale(1);opacity:.95}100%{transform:scale(1.75);opacity:0}}
#tw-end{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:linear-gradient(180deg,#12314b 0%,#1a3a5a 60%,#0b2236 100%);color:#fff;text-align:center;padding:0 56px;opacity:0;transition:opacity .4s ease}
#tw-end.on{opacity:1}
#tw-end h2{margin:0;font-size:44px;line-height:1.12;font-weight:800;font-style:italic}
#tw-end p{margin:0;font-size:26px;line-height:1.35;color:#bfe4ff}
`;

export const WALKTHROUGH_LAYER_HTML = `<div id="tw-veil"></div>
<div id="tw-card"><div class="tw-row"></div></div>
<div id="tw-caption"><h2></h2><p></p></div>
<div id="tw-end"><h2>Repeat. Match. Move on.</h2><p>Every word right unlocks the next question.</p></div>`;

// The three decision buttons the close-up card clones, in on-screen order.
export const DECISION_BUTTON_IDS = ['responseReplayBtn', 'responseAnswerBtn', 'responseTutorialBtn'];

/**
 * The encoder page: a canvas the captured frames are drawn onto, recorded live
 * with MediaRecorder. Frames arrive one at a time from the screencast, so the
 * page exposes `start()`, `draw(base64Jpeg)` and `stop()`.
 */
export function buildEncoderPage({ width, height, fps, bitsPerSecond, mimeType }) {
    return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<canvas id="c" width="${width}" height="${height}"></canvas>
<script>
(() => {
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const MIME = ${JSON.stringify(mimeType)};
    const FPS = ${Number(fps)};
    const BPS = ${Number(bitsPerSecond)};
    let recorder = null;
    let chunks = [];
    let drawn = 0;

    async function start() {
        if (!MediaRecorder.isTypeSupported(MIME)) throw new Error('unsupported mime type: ' + MIME);
        chunks = [];
        drawn = 0;
        const stream = canvas.captureStream(FPS);
        recorder = new MediaRecorder(stream, { mimeType: MIME, videoBitsPerSecond: BPS });
        recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.start(1000);
    }

    async function draw(base64Jpeg) {
        if (!recorder) throw new Error('recorder not started');
        const img = new Image();
        img.src = 'data:image/jpeg;base64,' + base64Jpeg;
        await img.decode();
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        drawn += 1;
        return drawn;
    }

    async function stop() {
        const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
        recorder.stop();
        await stopped;
        const blob = new Blob(chunks, { type: 'video/mp4' });
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('read failed'));
            reader.readAsDataURL(blob);
        });
        return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), drawn };
    }

    window.__rec = { start, draw, stop };
})();
</script></body></html>`;
}

export function helpText(outDir) {
    return [
        'Record the friendClosedResponse walkthrough tutorial from the running app.',
        '',
        'Options:',
        '  --out=<dir>        staging directory (must be outside the repo)',
        '  --base=<url>       dev server serving this worktree (default http://localhost:3000)',
        '  --course=<id>      course config to open (default wouldyourather-test)',
        '  --lesson=<id>      lesson to open (default a)',
        '  --help             this text, plus the R2 upload command',
        '',
        'Requires `npm run dev` and real Chrome: npx playwright install chrome',
        '',
        'After recording, upload the clip to R2:',
        `  npx wrangler r2 object put ${R2_KEY} --file <out>/${SLUG}.mp4 --content-type video/mp4`,
        '',
        `Default output directory: ${outDir}`,
    ].join('\n');
}

/** Fail with a clear message instead of recording a blank page. */
export async function assertDevServer(baseUrl) {
    let res;
    try {
        res = await fetch(`${baseUrl}/`);
    } catch (error) {
        throw new Error(`dev server not reachable at ${baseUrl} (${error.message}); run \`npm run dev\` or pass --base=<url>`);
    }
    if (!res.ok) throw new Error(`dev server at ${baseUrl} answered ${res.status}; run \`npm run dev\` or pass --base=<url>`);
    const moduleRes = await fetch(`${baseUrl}/src/modules/lesson/lesson-loader.js`);
    if (!moduleRes.ok) throw new Error(`${baseUrl} is not serving this app (lesson-loader.js answered ${moduleRes.status})`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Install the caption/veil/card layer and expose the driver on `window.__tw`. */
async function installWalkthroughLayer(page, { style, html, buttonIds }) {
    await page.evaluate(({ style, html, buttonIds }) => {
        const styleEl = document.createElement('style');
        styleEl.textContent = style;
        document.head.appendChild(styleEl);

        const layer = document.createElement('div');
        layer.id = 'tw-layer';
        layer.innerHTML = html;
        document.body.appendChild(layer);

        const q = (selector) => layer.querySelector(selector);
        const row = q('.tw-row');
        const captionEl = q('#tw-caption');
        const coarse = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        const api = {
            // Clone the app's real decision columns (label + circular button) so
            // the close-up shows the actual UI, not a redrawn mock.
            buildRow() {
                row.innerHTML = '';
                for (const id of buttonIds) {
                    const button = document.getElementById(id);
                    if (!button) throw new Error(`decision button missing: ${id}`);
                    const clone = button.closest('.ivp-choice-col').cloneNode(true);
                    clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
                    row.appendChild(clone);
                }
            },
            caption(title, sub) {
                captionEl.querySelector('h2').textContent = title;
                captionEl.querySelector('p').textContent = sub;
                captionEl.style.opacity = '1';
            },
            hideCaption() { captionEl.style.opacity = '0'; },
            veil(on) { q('#tw-veil').style.opacity = on ? '1' : '0'; },
            card(on) { q('#tw-card').classList.toggle('on', on); },
            highlight(index) {
                [...row.children].forEach((column, i) => column.classList.toggle('tw-on', i === index));
            },
            record() {
                api.card(false);
                api.veil(false);
            },
            end() {
                api.hideCaption();
                q('#tw-end').classList.add('on');
            },
            reducedMotion: coarse,
        };
        window.__tw = api;
    }, { style, html, buttonIds });
}

/**
 * Clear the guest-language gate and wait for the course config, mirroring the
 * lesson specs' helper (the config only loads once a guest language is
 * settled, so the modal has to be answered first).
 */
async function enterLesson(page) {
    await page.waitForFunction(
        () => window.appStore?.getState()?.configData || document.querySelector('#guestEnglishOnlyBtn'),
        null,
        { timeout: 30000 }
    );
    if (await page.locator('#guestEnglishOnlyBtn').count()) {
        await page.click('#guestEnglishOnlyBtn');
        const continueButton = page.locator('#guestContinueBtn');
        if (await continueButton.count()) await continueButton.click().catch(() => {});
    }
    await page.waitForFunction(() => window.appStore?.getState()?.configData, null, { timeout: 20000 });
}

/** Jump the already-loaded lesson to its first friend-response step. */
async function mountFriendResponseStep(page, { lessonId }) {
    const mounted = await page.evaluate(async ({ lessonId: id, responseType }) => {
        const { loadLessonContent } = await import('/src/modules/lesson/lesson-loader.js');
        const lesson = window.appStore.getState().configData.lessons.find((entry) => entry.lessonId === id);
        if (!lesson) throw new Error(`lesson "${id}" not found in the course config`);
        const index = lesson.steps.findIndex((step) => step.responseType === responseType);
        if (index === -1) throw new Error(`lesson "${id}" has no ${responseType} step`);
        window.appStore.setState({ currentStepIndex: index, currentStepIndexLessonId: id });
        await loadLessonContent(lesson);
        return { index, stepCount: lesson.steps.length };
    }, { lessonId, responseType: STEP_TYPE });
    return mounted;
}

/**
 * Capture the page with the CDP screencast. Chrome sends a frame only when the
 * page changes and waits for the ack, so `onFrame` is the backpressure point:
 * ack only after the frame has been handled.
 */
async function startCapture(page, { fps, onFrame }) {
    const client = await page.context().newCDPSession(page);
    let firstTimestamp = null;

    client.on('Page.screencastFrame', (frame) => {
        const { data, metadata, sessionId } = frame;
        if (firstTimestamp === null) firstTimestamp = metadata.timestamp;
        const atMs = (metadata.timestamp - firstTimestamp) * 1000;
        Promise.resolve(onFrame(data, atMs))
            .catch((error) => console.warn('[walkthrough] frame dropped:', error.message))
            .finally(() => {
                client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
            });
    });

    await client.send('Page.startScreencast', {
        format: 'jpeg',
        quality: SCREENCAST_QUALITY,
        maxWidth: TUTORIAL_VIDEO_WIDTH,
        maxHeight: TUTORIAL_VIDEO_HEIGHT,
        everyNthFrame: 1,
    });

    return {
        async stop() {
            await client.send('Page.stopScreencast').catch(() => {});
            await client.detach().catch(() => {});
        },
    };
}

async function applyBeat(page, beat) {
    switch (beat.action) {
        case 'overlay':
            await page.evaluate(([title, sub]) => window.__tw.caption(title, sub), beat.caption);
            break;
        case 'card':
            await page.evaluate(([highlight, title, sub]) => {
                window.__tw.buildRow();
                window.__tw.veil(true);
                window.__tw.card(true);
                window.__tw.highlight(highlight);
                window.__tw.caption(title, sub);
            }, [beat.highlight, ...beat.caption]);
            break;
        case 'highlight':
            await page.evaluate(([highlight, title, sub]) => {
                window.__tw.highlight(highlight);
                window.__tw.caption(title, sub);
            }, [beat.highlight, ...beat.caption]);
            break;
        case 'record':
            await page.evaluate(([title, sub]) => {
                window.__tw.record();
                window.__tw.caption(title, sub);
            }, beat.caption);
            // The real button, under the pointer-events:none layer — this is the
            // app's own getUserMedia path, so the clip shows the true recording UI.
            await page.click('#responseAnswerBtn', { force: true });
            break;
        case 'end':
            await page.evaluate(() => window.__tw.end());
            break;
        case 'finish':
        default:
            break;
    }
}

/** Replay the beats on wall-clock time so the recording matches the schedule. */
async function runBeats(page, beats) {
    const start = Date.now();
    for (const beat of beats) {
        const due = start + beat.at * 1000;
        const wait = due - Date.now();
        if (wait > 0) await sleep(wait);
        console.log(`[walkthrough] beat ${beat.at.toFixed(1)}s ${beat.action}${beat.caption ? ` — ${beat.caption[0]}` : ''}`);
        await applyBeat(page, beat);
    }
}

async function main() {
    const args = process.argv.slice(2);
    const defaultOut = path.join(os.tmpdir(), 'uff-tutorial-walkthrough');
    if (args.includes('--help')) {
        console.log(helpText(defaultOut));
        return;
    }

    assertBeatSchedule();
    const totalSeconds = timelineSeconds();
    if (totalSeconds < MIN_SECONDS || totalSeconds > MAX_SECONDS) {
        throw new Error(`scheduled ${totalSeconds}s is outside the ${MIN_SECONDS}-${MAX_SECONDS}s tutorial window`);
    }

    const base = (flagValue(args, '--base') || 'http://localhost:3000').replace(/\/$/, '');
    const courseId = flagValue(args, '--course') || DEFAULT_TARGET.courseId;
    const lessonId = flagValue(args, '--lesson') || DEFAULT_TARGET.lessonId;
    const outDir = resolveDirOutsideRepo(ROOT, {
        envValue: flagValue(args, '--out'),
        defaultDir: defaultOut,
        label: '--out',
    });
    await fs.mkdir(outDir, { recursive: true });
    await assertDevServer(base);

    console.log(`[walkthrough] recording ${SLUG} from ${base} (course ${courseId}, lesson ${lessonId})`);

    // `channel: 'chrome'` is mandatory for H.264 MediaRecorder; the fake media
    // flags let the real microphone button enter the recording UI without a
    // device, and allow unmuted clip playback without a gesture.
    const browser = await chromium.launch({
        channel: 'chrome',
        args: [
            '--autoplay-policy=no-user-gesture-required',
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            // The encoder lives in a second tab, so the recorded tab must keep
            // producing frames and playing the clip while it is backgrounded.
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
        ],
    });

    try {
        const context = await browser.newContext({
            viewport: { width: TUTORIAL_VIDEO_WIDTH, height: TUTORIAL_VIDEO_HEIGHT },
            permissions: ['microphone'],
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => console.warn('[walkthrough] page error:', error.message));

        // When node_modules is a symlink outside the Vite root (as in a git
        // worktree) the icon font 403s and every `bi` icon renders blank.
        // Serve it from disk so the recorded buttons show their
        // microphones/arrows/book.
        const iconsDir = path.join(ROOT, 'node_modules/bootstrap-icons/font/fonts');
        await page.route('**/bootstrap-icons/font/fonts/**', async (route) => {
            const name = path.basename(new URL(route.request().url()).pathname);
            try {
                const body = await fs.readFile(path.join(iconsDir, name));
                await route.fulfill({ status: 200, contentType: 'font/woff2', body });
            } catch (error) {
                console.warn(`[walkthrough] icon font missing (${name}):`, error.message);
                await route.abort();
            }
        });

        await page.goto(`${base}/course/${courseId}/lesson/${lessonId}`);
        await enterLesson(page);
        const mounted = await mountFriendResponseStep(page, { lessonId });
        console.log(`[walkthrough] mounted ${STEP_TYPE} step ${mounted.index + 1}/${mounted.stepCount}`);
        await page.waitForTimeout(900);

        await installWalkthroughLayer(page, {
            style: WALKTHROUGH_STYLE,
            html: WALKTHROUGH_LAYER_HTML,
            buttonIds: DECISION_BUTTON_IDS,
        });
        await page.evaluate(([title, sub]) => window.__tw.caption(title, sub), INTRO_CAPTION);

        const encoder = await context.newPage();
        await encoder.setContent(buildEncoderPage({
            width: TUTORIAL_VIDEO_WIDTH,
            height: TUTORIAL_VIDEO_HEIGHT,
            fps: OUTPUT_FPS,
            bitsPerSecond: VIDEO_BITS_PER_SECOND,
            mimeType: MEDIA_RECORDER_MIME,
        }), { waitUntil: 'load' });
        // Keep the recorded tab active: the encoder never needs the foreground.
        await page.bringToFront();
        await encoder.evaluate(() => window.__rec.start());

        const minGapMs = Math.floor(1000 / OUTPUT_FPS) - 4;
        let lastDrawnAt = -Infinity;
        let drawnFrames = 0;
        const capture = await startCapture(page, {
            fps: OUTPUT_FPS,
            onFrame: async (data, atMs) => {
                if (atMs - lastDrawnAt < minGapMs) return;
                lastDrawnAt = atMs;
                drawnFrames = await encoder.evaluate((b64) => window.__rec.draw(b64), data);
            },
        });

        try {
            // Beat 1: the friend's own question plays, exactly as it does in the
            // step (muted so autoplay is always allowed; the clip is silent).
            await page.evaluate(() => {
                const video = [...document.querySelectorAll('video')].find((node) => node.id !== 'webcam-preview');
                if (!video) throw new Error('lesson video element missing');
                video.muted = true;
                return video.play().catch(() => {});
            });
            await page.waitForFunction(() => {
                const video = [...document.querySelectorAll('video')].find((node) => node.id !== 'webcam-preview');
                return !!video && video.currentTime > 0.4;
            }, null, { timeout: 15000 });
            await page.waitForSelector('#responseAnswerBtn', { state: 'visible', timeout: 25000 });
            console.log('[walkthrough] decision row mounted — running the beat schedule');
            await runBeats(page, OVERLAY_BEATS);
        } finally {
            await capture.stop();
        }

        const recorded = await encoder.evaluate(() => window.__rec.stop());
        await encoder.close();
        const file = path.join(outDir, `${SLUG}.mp4`);
        await fs.writeFile(file, Buffer.from(recorded.base64, 'base64'));

        const probe = await probeMp4(file);
        assertClipContract({ slug: SLUG, ...probe });
        console.log(`[walkthrough] ${SLUG}.mp4  ${probe.width}x${probe.height}  ${probe.duration.toFixed(1)}s  ${drawnFrames} frames drawn  → ${file}`);
        console.log('');
        console.log('[walkthrough] done. Upload with:');
        console.log(`  npx wrangler r2 object put ${R2_KEY} --file ${file} --content-type video/mp4`);
    } finally {
        await browser.close();
    }
}

// Importable seams (the main() guard below keeps importing this module from
// starting a recording run). The unit tests cover the schedule, the layer, the
// encoder page and the dev-server preflight.

const invokedDirectly = process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
