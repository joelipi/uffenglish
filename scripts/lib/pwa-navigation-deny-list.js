// scripts/lib/pwa-navigation-deny-list.js
// Pure rule for the navigations the generated service worker must NOT answer
// from the cached SPA shell. `vite.config.js` passes this array straight to
// Workbox's `navigateFallbackDenylist`; `pwa-navigation-deny-list.test.js`
// asserts the behaviour for real URLs rather than the config text, so a rule
// that only names an unreachable URL cannot pass (the "a guard must be able to
// fail" lesson in AGENTS.md).
//
// Cloudflare Pages serves `public/<name>.html` at its **extensionless** path
// (`public/recorder.html` -> `/recorder`, `public/landing.html` -> `/landing`)
// and 308-redirects the `.html` form to it. So each standalone page needs BOTH
// forms denied: denying only the `.html` form leaves the extensionless path
// answered by the shell, and denying only the extensionless form lets the
// browser follow the 308 back into an un-denyied navigation.
//
// No `$` anchor on the path: Workbox matches the denylist against
// `url.pathname + url.search`, so a query string must still be denied.
export const PWA_NAVIGATION_DENY_LIST = [
    // Operator-only studio (source-guarded page) and the legacy static landing:
    // real HTML documents, never the SPA shell.
    /^\/recorder(\.html)?(\?|$)/,
    /^\/landing(\.html)?(\?|$)/,
    // Defence in depth: these are never `mode === 'navigate'` requests, so
    // Workbox would not match them anyway, but an accidental navigation must
    // not be answered with the shell either.
    /^\/api\//,
    /^\/assets\//,
    /^\/whisper\//,
];

/**
 * Whether Workbox's navigation route must refuse this navigation, i.e. whether
 * the real page is answered by the network instead of the precached shell.
 *
 * @param {string} pathnameAndSearch `url.pathname + url.search`, as Workbox matches it
 * @returns {boolean}
 */
export function matchesPwaNavigationDenyList(pathnameAndSearch) {
    if (typeof pathnameAndSearch !== 'string' || pathnameAndSearch === '') return false;
    return PWA_NAVIGATION_DENY_LIST.some((pattern) => pattern.test(pathnameAndSearch));
}
