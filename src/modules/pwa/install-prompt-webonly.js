// @web-only
// Browser-only plumbing for the install affordance. Two responsibilities:
//
// 1. Read whether the app is already installed (standalone display mode, or
//    iOS Safari's `navigator.standalone`) so the UI can hide the entry point.
// 2. Bridge the `<pwa-install>` dialog element to its trigger button. The dialog
//    is mounted once in the layout (RootLayout) while the trigger lives in the
//    home menu — a different subtree that unmounts when the menu closes — so
//    the element is registered here instead of being reached for through the
//    DOM.
//
// Intentional window/navigator access, guarded by `typeof window`.
import { STANDALONE_DISPLAY_MODE_QUERY } from './install-prompt-logic.js';

let installElement = null;

/** Register the mounted `<pwa-install>` element (called by PWAInstallDialog). */
export function registerInstallElement(element) {
    installElement = element || null;
}

/** The mounted `<pwa-install>` element, or null before the layout mounts it. */
export function getRegisteredInstallElement() {
    return installElement;
}

/**
 * True when the app is already running as an installed PWA: the standalone
 * display mode (Chromium/Android/desktop) or iOS Safari's `navigator.standalone`
 * flag. Any failure (no window, no matchMedia) reads as "not installed" so the
 * entry point stays visible rather than disappearing for a capable browser.
 */
export function readIsStandaloneApp() {
    if (typeof window === 'undefined') return false;
    try {
        if (typeof window.matchMedia === 'function'
            && window.matchMedia(STANDALONE_DISPLAY_MODE_QUERY).matches) {
            return true;
        }
        return window.navigator?.standalone === true;
    } catch (err) {
        console.error('[PWA] Failed to read the standalone display mode:', err);
        return false;
    }
}
