// modules/auth/turnstile-logic.js — Cloudflare Turnstile signup gate.
//
// Pure logic: no React, no DOM. The widget itself is rendered by
// components/auth/TurnstileCaptcha.web.jsx and the server-side siteverify call
// lives in functions/api/turnstile-verify.js; this module is the contract that
// both sides share (site key, action name, verify call).
//
// The site key is PUBLIC by design — it ships in the client bundle exactly like
// SUPABASE_ANON_KEY. The secret (TURNSTILE_SECRET) never leaves the Pages
// Function, and the browser never calls siteverify directly.

export const TURNSTILE_SCRIPT_URL =
    'https://challenges.cloudflare.com/turnstile/v0/api.js';

export const TURNSTILE_VERIFY_PATH = '/api/turnstile-verify';

// Must match `data-action` on the widget and the `TURNSTILE_ACTION` the Function
// checks. 1-32 chars of letters, digits, underscore or hyphen.
export const TURNSTILE_ACTION = 'signup';

// Committed default so a local dev server with no env file still renders the
// widget. Overridable at build time with VITE_TURNSTILE_SITE_KEY, matching the
// VITE_* convention used for the Supabase and PostHog keys.
export const DEFAULT_TURNSTILE_SITE_KEY = '0x4AAAAAAFYNEwvCsQrVybEB';

export function getTurnstileSiteKey() {
    const key = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    return typeof key === 'string' && key.trim() ? key.trim() : DEFAULT_TURNSTILE_SITE_KEY;
}

export function isTurnstileEnabled() {
    return getTurnstileSiteKey().length > 0;
}

/**
 * Exchange a widget token for a server-side verdict.
 *
 * Returns true ONLY when the Pages Function verified the token (success,
 * expected action and an allowed hostname all matched). Never throws — a
 * network failure or a 500 counts as a failed verification rather than an
 * error, so the caller can surface one consistent message.
 */
export async function verifyTurnstileToken(token) {
    if (typeof token !== 'string' || token.trim().length === 0) return false;
    try {
        const res = await fetch(TURNSTILE_VERIFY_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: token.trim() }),
        });
        if (!res.ok) {
            console.error(`[Turnstile] verify endpoint returned ${res.status}`);
            return false;
        }
        const data = await res.json();
        return data?.ok === true;
    } catch (e) {
        console.error('[Turnstile] verification request failed:', e?.message || e);
        return false;
    }
}
