// Unit tests for the tutorial placeholder generator's seams. The browser
// encoding itself needs real Chrome (MediaRecorder H.264; Playwright's bundled
// ffmpeg has no H.264/drawtext and Node has no VideoEncoder), so the artifact
// contract is covered two ways: `assertClipContract` (the rule each generated
// clip must satisfy) is unit-tested directly, and `probeMp4`'s demux is tested
// against its rejection paths plus a real generated clip when one is present.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    MIN_SECONDS,
    MAX_SECONDS,
    R2_BUCKET,
    autoDurationSec,
    assertClipContract,
    buildPage,
    helpText,
    probeMp4,
} from './generate-tutorial-placeholders.mjs';
import { TUTORIAL_STEP_TYPES, TUTORIAL_SCRIPTS, TUTORIAL_VIDEO_WIDTH, TUTORIAL_VIDEO_HEIGHT, getTutorialSlug } from '../src/modules/video/tutorial-logic.js';
import { resolveDirOutsideRepo } from './lib/cli-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const source = readFileSync(path.join(__dirname, 'generate-tutorial-placeholders.mjs'), 'utf8');

// A real generated clip, when a generator run has happened locally
// (`node scripts/generate-tutorial-placeholders.mjs`).
const FIXTURE_DIR = process.env.TUTORIAL_PLACEHOLDER_DIR || path.join(os.tmpdir(), 'uff-tutorial-placeholders');
const FIXTURE = path.join(FIXTURE_DIR, `${getTutorialSlug('branching')}.mp4`);

describe('autoDurationSec', () => {
    it.each(TUTORIAL_STEP_TYPES)('sizes %s inside the 10-30s window', (stepType) => {
        const d = autoDurationSec(TUTORIAL_SCRIPTS[stepType].en);
        expect(d).toBeGreaterThanOrEqual(MIN_SECONDS);
        expect(d).toBeLessThanOrEqual(MAX_SECONDS);
    });

    it('clamps a too-short script up and a too-long script down', () => {
        expect(autoDurationSec('one two three')).toBe(MIN_SECONDS);
        expect(autoDurationSec(Array.from({ length: 400 }, () => 'word').join(' '))).toBe(MAX_SECONDS);
    });

    it('scales with script length', () => {
        const short = autoDurationSec(TUTORIAL_SCRIPTS.branching.en);
        const long = autoDurationSec(TUTORIAL_SCRIPTS.friendClosedResponse.en);
        expect(long).toBeGreaterThanOrEqual(short);
    });
});

describe('assertClipContract - the artifact rule for every generated clip', () => {
    const slug = 'tutorial-branching';

    it('accepts portrait 720x1280 clips within 10-30s', () => {
        expect(assertClipContract({ slug, width: 720, height: 1280, duration: 12.5 })).toBe(true);
    });

    it('rejects the wrong dimensions', () => {
        expect(() => assertClipContract({ slug, width: 1280, height: 720, duration: 12.5 }))
            .toThrow(/720x1280/);
        expect(() => assertClipContract({ slug, width: 720, height: 1279, duration: 12.5 }))
            .toThrow(/720x1280/);
    });

    it('rejects clips outside the 10-30s window', () => {
        expect(() => assertClipContract({ slug, width: 720, height: 1280, duration: 4 }))
            .toThrow(/10-30s window/);
        expect(() => assertClipContract({ slug, width: 720, height: 1280, duration: 31 }))
            .toThrow(/10-30s window/);
        expect(() => assertClipContract({ slug, width: 720, height: 1280, duration: NaN }))
            .toThrow(/10-30s window/);
    });

    it('accepts the window boundaries', () => {
        expect(assertClipContract({ slug, width: 720, height: 1280, duration: MIN_SECONDS })).toBe(true);
        expect(assertClipContract({ slug, width: 720, height: 1280, duration: MAX_SECONDS })).toBe(true);
    });
});

