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
