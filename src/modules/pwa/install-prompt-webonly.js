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
import { STANDALONE_DISPLAY_MODE_QUERY, isApplePlatform } from './install-prompt-logic.js';

let installElement = null;
let deferredInstallPrompt = null;

/** Register the mounted `<pwa-install>` element (called by PWAInstallDialog). */
export function registerInstallElement(element) {
    installElement = element || null;
}

/** The mounted `<pwa-install>` element, or null before the layout mounts it. */
export function getRegisteredInstallElement() {
    return installElement;
}

/**
 * Remember the browser's deferred `beforeinstallprompt` event so the app can
 * surface the OS-level install dialog (Android/Chromium) instead of the
 * small in-page drawer. Called from the `beforeinstallprompt` listener.
 */
export function registerBeforeInstallPromptEvent(event) {
    if (!event || typeof event.prompt !== 'function') {
        console.log('[PWA] registerBeforeInstallPromptEvent: not a valid event', event && Object.keys(event));
        return false;
    }
    try { event.preventDefault(); } catch (e) { /* ignore */ }
    deferredInstallPrompt = event;
    if (typeof window !== 'undefined') window.__uffDeferredPrompt = event;
    console.log('[PWA] beforeinstallprompt staged, platforms=', event.platforms);
    return true;
}

/** True when a native OS install prompt is available. */
export function hasNativeInstallPrompt() {
    return !!deferredInstallPrompt;
}

/**
 * Trigger the native OS install prompt (Android/Chromium only). Resolves to
 * the userChoice outcome, or null if no native prompt was staged. The stored
 * event can only be used once, so it is cleared after use.
 */
export async function triggerNativeInstallPrompt() {
    const e = deferredInstallPrompt;
    deferredInstallPrompt = null;
    if (!e || typeof e.prompt !== 'function') {
        console.log('[PWA] triggerNativeInstallPrompt: no staged event');
        return null;
    }
    try {
        console.log('[PWA] triggering native OS install prompt');
        e.prompt();
        const choice = await e.userChoice;
        return choice || null;
    } catch (err) {
        console.error('[PWA] Native install prompt failed:', err);
        return null;
    }
}

/**
 * Clear any staged native prompt (e.g., when the app becomes standalone).
 */
export function clearNativeInstallPrompt() {
    deferredInstallPrompt = null;
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

/**
 * True on Apple platforms (iPhone/iPad/Mac), where the install entry points
 * use the "Add to Home Screen" wording. Any failure reads as non-Apple so
 * the generic "Install app" wording shows rather than disappearing.
 */
export function readIsApplePlatform() {
    if (typeof window === 'undefined') return false;
    try {
        const nav = window.navigator || {};
        return isApplePlatform({ userAgent: nav.userAgent, platform: nav.platform });
    } catch (err) {
        console.error('[PWA] Failed to read the platform:', err);
        return false;
    }
}
