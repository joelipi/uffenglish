// functions/api/welcome-email.js
// Cloudflare Pages Function — sends the non-blocking "confirm your email"
// welcome email after a Supabase signup.
//
// IMPORTANT: this never blocks signup. The SPA calls it fire-and-forget after
// the account already exists and the user is signed in (Supabase email
// confirmations stay OFF, so signUp still returns a session). The Function
// returns 200 with `sent:false` for every non-critical failure (email provider
// not configured, provider error) so a broken email can never surface as a
// signup failure. It only 401s when the caller is not an authenticated user —
// that protects the endpoint from being used to spam arbitrary addresses.
//
// Flow:
//   1. Verify the caller's Supabase JWT.
//   2. Mint a 32-byte random token; store only its SHA-256 hex in
//      email_confirm_tokens with the service-role key (the table is granted to
//      nobody else, so a user cannot mint their own token and self-confirm).
//   3. Email a link to /confirm-email?token=<raw>. The confirm page hashes the
//      token and calls the anon confirm_email_hash() RPC (migration 006).

import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY } from '../../src/modules/api/supabase-constants.js';

export const TOKEN_BYTES = 32;
export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const EMAIL_SUBJECT = 'Confirm your email address';
export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const HEX_PATTERN = /^[0-9a-f]{64}$/;

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

/** Random 32-byte token as lowercase hex (64 chars). */
export function generateToken() {
    const bytes = new Uint8Array(TOKEN_BYTES);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex of a token — the only form of the token ever persisted. */
export async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isConfirmToken(token) {
    return typeof token === 'string' && HEX_PATTERN.test(token);
}

/** Absolute confirmation URL built from the configured SITE_URL (or fallback). */
export function buildConfirmUrl(siteUrl, token) {
    const base = String(siteUrl || '').replace(/\/+$/, '');
    return `${base}/confirm-email?token=${token}`;
}

export function buildEmailHtml(confirmUrl) {
    return (
        '<h2>Welcome to Ultrafast Fluency!</h2>' +
        '<p>Your account is ready to use — no confirmation needed to keep practising.</p>' +
        '<p>Click the button below to confirm this email address so we know we can reach you ' +
        '(for example, to reset your password or send your progress):</p>' +
        `<p><a href="${confirmUrl}" ` +
        'style="display:inline-block;padding:12px 24px;background:#ffd400;color:#111;' +
        'text-decoration:none;border-radius:6px;font-weight:bold">Confirm my email</a></p>' +
        '<p>If you did not create an Ultrafast Fluency account, you can ignore this email.</p>'
    );
}

export function buildEmailText(confirmUrl) {
    return (
        'Welcome to Ultrafast Fluency!\n\n' +
        'Your account is ready to use — no confirmation needed to keep practising.\n\n' +
        'Confirm your email address so we can reach you (for example, to reset your ' +
        `password):\n${confirmUrl}\n\n` +
        'If you did not create an Ultrafast Fluency account, you can ignore this email.'
    );
}

/** Verify the Bearer JWT against Supabase GoTrue and return the user, or null. */
export async function verifyUser(request, supabaseUrl, anonKey) {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return null;
    try {
        const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return null;
        const user = await res.json();
        return user && user.id ? user : null;
    } catch {
        return null;
    }
}

/** Replace any outstanding token for this user with the new hash. */
export async function storeToken({ supabaseUrl, serviceKey, hash, userId, email, expiresAt }) {
    const headers = {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
    };
    const del = await fetch(
        `${supabaseUrl}/rest/v1/email_confirm_tokens?user_id=eq.${encodeURIComponent(userId)}`,
        { method: 'DELETE', headers }
    );
    if (!del.ok) return false;
    const ins = await fetch(`${supabaseUrl}/rest/v1/email_confirm_tokens`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify([{ token_hash: hash, user_id: userId, email, expires_at: expiresAt }]),
    });
    return ins.ok;
}

export async function onRequestPost({ request, env }) {
    const supabaseUrl = env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
    const anonKey = env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

    const user = await verifyUser(request, supabaseUrl, anonKey);
    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    if (!user.email) {
        return jsonResponse({ sent: false, reason: 'no-email' });
    }

    // Non-blocking by design: without a provider key we skip sending rather
    // than fail the caller. RESEND_API_KEY is a Pages secret (dashboard).
    if (!env.RESEND_API_KEY) {
        console.warn('[welcome-email] RESEND_API_KEY unset — skipping send');
        return jsonResponse({ sent: false, reason: 'email-not-configured' });
    }
    // Tokens are written with the service role so a user cannot mint their own
    // and self-confirm (migration 006 grants the table to nobody else).
    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
        console.warn('[welcome-email] SUPABASE_SERVICE_ROLE_KEY unset — skipping send');
        return jsonResponse({ sent: false, reason: 'store-not-configured' });
    }

    const token = generateToken();
    const hash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

    const stored = await storeToken({
        supabaseUrl,
        serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
        hash,
        userId: user.id,
        email: user.email,
        expiresAt,
    });
    if (!stored) {
        console.error('[welcome-email] failed to persist confirmation token');
        return jsonResponse({ sent: false, reason: 'store-failed' });
    }

    // Prefer the configured origin over the caller-supplied Origin header, so a
    // signed-in caller cannot make the email carry a link to a domain they
    // control. Set SITE_URL per environment (staging should override it).
    const siteUrl =
        env.SITE_URL || request.headers.get('Origin') || new URL(request.url).origin;
    const confirmUrl = buildConfirmUrl(siteUrl, token);
    const from = env.EMAIL_FROM || 'Ultrafast Fluency <onboarding@resend.dev>';

    try {
        const res = await fetch(RESEND_ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${env.RESEND_API_KEY}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                from,
                to: [user.email],
                subject: EMAIL_SUBJECT,
                html: buildEmailHtml(confirmUrl),
                text: buildEmailText(confirmUrl),
            }),
        });
        if (!res.ok) {
            console.error(`[welcome-email] Resend responded ${res.status}`);
            return jsonResponse({ sent: false, reason: `provider-${res.status}` });
        }
    } catch (e) {
        console.error('[welcome-email] Resend request failed:', e?.message);
        return jsonResponse({ sent: false, reason: 'provider-error' });
    }

    return jsonResponse({ sent: true });
}
