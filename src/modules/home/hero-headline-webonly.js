// @web-only
// Browser-only plumbing for the homepage hero headline. The rotating-word
// DECISION lives in the pure hero-headline-logic module; this file only reads
// the browser's motion preference and hands it over, so the renderer never
// touches `window` (see eslint's browser-only rule) and a native/SSR render can
// swap this module for a no-op.
//
// Intentional window access, guarded by `typeof window`.
import { readPrefersReducedMotion } from './hero-headline-logic.js';

/**
 * True when the visitor asked the browser to reduce motion. A missing or
 * throwing `matchMedia` (jsdom, an old browser) reads as "motion is welcome":
 * the headline is still readable while it animates and while it does not.
 *
 * @returns {boolean}
 */
export function readHeroReducedMotion() {
    if (typeof window === 'undefined') return false;
    try {
        if (typeof window.matchMedia !== 'function') return false;
        return readPrefersReducedMotion(window.matchMedia.bind(window));
    } catch (err) {
        console.error('[HeroHeadline] Failed to read the reduced-motion preference:', err);
        return false;
    }
}
