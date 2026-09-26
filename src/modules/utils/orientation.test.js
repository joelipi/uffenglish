import { describe, it, expect } from 'vitest';
import { isLandscape, isMobileUserAgent, shouldWarnLandscape } from './orientation.js';

describe('isLandscape', () => {
    it('is true when wider than tall', () => {
        expect(isLandscape(844, 390)).toBe(true);
    });

    it('is false in portrait', () => {
        expect(isLandscape(390, 844)).toBe(false);
    });

    it('is false for a square viewport', () => {
        expect(isLandscape(844, 844)).toBe(false);
    });

    it('is false for unknown / non-finite dimensions', () => {
        expect(isLandscape(undefined, 390)).toBe(false);
        expect(isLandscape(844, NaN)).toBe(false);
        expect(isLandscape(null, null)).toBe(false);
    });
});

describe('isMobileUserAgent', () => {
    it('detects an iPhone', () => {
        expect(
            isMobileUserAgent({
                userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
            })
        ).toBe(true);
    });

    it('detects an Android device', () => {
        expect(
            isMobileUserAgent({ userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7)' })
        ).toBe(true);
    });

    it('detects iPadOS reporting as MacIntel with touch points', () => {
        expect(
            isMobileUserAgent({ userAgent: '', platform: 'MacIntel', maxTouchPoints: 5 })
        ).toBe(true);
    });

    it('does not treat a desktop Mac as mobile', () => {
        expect(
            isMobileUserAgent({
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                platform: 'MacIntel',
                maxTouchPoints: 0,
            })
        ).toBe(false);
    });

    it('does not treat Windows as mobile', () => {
        expect(
            isMobileUserAgent({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
        ).toBe(false);
    });

    it('does not throw on empty input', () => {
        expect(isMobileUserAgent()).toBe(false);
        expect(isMobileUserAgent({})).toBe(false);
    });
});

describe('shouldWarnLandscape', () => {
    it('warns on mobile landscape', () => {
        expect(shouldWarnLandscape({ isMobile: true, landscape: true })).toBe(true);
    });

    it('does not warn on mobile portrait', () => {
        expect(shouldWarnLandscape({ isMobile: true, landscape: false })).toBe(false);
    });

    it('does not warn on desktop landscape', () => {
        expect(shouldWarnLandscape({ isMobile: false, landscape: true })).toBe(false);
    });

    it('does not warn on empty input', () => {
        expect(shouldWarnLandscape()).toBe(false);
    });
});
