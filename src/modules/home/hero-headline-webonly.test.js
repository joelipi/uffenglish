import { describe, it, expect, vi, afterEach } from 'vitest';
import { readHeroReducedMotion } from './hero-headline-webonly.js';

// jsdom exposes no matchMedia, which is the same state as an old browser — the
// headline must then animate rather than disappear.
describe('readHeroReducedMotion', () => {
    afterEach(() => {
        delete window.matchMedia;
    });

    it('reads false when the browser exposes no matchMedia', () => {
        expect(typeof window.matchMedia).toBe('undefined');
        expect(readHeroReducedMotion()).toBe(false);
    });

    it('returns the browser verdict for the reduced-motion query', () => {
        window.matchMedia = vi.fn(() => ({ matches: true }));
        expect(readHeroReducedMotion()).toBe(true);
        expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');

        window.matchMedia = vi.fn(() => ({ matches: false }));
        expect(readHeroReducedMotion()).toBe(false);
    });

    it('reads as "motion is welcome" when matchMedia throws, and logs it', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        window.matchMedia = () => { throw new Error('media query exploded'); };
        expect(readHeroReducedMotion()).toBe(false);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });
});
