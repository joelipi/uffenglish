// modules/user/email-confirmation.js
// Client-side half of the non-blocking "click to confirm" flow.
//
// Signup must never wait on (or fail because of) email delivery, so
// sendWelcomeEmail() is fire-and-forget: it swallows every error and reports
// success only as a best-effort boolean. The actual send happens in
// functions/api/welcome-email.js with a Pages secret, never in the browser.

import { supabase, getAccessToken } from '../api/supabase.js';

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
export const WELCOME_EMAIL_ENDPOINT = '/api/welcome-email';

export function isValidConfirmToken(token) {
    return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/** SHA-256 hex of the raw token — must match functions/api/welcome-email.js. */
export async function hashConfirmToken(token) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Ask the server to email the signed-in user a confirmation link.
 * Never throws and never blocks signup; returns { sent, reason? }.
 */
export async function sendWelcomeEmail({
    fetchImpl = typeof fetch === 'function' ? fetch : null,
    endpoint = WELCOME_EMAIL_ENDPOINT,
} = {}) {
    try {
        if (!fetchImpl) return { sent: false, reason: 'no-fetch' };
        const token = await getAccessToken();
        if (!token) return { sent: false, reason: 'no-session' };
        const res = await fetchImpl(endpoint, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return { sent: false, reason: `http-${res.status}` };
        const body = await res.json().catch(() => ({}));
        return { sent: !!body.sent, reason: body.reason };
    } catch (e) {
        return { sent: false, reason: e?.message || 'error' };
    }
}

/**
 * Confirm a token from the email link by calling the anon confirm_email_hash
 * RPC with the token's SHA-256. Returns true only when the server confirmed it.
 */
export async function confirmEmailToken(token, { client = supabase } = {}) {
    if (!isValidConfirmToken(token)) return false;
    try {
        const hash = await hashConfirmToken(token);
        const { data, error } = await client.rpc('confirm_email_hash', { p_hash: hash });
        if (error) return false;
        return data === true;
    } catch {
        return false;
    }
}
