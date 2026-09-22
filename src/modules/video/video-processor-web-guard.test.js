import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_PATH = path.join(__dirname, 'video-processor.web.js');

describe('video-processor.web.js recap wiring guard', () => {
    const source = readFileSync(WEB_PATH, 'utf8');

    it('no longer references the retired webcamOnly flag', () => {
        expect(source).not.toMatch(/\bwebcamOnly\b/);
    });

    it('uses isShareCtaEnabled for the shareCta gate', () => {
        expect(source).toMatch(/isShareCtaEnabled/);
    });

    it('passes overlayVariant through executeRenderLoop and into resolveOverlayElements', () => {
        expect(source).toMatch(/overlayVariant/);
        expect(source).toMatch(/resolveOverlayElements\(\{\s*variant: overlayVariant/);
    });

    it('keeps renderStepToBlob overlay-free (silent only)', () => {
        const start = source.indexOf('async function renderStepToBlob');
        const end = source.indexOf('export async function exportSegmentsToR2');
        const renderStepBlob = source.slice(start, end);
        expect(renderStepBlob).toMatch(/\{ silent: true \}/);
        expect(renderStepBlob).not.toMatch(/overlayVariant/);
        expect(renderStepBlob).not.toMatch(/shareCta/);
    });

    it('uses the shared dropped-step helpers and revokes clip object URLs', () => {
        // The "first renderable step" rule lives in video-processor-logic.js
        // (unit-tested); the web layer must consume the helpers, not re-inline it.
        expect(source).toMatch(/isDroppedStep/);
        expect(source).toMatch(/markFirstRenderable/);
        expect(source).toMatch(/URL\.revokeObjectURL/);
    });

    it('distinguishes a never-loaded clip from one that is still buffering', () => {
        // A timeout must not drop a healthy but slow-to-play clip, and a late
        // metadata handler must not mutate the next step's element.
        expect(source).toMatch(/metadataLoaded/);
        expect(source).toMatch(/step\.playFatal/);
        expect(source).toMatch(/const stale = \(\) => plan\[stepIndex\] !== step/);
    });

    it('mutes the element before play and pre-decodes friend audio on Safari', () => {
        // Muting after play lets the element's audio overlap the decoded buffer
        // (echo) on iPad, so assert the ORDER: the mute assignment must precede
        // the first await video.play().
        expect(source).toMatch(/video\.muted = useDecodedAudio;[\s\S]{0,120}?await video\.play\(\)/);
        expect(source).toMatch(/detectSafari/);
        expect(source).toMatch(/Remote clip audio pre-decode/);
    });
});
