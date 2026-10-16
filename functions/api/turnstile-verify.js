// functions/api/turnstile-verify.js
// Cloudflare Pages Function — verifies a Turnstile token with the canonical
// siteverify call and gates the signup form on the verdict.
//
// The browser never calls siteverify directly: the SPA posts the widget token
// here and this Function proxies it to Cloudflare with TURNSTILE_SECRET (a
// Pages secret — it never reaches the client bundle).
//
// Requires all three before returning ok:true:
//   1. siteverify reports success
//   2. the action matches the surface's action (TURNSTILE_ACTION)
//   3. the solved hostname is on this deployment's allowlist
//
// The allowlist comes from TURNSTILE_HOSTNAMES in wrangler.toml [vars]
// (non-secret). It must NOT contain localhost/127.0.0.1 in production — the
// widget is registered for those hostnames, but a production backend must not
// trust a token solved there.

export const TURNSTILE_SITEVERIFY_URL =
    'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const TURNSTILE_ACTION = 'signup';

export const SITEVERIFY_TIMEOUT_MS = 10000;

// A Turnstile token is a bounded opaque string; anything longer is not one.
const MAX_TOKEN_LENGTH = 2048;

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

/** Hostnames whose tokens this deployment accepts, lowercased. */
export function allowedHostnames(env) {
    return String(env.TURNSTILE_HOSTNAMES || '')
        .split(',')
        .map((hostname) => hostname.trim().toLowerCase())
        .filter(Boolean);
}

/** Pull the token out of either a JSON or a form-encoded body. */
async function readToken(request) {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        const body = await request.json().catch(() => null);
        const token = body?.token ?? body?.['cf-turnstile-response'];
        return typeof token === 'string' ? token : '';
    }
    const form = await request.formData().catch(() => null);
    const token = form?.get('cf-turnstile-response') ?? form?.get('token');
    return typeof token === 'string' ? token : '';
}

export async function onRequestPost({ request, env }) {
    const token = await readToken(request);
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
        return jsonResponse({ ok: false, error: 'missing-token' }, 400);
    }

    // Fail closed. Without the secret — or without an allowlist — nothing can be
    // verified, so the request must not pass. Logged loudly so the
    // misconfiguration is visible in the Pages logs instead of silently
    // degrading signup into an open endpoint.
    if (!env.TURNSTILE_SECRET) {
        console.error('[turnstile-verify] TURNSTILE_SECRET is not set — rejecting signup');
        return jsonResponse({ ok: false, error: 'captcha-not-configured' }, 500);
    }
    const hostnames = allowedHostnames(env);
    if (hostnames.length === 0) {
        console.error('[turnstile-verify] TURNSTILE_HOSTNAMES is not set — rejecting signup');
        return jsonResponse({ ok: false, error: 'captcha-not-configured' }, 500);
    }

    const remoteip = request.headers.get('x-forwarded-for') || '';
    let result;
    try {
        const res = await fetch(TURNSTILE_SITEVERIFY_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
            body: new URLSearchParams({
                secret: env.TURNSTILE_SECRET,
                response: token,
                ...(remoteip ? { remoteip } : {}),
            }),
        });
        if (!res.ok) throw new Error(`siteverify ${res.status}`);
        result = await res.json();
    } catch (e) {
        console.error('[turnstile-verify] siteverify request failed:', e?.message || e);
        return jsonResponse({ ok: false, error: 'verification-failed' }, 403);
    }

    if (!result?.success) {
        console.warn('[turnstile-verify] siteverify rejected the token:', result?.['error-codes']);
        return jsonResponse({ ok: false, error: 'verification-failed' }, 403);
    }
    if (result.action !== TURNSTILE_ACTION) {
        console.warn('[turnstile-verify] action mismatch:', result.action);
        return jsonResponse({ ok: false, error: 'action-mismatch' }, 403);
    }
    const hostname = String(result.hostname || '').toLowerCase();
    if (!hostnames.includes(hostname)) {
        console.warn('[turnstile-verify] hostname not allowed:', hostname);
        return jsonResponse({ ok: false, error: 'hostname-not-allowed' }, 403);
    }

    return jsonResponse({ ok: true });
}
