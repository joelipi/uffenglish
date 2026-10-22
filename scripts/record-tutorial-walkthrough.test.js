// Unit tests for the friend-response walkthrough recorder's seams. The
// recording itself needs real Chrome (H.264 MediaRecorder) and the running
// app, so this file pins the parts that must not drift: the beat schedule the
// clip's pacing depends on, the caption/close-up layer, the encoder page and
// the dev-server preflight. `scripts/generate-tutorial-placeholders.test.js`
// already covers the shared artifact contract (probeMp4 / assertClipContract),
// which this recorder reuses rather than reimplements.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DEFAULT_TARGET,
    OVERLAY_BEATS,
    INTRO_CAPTION,
    NOMINAL_INTRO_SECONDS,
    OUTPUT_FPS,
    WALKTHROUGH_STYLE,
    WALKTHROUGH_LAYER_HTML,
    DECISION_BUTTON_IDS,
    assertBeatSchedule,
    assertDevServer,
    buildEncoderPage,
    helpText,
    timelineSeconds,
} from './record-tutorial-walkthrough.mjs';
import { MIN_SECONDS, MAX_SECONDS } from './generate-tutorial-placeholders.mjs';
import { TUTORIAL_VIDEO_WIDTH, TUTORIAL_VIDEO_HEIGHT, getTutorialSlug } from '../src/modules/video/tutorial-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const source = readFileSync(path.join(__dirname, 'record-tutorial-walkthrough.mjs'), 'utf8');

describe('walkthrough target', () => {
    it('records the friend-response tutorial from lesson A of the test course', () => {
        expect(DEFAULT_TARGET).toEqual({ courseId: 'wouldyourather-test', lessonId: 'a' });
        expect(getTutorialSlug('friendClosedResponse')).toBe('tutorial-friendClosedResponse');
    });

    it('opens on the same question the lesson plays after its intro and branching steps', () => {
        const config = JSON.parse(readFileSync(path.join(ROOT, 'src/config/wouldyourather-test.json'), 'utf8'));
        const lesson = config.lessons.find((entry) => entry.lessonId === DEFAULT_TARGET.lessonId);
        expect(lesson).toBeTruthy();
        const step = lesson.steps.find((entry) => entry.responseType === 'friendClosedResponse');
        expect(step).toBeTruthy();
        expect(step.cue[0].en).toBe('A million dollars today or five million dollars in five years?');
    });
});

describe('assertBeatSchedule', () => {
    it('accepts the shipped schedule', () => {
        expect(assertBeatSchedule()).toBe(true);
    });

    it('rejects beats out of order, or an unknown action', () => {
        const outOfOrder = [
            { at: 0, action: 'overlay', caption: ['a', 'b'] },
            { at: 2, action: 'highlight', highlight: 0, caption: ['a', 'b'] },
            { at: 1, action: 'finish' },
        ];
        expect(() => assertBeatSchedule(outOfOrder)).toThrow(/ordered/);
        expect(() => assertBeatSchedule([
            { at: 0, action: 'explode' },
            { at: 1, action: 'finish' },
        ])).toThrow(/unknown beat action/);
    });

    it('requires a finish beat so the encoder always has a stop time', () => {
        expect(() => assertBeatSchedule([
            { at: 0, action: 'overlay', caption: ['a', 'b'] },
            { at: 1, action: 'overlay', caption: ['a', 'b'] },
        ])).toThrow(/finish/);
    });

    it('requires a highlight index on card/highlight beats, and a caption on captioned beats', () => {
        expect(() => assertBeatSchedule([
            { at: 0, action: 'card', caption: ['a', 'b'] },
            { at: 1, action: 'finish' },
        ])).toThrow(/highlight/);
        expect(() => assertBeatSchedule([
            { at: 0, action: 'overlay', caption: ['a', 'b'] },
            { at: 1, action: 'highlight', highlight: 3, caption: ['a', 'b'] },
            { at: 2, action: 'finish' },
        ])).toThrow(/highlight/);
        expect(() => assertBeatSchedule([
            { at: 0, action: 'overlay', caption: ['a', ''] },
            { at: 1, action: 'finish' },
        ])).toThrow(/subtitle/);
    });

    it('keeps captions short enough to read on a phone', () => {
        const long = 'This caption is deliberately far too long to fit on one line of a portrait phone screen';
        expect(() => assertBeatSchedule([
            { at: 0, action: 'overlay', caption: [long, 'ok'] },
            { at: 1, action: 'finish' },
        ])).toThrow(/too long/);
    });
});

describe('timelineSeconds', () => {
    it('lands inside the tutorial modal 10-30s window', () => {
        const total = timelineSeconds();
        expect(total).toBeGreaterThanOrEqual(MIN_SECONDS);
        expect(total).toBeLessThanOrEqual(MAX_SECONDS);
    });

    it('is anchored to the decision row, not to a fixed clip length', () => {
        expect(timelineSeconds(2)).toBe(2 + OVERLAY_BEATS[OVERLAY_BEATS.length - 1].at);
        expect(timelineSeconds()).toBe(NOMINAL_INTRO_SECONDS + OVERLAY_BEATS[OVERLAY_BEATS.length - 1].at);
    });

    it('holds the question long enough to show the whole 5s clip first', () => {
        expect(NOMINAL_INTRO_SECONDS).toBeGreaterThanOrEqual(5);
        expect(INTRO_CAPTION[0]).toBe('Your friend recorded a question');
    });
});

