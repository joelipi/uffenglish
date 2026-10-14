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
 * Map the app's UI language to a locale the `<pwa-install>` dialog understands.
 *
 * The component localizes itself from `navigator.language` and ships es/pt/fr
 * (plus en) — but NOT hi/bn, which fall back to English inside the component.
 * The app's language codes are uppercase (`EN`/`ES`/…) with an `OTHER` sentinel
 * for "continue without translations"; both are normalized here. Anything the
 * dialog does not translate resolves to `'en'`, matching the component's own
 * fallback, so the result is deterministic rather than browser-dependent.
 *
 * @param {unknown} lang the app UI language (HomeScreen's `lang`)
 * @returns {'en'|'es'|'pt'|'fr'}
 */
export function toInstallLocale(lang) {
    const code = (typeof lang === 'string' ? lang : '').split(/[-_]/)[0].trim().toLowerCase();
    if (code === 'es' || code === 'pt' || code === 'fr') return code;
    return 'en';
}

/**
 * Should tapping Install go straight to the system install UI?
 *
 * Android-only, and only when a native path is live right now: the Web Install
 * API (`navigator.install`) or a captured `beforeinstallprompt` (which the
 * dialog element holds for the sender to read). Otherwise the tap falls
 * back to opening the dialog (instructions/how-to), exactly as before.
 *
 * Rationale: on Android the library sheet and the system sheet look near
 * identical (icon, name, origin, Install) and lead to the same place, so the
 * intermediate sheet is a pure extra step once the user has already tapped
 * Install. iOS has no native prompt API at all (instructions only) and desktop
 * keeps the existing dialog flow — both deliberately out of scope.
 *
 * @param {{ isAndroid?: boolean, hasWebInstall?: boolean, hasDeferredPrompt?: boolean }} [context]
 * @returns {boolean}
 */
export function shouldUseNativeInstall({ isAndroid = false, hasWebInstall = false, hasDeferredPrompt = false } = {}) {
    return !!(isAndroid && (hasWebInstall || hasDeferredPrompt));
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
