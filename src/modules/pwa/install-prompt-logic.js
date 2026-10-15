// modules/pwa/install-prompt-logic.js
// Pure rules for the app's install affordance, which is driven by the
// `@khmyznikov/pwa-install` dialog. No React, DOM or window access here, so the
// rules stay unit-testable without a browser and are portable to the React
// Native build (which has no install dialog).

// The standard media query that reports an app already running as an installed
// PWA (Chromium/Android/desktop). iOS Safari has no display-mode support for
// installed home-screen apps and exposes `navigator.standalone` instead — the
// caller supplies both flags.
export const STANDALONE_DISPLAY_MODE_QUERY = '(display-mode: standalone)';

/**
 * Apple platforms (iPhone/iPad/iPod, or iPadOS reporting "MacIntel" with
 * touch points, or desktop Mac) use "Add to Home Screen" wording: iOS has no
 * install prompt — the app is added from the Share sheet — and Mac users meet
 * the same phrase in Safari. Every other platform keeps "Install app".
 *
 * Mirrors the iPadOS rule in `modules/utils/orientation.js#isMobileUserAgent`
 * (same UA/platform/maxTouchPoints inputs) plus the desktop-Mac branch.
 */
export function isApplePlatform({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
    const ua = String(userAgent || '');
    const plat = String(platform || '');
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    if (/Mac/.test(ua) || plat === 'MacIntel') return true;
    if (/^iPad|iPhone|iPod/.test(plat)) return true;
    return false;
}

/**
 * Strings key for the install entry-point label: the Apple "Add to Home
 * Screen" wording on Apple platforms, the generic "Install app" elsewhere.
 */
export function selectInstallCtaKey({ isApple = false } = {}) {
    return isApple ? 'pwa_install_cta_apple' : 'pwa_install_cta';
}

/**
 * Strings key for the install banner body: the Apple "Home Screen" wording
 * on Apple platforms, the generic "Install this app" wording elsewhere.
 */
export function selectInstallBannerBodyKey({ isApple = false } = {}) {
    return isApple ? 'pwa_banner_body_apple' : 'pwa_banner_body_install';
}

/**
 * Should the install banner show? Only for signed-in, non-guest users who
 * are NOT already running the installed PWA. Guests never see install
 * affordances; installed users get the notification prompt instead.
 *
 * @param {{ isStandalone?: boolean, userId?: string|null }} [context]
 */
export function shouldShowInstallBanner({ isStandalone = false, userId = null } = {}) {
    if (isStandalone) return false;
    if (!userId || userId === 'guest') return false;
    return true;
}

/**
 * Should the app offer an "Install app" entry point?
 *
 * An app that is already running as an installed (standalone) PWA must not
 * offer to install itself again. Every other context shows the entry point —
 * the dialog itself decides whether the current browser has an install path
 * (native prompt, Web Install API, or platform instructions).
 *
 * @param {{ isStandalone?: boolean }} [context]
 * @returns {boolean}
 */
export function shouldOfferInstall({ isStandalone = false } = {}) {
    return !isStandalone;
}

/**
 * Open the install dialog owned by a `<pwa-install>` element.
 *
 * Fail-open: returns `false` instead of throwing when the element is missing,
 * not upgraded yet (`showDialog` absent), or its implementation throws, so a
 * broken install dialog can never break the menu it was opened from.
 *
 * @param {unknown} element the `<pwa-install>` element (or null)
 * @param {{ force?: boolean }} [options] `force` shows the dialog even when the
 *   component does not consider an install available
 * @returns {boolean} whether the dialog was asked to open
 */
export function openInstallDialog(element, { force = false } = {}) {
    if (!element || typeof element.showDialog !== 'function') return false;
    try {
        element.showDialog(force);
        return true;
    } catch (err) {
        console.error('[PWA] Failed to open the install dialog:', err);
        return false;
    }
}
