// @web-only
// Intentional window access — guarded by typeof window === 'undefined' check.
// In React Native window is undefined → the canonical apex is used.
//
// The origin the page is being served from. An IN-APP link must stay on it:
// the profile's course/lesson links used to be hard-coded to the apex
// (SHARE_URL_BASE), so a visitor on www / staging / a preview — or inside a
// webview wrapper, which refuses a cross-origin navigation outright — was
// navigated OFF the host they were on by every click. The wrapper then shows its
// own error page ("This site can't be reached", ERR_FAILED) for the URL it was
// asked to load.
import { SHARE_URL_BASE } from '../video/video-processor-logic.js';

/**
 * The current page's origin, e.g. `https://ultrafastfluency.com`.
 *
 * @param {Window|{location?: {origin?: string}}} [win] - injectable for tests
 * @returns {string} the origin, or the canonical apex when there is none
 *   (`file://` pages report the string "null" for `location.origin`).
 */
export function currentSiteOrigin(win = typeof window !== 'undefined' ? window : undefined) {
    const origin = win?.location?.origin;
    if (typeof origin === 'string' && origin && origin !== 'null') return origin;
    return `https://${SHARE_URL_BASE}`;
}