describe('walkthrough layer', () => {
    it('names the three real decision buttons in on-screen order', () => {
        expect(DECISION_BUTTON_IDS).toEqual(['responseReplayBtn', 'responseAnswerBtn', 'responseTutorialBtn']);
    });

    it('styles the caption bar, dim veil, close-up card, highlight pulse and closing card', () => {
        expect(WALKTHROUGH_STYLE).toContain('#tw-caption');
        expect(WALKTHROUGH_STYLE).toContain('#tw-veil');
        expect(WALKTHROUGH_STYLE).toContain('#tw-card');
        expect(WALKTHROUGH_STYLE).toContain('#tw-end');
        expect(WALKTHROUGH_STYLE).toContain('.tw-on');
        expect(WALKTHROUGH_STYLE).toContain('@keyframes twTap');
        // The close-up clones the app's own ChoiceColumn markup, so its
        // overrides must target those classes (not a parallel mock structure).
        expect(WALKTHROUGH_STYLE).toContain('.ivp-choice-col');
        expect(WALKTHROUGH_STYLE).toContain('.ivp-choice-label-text');
        expect(WALKTHROUGH_STYLE).toContain('.call-btn');
    });

    it('ships the layer nodes the driver toggles', () => {
        for (const id of ['tw-veil', 'tw-card', 'tw-caption', 'tw-end']) {
            expect(WALKTHROUGH_LAYER_HTML).toContain(`id="${id}"`);
        }
        expect(WALKTHROUGH_LAYER_HTML).toContain('class="tw-row"');
        expect(WALKTHROUGH_LAYER_HTML).toContain('Repeat. Match. Move on.');
    });

    it('never captures a pointer over the real buttons (the layer must not eat the microphone tap)', () => {
        const start = WALKTHROUGH_STYLE.indexOf('#tw-layer{');
        expect(start).toBeGreaterThan(-1);
        const rule = WALKTHROUGH_STYLE.slice(start, WALKTHROUGH_STYLE.indexOf('}', start));
        expect(rule).toContain('position:fixed');
        expect(rule).toContain('pointer-events:none');
    });
});

describe('encoder page', () => {
    const page = buildEncoderPage({
        width: TUTORIAL_VIDEO_WIDTH,
        height: TUTORIAL_VIDEO_HEIGHT,
        fps: OUTPUT_FPS,
        bitsPerSecond: 3_000_000,
        mimeType: 'video/mp4;codecs=avc1.42E01E',
    });

    it('is a 720x1280 canvas recorded at the walkthrough fps', () => {
        expect(page).toContain(`width="${TUTORIAL_VIDEO_WIDTH}"`);
        expect(page).toContain(`height="${TUTORIAL_VIDEO_HEIGHT}"`);
        expect(page).toContain(`canvas.captureStream(FPS)`);
        expect(page).toContain(`const FPS = ${OUTPUT_FPS}`);
    });

    it('records H.264 mp4 through MediaRecorder, never webm', () => {
        expect(page).toContain('MediaRecorder');
        expect(page).toContain('video/mp4;codecs=avc1.42E01E');
        expect(page).not.toContain('video/webm');
        expect(page).toContain('isTypeSupported');
    });

    it('draws captured frames and returns the clip as base64', () => {
        expect(page).toContain('data:image/jpeg;base64,');
        expect(page).toContain('drawImage');
        expect(page).toContain('readAsDataURL');
        expect(page).toContain('window.__rec');
    });
});

describe('help and preflight', () => {
    it('prints the upload command for this exact slug', () => {
        const help = helpText('/tmp/out');
        expect(help).toContain('npx wrangler r2 object put uff/assets/videos/tutorial-friendClosedResponse.mp4');
        expect(help).toContain('--content-type video/mp4');
        expect(help).toContain('npx playwright install chrome');
        expect(help).toContain('npm run dev');
    });

    it('rejects an unreachable dev server instead of recording a blank page', async () => {
        await expect(assertDevServer('http://127.0.0.1:1')).rejects.toThrow(/dev server not reachable/);
    });
});

describe('module safety and capture path', () => {
    it('guards main() behind the direct-invocation check', () => {
        expect(source).toContain('import.meta.url === pathToFileURL(process.argv[1]).href');
        expect(source).toContain('if (invokedDirectly) main()');
    });

    it('imports only packages already in package.json', () => {
        const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        const allowed = new Set([
            ...Object.keys(pkg.dependencies || {}),
            ...Object.keys(pkg.devDependencies || {}),
        ]);
        const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1])
            .filter((name) => !name.startsWith('.') && !name.startsWith('node:'));
        const external = new Set(imports.map((name) => (name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0])));
        for (const dep of external) {
            expect([...allowed]).toContain(dep);
        }
    });

    it('captures with the CDP screencast, acking each frame after it is drawn', () => {
        expect(source).toContain('Page.startScreencast');
        expect(source).toContain('Page.screencastFrame');
        expect(source).toContain('Page.screencastFrameAck');
        // Node has no VideoEncoder, so the encode must happen in the browser.
        expect(source).toContain("channel: 'chrome'");
        expect(source).toContain('MediaRecorder');
    });

    it('serves the icon font from disk so the recorded buttons are not blank', () => {
        expect(source).toContain('bootstrap-icons/font/fonts');
        expect(source).toContain("path.join(ROOT, 'node_modules/bootstrap-icons/font/fonts')");
    });

    it('reuses the shared artifact contract instead of restating it', () => {
        expect(source).toContain("from './generate-tutorial-placeholders.mjs'");
        expect(source).toContain('assertClipContract');
        expect(source).toContain('probeMp4');
    });
});
