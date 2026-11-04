// modules/user/auth-redirect-logic.js
// Resolves the SPA URL a Supabase auth email redirects to after GoTrue verifies
// the token (the `redirect_to` of the verify link built in
// auth-email-content.js).
//
// Why this exists: GoTrue only honours the `redirectTo` the client sends when it
// is on the project's Redirect-URLs allow-list. Otherwise it falls back to the
// project's **Site URL**, and that was `http://localhost:3000` — so every
// password-reset email sent a link that opened the developer's machine and every
// learner saw "This site can't be reached" (2026-11 report: "the password reset
// email is giving people a localhost url in the link").
//
// The dashboard setting is the primary fix (SITE_URL / Redirect URLs), but the
// sender must also never EMAIL a loopback/private/relative target: a wrong
// setting would otherwise put `http://localhost:3000` in the inbox again. This
// module is the last line of defence, and it is pure so both the Send Email Hook
// and the tests share one rule.

/** The public site, used whenever no usable origin can be resolved. */
export const DEFAULT_SITE_URL = 'https://ultrafastfluency.com';

/** Path the app needs for an action that has no redirect target to copy. */
const ACTION_PATHS = {
    recovery: '/reset-password',
};

const LOOPBACK_HOSTS = new Set([
    'localhost',
    'localhost.localdomain',
    'ip6-localhost',
    'ip6-loopback',
    '::1',
]);

const PRIVATE_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

/** `new URL` wrapper that never throws. */
function parseUrl(value) {
    try {
        return new URL(String(value).trim());
    } catch {
        return null;
    }
}

/** True for a host a learner's browser cannot reach (loopback / private / LAN). */
export function isPrivateHostname(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return true;
    if (LOOPBACK_HOSTS.has(host)) return true;
    if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;

    // IPv4 loopback, "this network", private, link-local and CGNAT ranges.
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
        const [a, b] = ipv4.slice(1).map(Number);
        if (a === 0 || a === 10 || a === 127) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 169 && b === 254) return true;
        if (a === 100 && b >= 64 && b <= 127) return true;
        return false;
    }

    // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
    if (host.includes(':')) {
        return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80');
    }
    return false;
}

/**
 * True when `value` is an absolute http(s) URL a learner can actually open.
 * Relative paths and non-http schemes are rejected on purpose: both would end
 * up in the email as a link to somewhere that is not the app.
 */
export function isUsableRedirectUrl(value) {
    const url = parseUrl(value);
    if (!url) return false;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    return !isPrivateHostname(url.hostname);
}

/** Normalized public origin (no trailing slash), or DEFAULT_SITE_URL. */
export function resolveSiteOrigin(siteUrl) {
    const url = parseUrl(siteUrl);
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return DEFAULT_SITE_URL;
    if (isPrivateHostname(url.hostname)) return DEFAULT_SITE_URL;
    return `${url.protocol}//${url.host}`;
}

/** The path+query of a URL, but only when it is a real in-app path. */
function appPathOf(value) {
    const url = parseUrl(value);
    if (!url) return '';
    const path = url.pathname === '/' ? '' : url.pathname;
    if (path && !path.startsWith('/')) return '';
    return `${path}${url.search}`;
}

/**
 * The `redirect_to` an auth email must carry.
 *
 * A usable public target is returned untouched (staging and preview hosts keep
 * their own origin). Anything else — the localhost Site URL, a LAN address, a
 * relative path, a non-http scheme, or nothing at all — becomes the configured
 * site plus the path the flow needs (a local `/reset-password` keeps its path so
 * a dev hitting the production site still lands on the reset form).
 *
 * @param {object} args
 * @param {string} [args.redirectTo] - GoTrue's `email_data.redirect_to`.
 * @param {string} [args.siteUrl] - the server-configured site (env `SITE_URL`).
 * @param {string} [args.action] - Supabase `email_action_type`.
 * @returns {string} absolute http(s) URL
 */
export function resolveAuthEmailRedirectTo({ redirectTo, siteUrl, action } = {}) {
    const origin = resolveSiteOrigin(siteUrl);
    const target = String(redirectTo || '').trim();
    if (isUsableRedirectUrl(target)) return target;

    const path = appPathOf(target) || ACTION_PATHS[action] || '';
    return `${origin}${path}`;
}
