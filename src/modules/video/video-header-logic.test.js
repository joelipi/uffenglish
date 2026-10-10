import { describe, it, expect } from 'vitest';
import { VIDEO_HEADER_RATIO, isVideoHeaderBlurVisible, videoHeaderBlurStyle } from './video-header-logic.js';
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

    it('exposes the ratio as the --video-header-ratio custom property', () => {
        expect(videoHeaderBlurStyle()).toEqual({ '--video-header-ratio': VIDEO_HEADER_RATIO });
    });
});
