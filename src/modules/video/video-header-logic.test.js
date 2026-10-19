import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIDEO_HEADER_RATIO, VIDEO_HEADER_COMPACT_RATIO, isVideoHeaderBlurVisible, videoHeaderBlurStyle } from './video-header-logic.js';
import { HEADER_BAND_RATIO, HEADER_TOP_MARGIN_RATIO, resolveHeaderLayout } from './video-processor-logic.js';

const HEADER = { naturalWidth: 1600, naturalHeight: 300 };

describe('video header blur logic', () => {
    it('ties the blur ratio to the total header area (margin + banner), above the band cap', () => {
        // The burned-in header is the margin plus the banner, so the blur must
        // be strictly taller than the banner-only band cap — and never exceed
        // the margin-plus-cap envelope.
        expect(VIDEO_HEADER_RATIO).toBeGreaterThan(HEADER_BAND_RATIO);
        expect(VIDEO_HEADER_RATIO).toBeLessThanOrEqual(HEADER_TOP_MARGIN_RATIO + HEADER_BAND_RATIO);
    });

    it('covers the rendered header on portrait frames (within a pixel of rounding)', () => {
        for (const [canvasWidth, canvasHeight] of [[1080, 1920], [720, 1280], [390, 693], [1600, 2844]]) {
            const { headerBottom } = resolveHeaderLayout({ ...HEADER, canvasWidth, canvasHeight });
            // Blur height = VIDEO_HEADER_RATIO * frame height; it must reach the
            // banner's bottom edge (the renderer rounds, hence the 1px slack).
            expect(VIDEO_HEADER_RATIO * canvasHeight).toBeGreaterThanOrEqual(headerBottom - 1);
        }
    });

    it('hides the blur during chat and on the final recap step, shows it otherwise', () => {
        // Chat: the overlay would blur the chat window.
        expect(isVideoHeaderBlurVisible('chat', 'continueButton')).toBe(false);
        // Final step, generating the recap and its share screen.
        expect(isVideoHeaderBlurVisible('videoProcessor', 'hidden')).toBe(false);
        expect(isVideoHeaderBlurVisible('videoProcessor', 'shareButtons')).toBe(false);
        // Final step, playing the recap back.
        expect(isVideoHeaderBlurVisible('simpleVideo', 'lessonSuccess')).toBe(false);
        expect(isVideoHeaderBlurVisible('decisionOverlay', 'lessonSuccess')).toBe(false);
        // Every other phase keeps the blur.
        for (const [mediaState, bottomState] of [
            ['simpleVideo', 'hidden'],
            ['interactiveVideo', 'hidden'],
            ['decisionOverlay', 'decisionButtons'],
            ['whisperReview', 'reviewButtons'],
            ['webcamOrAvatar', 'introChoices'],
            ['introCallWidget', 'hidden'],
        ]) {
            expect(isVideoHeaderBlurVisible(mediaState, bottomState)).toBe(true);
        }
    });

    it('exposes the compact ratio by default and the full ratio for branching steps', () => {
        expect(videoHeaderBlurStyle()).toEqual({ '--video-header-ratio': VIDEO_HEADER_COMPACT_RATIO });
        expect(videoHeaderBlurStyle({ full: true })).toEqual({ '--video-header-ratio': VIDEO_HEADER_RATIO });
        expect(videoHeaderBlurStyle({ full: false })).toEqual({ '--video-header-ratio': VIDEO_HEADER_COMPACT_RATIO });
    });

    it('keeps the compact ratio smaller than the full burned-header ratio', () => {
        expect(VIDEO_HEADER_COMPACT_RATIO).toBeGreaterThan(0);
        expect(VIDEO_HEADER_COMPACT_RATIO).toBeLessThan(VIDEO_HEADER_RATIO);
    });
});

// Story 068: the pipeline burns its title pill to this line and the app blurs
// to it, so the two layers cannot drift. Raw file text on both sides (the JS
// file is the ingest target; the Python constant is the render side), each
// proven failable by mutating a scanned copy.

describe('title band parity with the pipeline (story 068)', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, '../../..');
    const readRepo = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');

    // The literal the Python render pins (COMPACT_BLUR_RATIO in
    // docs/video-pipeline/video_pipeline.py).
    const pyBlurLiteral = /COMPACT_BLUR_RATIO\s*=\s*([0-9.]+)/;

    const assertParity = (jsText, pyText) => {
        const jsMatch = /VIDEO_HEADER_COMPACT_RATIO\s*=\s*([0-9.]+)/.exec(jsText);
        const pyMatch = pyBlurLiteral.exec(pyText);
        expect(jsMatch, 'JS compact ratio literal').not.toBeNull();
        expect(pyMatch, 'Python compact blur literal').not.toBeNull();
        expect(Number(pyMatch[1]), 'render/blur ratio mismatch').toBe(Number(jsMatch[1]));
        // The pipeline must DERIVE its title band from that constant.
        expect(pyText).toContain('BODY_TOP = COMPACT_BLUR_RATIO');
    };

    it('matches the pipeline COMPACT_BLUR_RATIO', () => {
        assertParity(readRepo('src/modules/video/video-header-logic.js'),
            readRepo('docs/video-pipeline/video_pipeline.py'));
    });

    it('the guard fails when either side is mutated', () => {
        const js = readRepo('src/modules/video/video-header-logic.js');
        const py = readRepo('docs/video-pipeline/video_pipeline.py');
        // JS side moved the blur.
        expect(() => assertParity(
            js.replace('VIDEO_HEADER_COMPACT_RATIO = 0.12', 'VIDEO_HEADER_COMPACT_RATIO = 0.15'), py,
        )).toThrow();
        // Python side no longer derives the band from the blur constant.
        expect(() => assertParity(
            js, py.replace('BODY_TOP = COMPACT_BLUR_RATIO', 'BODY_TOP = 0.17'),
        )).toThrow();
        // Python ratio drifted away from the JS one.
        expect(() => assertParity(
            js, py.replace('COMPACT_BLUR_RATIO = 0.12', 'COMPACT_BLUR_RATIO = 0.15'),
        )).toThrow();
    });
});
