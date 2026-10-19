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
 * Apple platforms (iPhone/iPad/iPod UA, or a Mac UA / "MacIntel" platform,
 * which covers both iPadOS reporting as desktop and desktop Mac itself) use
 * "Add to Home Screen" wording: iOS has no install prompt — the app is added
 * from the Share sheet — and Mac users meet the same phrase in Safari. Every
 * other platform keeps "Install app".
 */
export function isApplePlatform({ userAgent = '', platform = '' } = {}) {
    const ua = String(userAgent || '');
    const plat = String(platform || '');
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    if (/Mac/.test(ua) || plat === 'MacIntel') return true;
    if (/^(iPad|iPhone|iPod)/.test(plat)) return true;
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
 * `force` MUST default to true here. The element renders the dialog only when
 * `isInstallAvailable && !isDialogHidden`, and `showDialog(false)` merely
 * clears `isDialogHidden` — it leaves `isInstallAvailable` false, so the
 * dialog keeps its `opacity: 0; visibility: hidden` base styles and NOTHING
 * appears. `showDialog(true)` is the library's own "show regardless" path: it
 * sets `isInstallAvailable = true`, which is what adds the `available` class
 * and makes the panel visible. Chrome only raises `beforeinstallprompt` after
 * its installability + engagement heuristics pass, so a user-initiated click
 * must not depend on that event having fired.
 *
 * @param {unknown} element the `<pwa-install>` element (or null)
 * @param {{ force?: boolean }} [options] `force` shows the dialog even when the
 *   component does not consider an install available
 * @returns {boolean} whether the dialog was asked to open
 */
export function openInstallDialog(element, { force = true } = {}) {
    if (!element || typeof element.showDialog !== 'function') return false;
    try {
        element.showDialog(force);
        return true;
    } catch (err) {
        console.error('[PWA] Failed to open the install dialog:', err);
        return false;
    }
}

/**
 * Run one install click: ask the library to install directly (so Android /
 * Chromium goes straight to the OS prompt) and fall back to opening its panel
 * whenever a direct install is impossible.
 *
 * Why the fallback exists: `install()` only reaches an OS prompt when a
 * backend exists — the Web Install API, or the `beforeinstallprompt` the
 * library retained (Chrome raises that only once its installability and
 * engagement heuristics pass). With no backend it dispatches
 * `pwa-install-fail-event` instead of installing, and Apple platforms have no
 * such API at all, so those clicks must show the instruction panel.
 *
 * Apple is detected from the element's own documented readonly properties
 * (`isAppleMobilePlatform` / `isAppleDesktopPlatform`) — on Apple the panel is
 * the product: `install()` would only flip it to a how-to view that is
 * invisible unless the panel is already shown.
 *
 * @param {unknown} element the `<pwa-install>` element (or null)
 * @param {{ force?: boolean }} [options] `force` shows the panel even when the
 *   component does not consider an install available
 * @returns {Promise<{ ok: boolean, route: 'install'|'panel'|'none', reason?: string }>}
 */
export function requestInstall(element, { force = true } = {}) {
    const isApple = !!(element
        && (element.isAppleMobilePlatform || element.isAppleDesktopPlatform));
    const canInstallDirectly = !isApple
        && !!element
        && typeof element.install === 'function'
        && typeof element.addEventListener === 'function';

    if (!canInstallDirectly) {
        const shown = openInstallDialog(element, { force });
        return Promise.resolve({
            ok: shown,
            route: shown ? 'panel' : 'none',
            reason: isApple ? 'apple-instructions' : 'no-install-method',
        });
    }

    // The element reports its outcome through documented events, not a return
    // value: `install()` resolves undefined either way.
    return new Promise((resolve) => {
        let settled = false;
        const cleanup = () => {
            element.removeEventListener('pwa-install-fail-event', onFail);
            element.removeEventListener('pwa-user-choice-result-event', onChoice);
        };
        const finish = (ok, route, reason) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ ok, route, reason });
        };
        const onFail = () => finish(openInstallDialog(element, { force }), 'panel', 'no-backend');
        const onChoice = () => finish(true, 'install');

        element.addEventListener('pwa-install-fail-event', onFail);
        element.addEventListener('pwa-user-choice-result-event', onChoice);

        try {
            // Must run inside the user gesture: the browser requires transient
            // activation for an install prompt.
            Promise.resolve(element.install()).catch((err) => {
                console.error('[PWA] Direct install request failed:', err);
                onFail();
            });
        } catch (err) {
            console.error('[PWA] Direct install request threw:', err);
            onFail();
        }
    });
}
