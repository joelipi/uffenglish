import { describe, it, expect } from 'vitest';
import { resolveRetryPhase, MIC_RETRY_PHASE } from './retry-phase-logic.js';

describe('resolveRetryPhase', () => {
    it('replays the clip of a friendClosedResponse simple-video step', () => {
        // Not the decision phase: the decision screen (Continue) is raised by
        // the clip's own end-of-playback transition, so the gradient overlay
        // never appears over a playing clip (stories/092).
        const phase = resolveRetryPhase({
            responseType: 'friendClosedResponse',
            simpleVideoUrl: 'wouldyourather-a-01-01',
        });
        expect(phase).toBe('simpleVideo');
        expect(phase).not.toBe('simpleVideo-decisionTime-response');
    });

    it('replays an interactive friendClosedResponse clip in its own playback phase', () => {
        const phase = resolveRetryPhase({
            responseType: 'friendClosedResponse',
            interactiveVideoUrl: 'clip',
        });
        expect(phase).toBe('interactiveVideo+friendClosedResponse');
        expect(phase).not.toBe('interactiveVideo-decisionTime-friendClosedResponse');
        expect(phase).not.toBe('interactiveVideo+closedResponse');
    });

    it('keeps every other response type on the recording screen', () => {
        expect(resolveRetryPhase({ responseType: 'closedResponse', simpleVideoUrl: 'clip' })).toBe(MIC_RETRY_PHASE);
        expect(resolveRetryPhase({ responseType: 'openResponse', interactiveVideoUrl: 'clip' })).toBe(MIC_RETRY_PHASE);
        expect(resolveRetryPhase({ responseType: 'closedResponse' })).toBe(MIC_RETRY_PHASE);
    });

    it('keeps a video-less friendClosedResponse step (closing lesson) on the recording screen', () => {
        // There is no clip, so no decision screen exists: the recording screen
        // is already the preview screen for that step.
        expect(resolveRetryPhase({ responseType: 'friendClosedResponse' })).toBe(MIC_RETRY_PHASE);
    });

    it('tolerates a missing step', () => {
        expect(resolveRetryPhase(undefined)).toBe(MIC_RETRY_PHASE);
    });
});