describe('buildPage', () => {
    it('is a portrait 720x1280 canvas carrying the exact script', () => {
        const page = buildPage({ script: 'Say this out loud.' });
        expect(page).toContain(`width="${TUTORIAL_VIDEO_WIDTH}"`);
        expect(page).toContain(`height="${TUTORIAL_VIDEO_HEIGHT}"`);
        expect(page).toContain('Say this out loud.');
    });

    it('burns white script text on the app card colour and repaints while recording', () => {
        const page = buildPage({ script: 'x' });
        expect(page).toContain('#1a3a5a');
        expect(page).toContain('#ffffff');
        // Chrome emits canvas frames only when the canvas changes, so an
        // unrepainted canvas records an empty file.
        expect(page).toContain('canvas.captureStream(10)');
        expect(page).toContain('requestAnimationFrame');
    });
});

describe('probeMp4 rejection paths', () => {
    const tmp = path.join(os.tmpdir(), 'uff-tutorial-probe-fixtures');

    it('rejects a file too small to be an mp4', async () => {
        const fs = await import('node:fs');
        await fs.promises.mkdir(tmp, { recursive: true });
        const file = path.join(tmp, 'tiny.mp4');
        await fs.promises.writeFile(file, Buffer.alloc(4));
        await expect(probeMp4(file)).rejects.toThrow(/too small/);
    });

    it('rejects a file without the ftyp box', async () => {
        const fs = await import('node:fs');
        await fs.promises.mkdir(tmp, { recursive: true });
        const file = path.join(tmp, 'notmp4.mp4');
        await fs.promises.writeFile(file, Buffer.alloc(64, 7));
        await expect(probeMp4(file)).rejects.toThrow(/ISO-BMFF/);
    });

    it('accepts a real ftyp header, then rejects its missing video track', async () => {
        const fs = await import('node:fs');
        await fs.promises.mkdir(tmp, { recursive: true });
        const file = path.join(tmp, 'ftyp-only.mp4');
        const buf = Buffer.alloc(64, 0);
        buf.write('ftyp', 4, 'ascii');
        await fs.promises.writeFile(file, buf);
        // The ftyp gate passes (unlike the case above); the demux then finds
        // no video track.
        await expect(probeMp4(file)).rejects.toThrow(/no video track/);
    });
});

// The generator's own output, when a real-Chrome run has happened locally
// (`node scripts/generate-tutorial-placeholders.mjs`). Absent in CI, where it
// skips; set TUTORIAL_PLACEHOLDER_DIR to point at a staging directory.
describe('probeMp4 on a real generated clip', () => {
    const hasFixture = existsSync(FIXTURE);

    it.skipIf(!hasFixture)('reads 720x1280 and a 10-30s duration', async () => {
        const probe = await probeMp4(FIXTURE);
        expect(assertClipContract({ slug: 'branching', ...probe })).toBe(true);
    });
});

describe('output directory and help output', () => {
    it('refuses an output directory inside the repo (lesson media is never committed)', () => {
        expect(() => resolveDirOutsideRepo(ROOT, {
            envValue: path.join(ROOT, 'public/assets/videos'),
            defaultDir: '/tmp/x',
            label: '--out',
        })).toThrow(/outside the repo root/);
    });

    it('prints one upload command per tutorial slug, plus the content type', () => {
        const help = helpText('/tmp/out');
        for (const stepType of TUTORIAL_STEP_TYPES) {
            expect(help).toContain(`npx wrangler r2 object put ${R2_BUCKET}/assets/videos/${getTutorialSlug(stepType)}.mp4`);
        }
        expect(help).toContain('--content-type video/mp4');
        expect(help.match(/npx wrangler r2 object put/g)).toHaveLength(TUTORIAL_STEP_TYPES.length);
    });
});

describe('module safety and encoding path', () => {
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
        const external = new Set(imports.map((name) => name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]));
        for (const dep of external) {
            expect([...allowed]).toContain(dep);
        }
    });

    it('encodes through MediaRecorder in real Chrome, one video per step type', () => {
        expect(source).toContain("channel: 'chrome'");
        expect(source).toContain('MediaRecorder');
        expect(source).toContain('canvas.captureStream(');
        expect(source).toContain('TUTORIAL_STEP_TYPES');
        // MediaRecorder is given an mp4 mime type, never webm.
        expect(source).toContain("video/mp4;codecs=avc1.42E01E");
        expect(source).not.toContain('video/webm');
    });
});
