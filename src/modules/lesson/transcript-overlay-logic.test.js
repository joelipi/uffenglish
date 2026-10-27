// Where the transcript review box starts (stories/094).
//
// It must begin flush with the bottom of the lesson top overlay (progress bar +
// mission), and never in the middle of the frame where the take's play control
// lives. The measured bar height is what decides it, so the rule is tested here
// rather than assumed in the component.

import { describe, it, expect } from 'vitest';
import {
    TRANSCRIPT_TOP_OFFSET_FALLBACK_PX,
    resolveTranscriptTopOffset,
} from './transcript-overlay-logic.js';

describe('resolveTranscriptTopOffset', () => {
    it('uses the measured bar height, rounded', () => {
        expect(resolveTranscriptTopOffset(132)).toBe(132);
        expect(resolveTranscriptTopOffset(131.6)).toBe(132);
    });

    it('falls back before the first measurement', () => {
        expect(resolveTranscriptTopOffset(0)).toBe(TRANSCRIPT_TOP_OFFSET_FALLBACK_PX);
        expect(resolveTranscriptTopOffset(undefined)).toBe(TRANSCRIPT_TOP_OFFSET_FALLBACK_PX);
        expect(resolveTranscriptTopOffset(null)).toBe(TRANSCRIPT_TOP_OFFSET_FALLBACK_PX);
    });

    it('rejects negative and non-numeric readings instead of positioning off-screen', () => {
        expect(resolveTranscriptTopOffset(-40)).toBe(TRANSCRIPT_TOP_OFFSET_FALLBACK_PX);
        expect(resolveTranscriptTopOffset(Number.NaN)).toBe(TRANSCRIPT_TOP_OFFSET_FALLBACK_PX);
        expect(resolveTranscriptTopOffset('tall')).toBe(TRANSCRIPT_TOP_OFFSET_FALLBACK_PX);
    });

    it('honours a custom fallback', () => {
        expect(resolveTranscriptTopOffset(0, { fallback: 12 })).toBe(12);
    });
});
