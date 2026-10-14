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
import { STANDALONE_DISPLAY_MODE_QUERY, toInstallLocale } from './install-prompt-logic.js';

let installElement = null;

/** Register the mounted `<pwa-install>` element (called by PWAInstallDialog). */
export function registerInstallElement(element) {
    installElement = element || null;
}

/** The mounted `<pwa-install>` element, or null before the layout mounts it. */
export function getRegisteredInstallElement() {
    return installElement;
}

// The library stashes the one-shot `beforeinstallprompt` on window under this
// (misspelled) key, and every element's connect() clears it. A language-change
// remount would therefore destroy the captured install prompt with no recovery —
// the browser fires it once per page load. Verified against the 0.7.0 bundle
// (connect() assigns null; disconnectedCallback does not touch it); if a future
// version renames the key or wipes on disconnect, the worst case is today's
// behaviour (prompt lost), never a crash.
export const DEFERRED_PROMPT_KEY = 'defferedPromptEvent';

/**
 * Run `fn` with the stashed install prompt preserved: whatever `fn` (or the
 * library code it triggers) writes to the key is undone afterwards, so a dialog
 * lifecycle operation can neither destroy a captured prompt nor leave an empty
 * key behind.
 */
function preservingDeferredPrompt(fn) {
    const hadPrompt = Object.prototype.hasOwnProperty.call(window, DEFERRED_PROMPT_KEY);
    const prompt = window[DEFERRED_PROMPT_KEY];
    try {
        return fn();
    } finally {
        try {
            if (hadPrompt) {
                window[DEFERRED_PROMPT_KEY] = prompt;
            } else {
                delete window[DEFERRED_PROMPT_KEY];
            }
        } catch (err) {
            console.error('[PWA] Failed to restore the deferred install prompt:', err);
        }
    }
}

/**
 * Mount a `<pwa-install>` element that speaks the app's UI language.
 *
 * The component has no locale prop: it reads `navigator.language` once,
 * synchronously, inside `connectedCallback` (verified against the 0.7.0 bundle —
 * a single call site, static in-bundle locale map). So this shadows
 * `navigator.language` with the app locale for exactly the synchronous mount
 * window and restores it in `finally`: single-threaded JS means nothing else
 * can observe the spoofed value in between. The stashed install prompt (above)
 * is preserved across the same window, since the wipe also happens
 * synchronously inside `connect()`.
 *
 * Fail-open throughout: if the property cannot be shadowed, the element mounts
 * unspoofed (browser language, today's behaviour); if mounting itself throws,
 * null is returned and nothing is registered.
 *
 * @param {Element} host node to append the element to
 * @param {{ lang?: unknown }} [options] the app UI language
 * @returns the mounted element, or null
 */
export function mountInstallElement(host, { lang } = {}) {
    if (!host || typeof document === 'undefined' || typeof window === 'undefined') {
        console.error('[PWA] Cannot mount the install dialog without a host element.');
        return null;
    }
    const locale = toInstallLocale(lang);

    const ownDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'language');
    let spoofed = false;
    try {
        Object.defineProperty(window.navigator, 'language', { value: locale, configurable: true });
        spoofed = true;
    } catch (err) {
        console.error('[PWA] Could not set the install dialog language:', err);
    }
    try {
        return preservingDeferredPrompt(() => {
            const element = document.createElement('pwa-install');
            // Manual mode: the dialog never opens by itself (the app already shows
            // the guest modal, and an auto-opening overlay would intercept clicks in
            // tests). `use-local-storage` makes a dismissal stick.
            element.setAttribute('manual-apple', 'true');
            element.setAttribute('manual-chrome', 'true');
            element.setAttribute('use-local-storage', 'true');
            element.setAttribute('manifest-url', '/manifest.webmanifest');
            host.appendChild(element);
            registerInstallElement(element);
            return element;
        });
    } catch (err) {
        console.error('[PWA] Failed to mount the install dialog:', err);
        return null;
    } finally {
        if (spoofed) {
            try {
                if (ownDescriptor) {
                    Object.defineProperty(window.navigator, 'language', ownDescriptor);
                } else {
                    delete window.navigator.language;
                }
            } catch (err) {
                console.error('[PWA] Failed to restore navigator.language:', err);
            }
        }
    }
}

/**
 * Snapshot what native install paths are live right now. `navigator.install`
 * is the Web Install API (same feature check the library itself uses);
 * `window[DEFERRED_PROMPT_KEY]` is the captured `beforeinstallprompt`, which
 * the browser fires once per page load. Any failure reads as "no native path"
 * so the caller falls back to the dialog.
 */
export function readNativeInstallAvailability() {
    const unavailable = { isAndroid: false, hasWebInstall: false, hasDeferredPrompt: false };
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return unavailable;
    try {
        return {
            // Same test the library uses for its Android branches.
            isAndroid: /android/i.test(navigator.userAgent || ''),
            hasWebInstall: typeof navigator.install === 'function',
            hasDeferredPrompt: !!window[DEFERRED_PROMPT_KEY],
        };
    } catch (err) {
        console.error('[PWA] Failed to read the native install state:', err);
        return unavailable;
    }
}

/**
 * Invoke the system install UI directly, skipping the library dialog.
 *
 * Returns true when the native flow was invoked — success, user dismissal and
 * abort are all terminal for this tap, so the caller must NOT fall back to the
 * dialog (that would nag right after a dismissal). Returns false only when the
 * flow could not run at all (missing element/method, or a technical throw),
 * in which case the caller falls back to opening the dialog.
 */
export async function installDirectly(element) {
    if (!element || typeof element.install !== 'function') return false;
    try {
        await element.install();
        return true;
    } catch (err) {
        // Dismissing the native sheet aborts the request: respect it silently.
        if (err && err.name === 'AbortError') return true;
        console.error('[PWA] Direct install failed:', err);
        return false;
    }
}

/** Remove an element mounted by `mountInstallElement` and unregister it. */
export function unmountInstallElement(element) {
    if (getRegisteredInstallElement() === element) registerInstallElement(null);
    // Guard the removal the same way: a future bundle version that wipes the
    // prompt on disconnect must not destroy it here either.
    try {
        preservingDeferredPrompt(() => {
            if (element && typeof element.remove === 'function') element.remove();
        });
    } catch (err) {
        console.error('[PWA] Failed to remove the install dialog:', err);
    }
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
