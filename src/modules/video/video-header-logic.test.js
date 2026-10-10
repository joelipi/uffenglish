import { describe, it, expect } from 'vitest';
import { VIDEO_HEADER_RATIO, isVideoHeaderBlurVisible, videoHeaderBlurStyle } from './video-header-logic.js';
import { HEADER_BAND_RATIO } from './video-processor-logic.js';

describe('video header blur logic', () => {
    it('ties the blur ratio directly to the renderer header band (one variable)', () => {
        expect(VIDEO_HEADER_RATIO).toBe(HEADER_BAND_RATIO);
        expect(VIDEO_HEADER_RATIO).toBe(0.18);
    });

    it('hides the blur during chat (no video behind) and shows it otherwise', () => {
        expect(isVideoHeaderBlurVisible('chat')).toBe(false);
        for (const state of [
            'simpleVideo',
            'interactiveVideo',
            'decisionOverlay',
            'whisperReview',
            'webcamOrAvatar',
            'introCallWidget',
        ]) {
            expect(isVideoHeaderBlurVisible(state)).toBe(true);
        }
    });

    it('exposes the ratio as the --video-header-ratio custom property', () => {
        expect(videoHeaderBlurStyle()).toEqual({ '--video-header-ratio': VIDEO_HEADER_RATIO });
    });
});
