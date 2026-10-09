import { describe, it, expect } from 'vitest';
import { shouldTrackHesitation } from './hesitation-logic.js';

describe('shouldTrackHesitation', () => {
    it('tracks hesitation for a normal closedResponse step', () => {
        expect(shouldTrackHesitation({ responseType: 'closedResponse' })).toBe(true);
    });

    it('tracks hesitation for an openResponse step', () => {
        expect(shouldTrackHesitation({ responseType: 'openResponse', recapOverlay: 'fluency' })).toBe(true);
    });

    it('skips hesitation on a shareCta (friend-challenge) lesson', () => {
        expect(shouldTrackHesitation({ responseType: 'closedResponse', recapOverlay: 'shareCta' })).toBe(false);
    });

    it('skips hesitation on a friendClosedResponse step even without the lesson flag', () => {
        expect(shouldTrackHesitation({ responseType: 'friendClosedResponse' })).toBe(false);
    });

    it('defaults to tracking when given no step', () => {
        expect(shouldTrackHesitation()).toBe(true);
        expect(shouldTrackHesitation({})).toBe(true);
    });
});
