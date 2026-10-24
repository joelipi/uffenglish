import { describe, it, expect } from 'vitest';
import { resolveRetryPhase, MIC_RETRY_PHASE } from './retry-phase-logic.js';

describe('resolveRetryPhase', () => {
    it('returns a friendClosedResponse simple-video step to its decision screen (Continue), not the mic', () => {
        expect(resolveRetryPhase({
            responseType: 'friendClosedResponse',
            simpleVideoUrl: 'wouldyourather-a-01-01',
        })).toBe('simpleVideo-decisionTime-response');
    });

    it('returns an interactive friendClosedResponse step to its own decision phase', () => {
        const phase = resolveRetryPhase({
            responseType: 'friendClosedResponse',
            interactiveVideoUrl: 'clip',
        });
        expect(phase).toBe('interactiveVideo-decisionTime-friendClosedResponse');
        // Its own phase, not the closedResponse one: the decision screen reads
        // the phase for its Continue label/icon.
        expect(phase).not.toBe('interactiveVideo-decisionTime-closedResponse');
    });

    it('keeps every other response type on the recording screen', () => {
        expect(resolveRetryPhase({ responseType: 'closedResponse', simpleVideoUrl: 'clip' })).toBe(MIC_RETRY_PHASE);
        expect(resolveRetryPhase({ responseType: 'openResponse', interactiveVideoUrl: 'clip' })).toBe(MIC_RETRY_PHASE);
        expect(resolveRetryPhase({ responseType: 'closedResponse' })).toBe(MIC_RETRY_PHASE);
    });

    it('keeps a video-less friendClosedResponse step (closing lesson) on the recording screen', () => {
        // There is no clip, so no decision overlay exists to return to: the
        // recording screen is already the preview screen for that step.
        expect(resolveRetryPhase({ responseType: 'friendClosedResponse' })).toBe(MIC_RETRY_PHASE);
    });

    it('tolerates a missing step', () => {
        expect(resolveRetryPhase(undefined)).toBe(MIC_RETRY_PHASE);
    });
});
