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

    it('marks a clip failed when playback never starts (no hang)', () => {
        expect(source).toMatch(/if \(!stepStartedPlaying\) step\.loadFailed = true/);
    });
});
