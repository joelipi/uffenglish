// after-video-logic.js
// Pure decisions for the display-only after-video loop (aftersuccess / aftershare).
// No React, no DOM, no React Native imports — same portability rule as
// video-processor-logic.js. The web-only playback controller
// (after-video-player.web.js) consumes these helpers; components only render.
import { normalizeLanguageCode } from '../utils/utils.js';
import { resolveConfigLanguage } from '../bilingual/config-normalizer.js';
import { getVideoUrl } from './video-url.js';

// Hardcoded tail videos, played after the concatenated recap is ready. They are
// display-only (the recorder is already stopped) and never enter the shared
// blob. `aftersuccess` loops once the recap is ready; `aftershare` replaces it
// when the learner taps Share.
export const AFTER_SUCCESS_BASE = 'aftersuccess';
export const AFTER_SHARE_BASE = 'aftershare';

// The loop is a background reminder: it must never pause itself when the tab
// loses visibility. Pausing is only ever user-initiated (tap) or
// lifecycle-initiated (navigation / success-screen reset).
export const KEEP_PLAYING_ON_HIDDEN = true;

/**
 * Ordered candidate slugs for an after-video base, most specific first.
 * Mirrors the recap header banner rule: guest language wins, English is the
 * fallback, and the bare base is the last resort (so the two stand-in objects
 * cover every language until localized recordings are uploaded).
 *
 * @param {string} base - AFTER_SUCCESS_BASE | AFTER_SHARE_BASE
 * @param {string|null|undefined} guestLang - appStore.guestNativeLanguage
 * @param {string|null|undefined} profileLang - userData.native_language
 * @returns {string[]} deduped slugs, e.g. ['aftersuccess-es','aftersuccess-en','aftersuccess']
 */
export function resolveAfterVideoSlugs(base, guestLang, profileLang) {
    const lang = normalizeLanguageCode(resolveConfigLanguage(guestLang, profileLang));
    const slugs = [`${base}-${lang}`];
    if (lang !== 'en') slugs.push(`${base}-en`);
    slugs.push(base);
    return [...new Set(slugs)];
}

/**
 * Candidate playback URLs in the same preference order. URL construction is
 * single-sourced in getVideoUrl (dev proxy vs prod R2 CDN) — never rebuilt here.
 */
export function buildAfterVideoUrls(base, guestLang, profileLang) {
    return resolveAfterVideoSlugs(base, guestLang, profileLang).map(getVideoUrl);
}

/**
 * Whether the loop may auto-pause when the tab is hidden. Always false: the
 * reminder keeps audio going where the OS permits (best-effort — some OS
 * builds suspend background tabs regardless of page code).
 */
export function shouldAutoPauseOnHidden() {
    return false;
}
