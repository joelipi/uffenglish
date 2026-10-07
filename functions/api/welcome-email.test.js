// Unit tests for /api/welcome-email. `fetch` is stubbed — no real GoTrue,
// PostgREST or Resend call is made. Also pins the non-blocking contract: a
// provider or storage failure must still return 200 with sent:false so the
// SPA's signup flow can never fail because of email.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    onRequestPost,
    generateToken,
    sha256Hex,
    isConfirmToken,
    buildConfirmUrl,
    TOKEN_BYTES,
} from './welcome-email.js';

function makeRequest({ jwt = 'jwt-123', origin = 'https://app.example', url = 'https://app.example/api/welcome-email' } = {}) {
    const headers = new Map();
    if (jwt !== null) headers.set('Authorization', `Bearer ${jwt}`);
    if (origin !== null) headers.set('Origin', origin);
    return {
        headers: { get: (name) => headers.get(name) ?? null },
        url,
    };
}

function makeEnv(overrides = {}) {
    return {
        RESEND_API_KEY: 're_test',
        EMAIL_FROM: 'UFF <welcome@uff.example>',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
        ...overrides,
    };
}

/** Route the stubbed fetch by URL and record calls. */
function installFetch({ userId = 'user-1', email = 'a@b.com', storeOk = true, resendOk = true } = {}) {
    const calls = [];
    const fetchStub = vi.fn(async (url, options = {}) => {
        calls.push({ url, options });
        if (url.endsWith('/auth/v1/user')) {
            return { ok: true, status: 200, json: async () => ({ id: userId, email }) };
        }
        if (url.includes('/rest/v1/email_confirm_tokens')) {
            return { ok: storeOk, status: storeOk ? 201 : 500, json: async () => [] };
        }
        if (url.includes('api.resend.com/emails')) {
            return { ok: resendOk, status: resendOk ? 200 : 422, json: async () => ({ id: 'email-1' }) };
        }
        throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchStub);
    return { calls, fetchStub };
}

describe('token helpers', () => {
    it('generates a 64-char lowercase hex token', () => {
        const token = generateToken();
        expect(token).toMatch(/^[0-9a-f]{64}$/);
        expect(TOKEN_BYTES).toBe(32);
        expect(isConfirmToken(token)).toBe(true);
    });

    it('rejects malformed tokens', () => {
        expect(isConfirmToken('')).toBe(false);
        expect(isConfirmToken('xyz')).toBe(false);
        expect(isConfirmToken('A'.repeat(64))).toBe(false);
        expect(isConfirmToken(null)).toBe(false);
    });

    it('hashes to a 64-char hex digest and is stable', async () => {
        const hash = await sha256Hex('abc');
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(await sha256Hex('abc')).toBe(hash);
        expect(hash).not.toBe(await sha256Hex('abd'));
    });

    it('builds the confirm URL without a trailing slash', () => {
        expect(buildConfirmUrl('https://app.example/', 'tok')).toBe('https://app.example/confirm-email?token=tok');
    });
});

describe('onRequestPost — welcome-email Function', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns 401 when the Authorization JWT is missing', async () => {
        const { fetchStub } = installFetch();
        const res = await onRequestPost({ request: makeRequest({ jwt: null }), env: makeEnv() });
        expect(res.status).toBe(401);
        expect(fetchStub).not.toHaveBeenCalled();
    });

    it('returns 401 for a rejected JWT', async () => {
        const fetchStub = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
        vi.stubGlobal('fetch', fetchStub);
        const res = await onRequestPost({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(401);
        expect(fetchStub).toHaveBeenCalledTimes(1);
    });

    it('is non-blocking: without RESEND_API_KEY it returns 200 sent:false and stores nothing', async () => {
        const { fetchStub } = installFetch();
        const res = await onRequestPost({ request: makeRequest(), env: makeEnv({ RESEND_API_KEY: undefined }) });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ sent: false, reason: 'email-not-configured' });
        // Only the JWT verification call happened — no token row, no email.
        expect(fetchStub).toHaveBeenCalledTimes(1);
    });

    it('stores a token hash and emails the raw token link on the happy path', async () => {
        const { calls } = installFetch();
        const res = await onRequestPost({ request: makeRequest({ origin: 'https://staging.example' }), env: makeEnv() });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ sent: true });

        const del = calls.find((c) => c.options.method === 'DELETE');
        const ins = calls.find((c) => c.url.endsWith('/rest/v1/email_confirm_tokens') && c.options.method === 'POST');
        expect(del).toBeTruthy();
        expect(del.url).toContain('user_id=eq.user-1');
        expect(ins).toBeTruthy();
        // Token rows are written with the service role, never the user's JWT.
        expect(del.options.headers.Authorization).toBe('Bearer service-key');
        expect(ins.options.headers.Authorization).toBe('Bearer service-key');

        const row = JSON.parse(ins.options.body)[0];
        expect(row.user_id).toBe('user-1');
        expect(row.email).toBe('a@b.com');
        expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now());

        const resend = calls.find((c) => c.url.includes('api.resend.com/emails'));
        expect(resend.options.headers.Authorization).toBe('Bearer re_test');
        const payload = JSON.parse(resend.options.body);
        expect(payload.from).toBe('UFF <welcome@uff.example>');
        expect(payload.to).toEqual(['a@b.com']);

        // The emailed token is the preimage of the stored hash.
        const url = payload.text.match(/https:\/\/staging\.example\/confirm-email\?token=[0-9a-f]{64}/)[0];
        const raw = url.split('token=')[1];
        expect(await sha256Hex(raw)).toBe(row.token_hash);
        // The raw token must never be written to the database.
        expect(ins.options.body).not.toContain(raw);
    });

    it('is non-blocking: without SUPABASE_SERVICE_ROLE_KEY it returns 200 sent:false and stores nothing', async () => {
        const { fetchStub } = installFetch();
        const res = await onRequestPost({
            request: makeRequest(),
            env: makeEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ sent: false, reason: 'store-not-configured' });
        // Only the JWT verification call happened — no token row, no email.
        expect(fetchStub).toHaveBeenCalledTimes(1);
    });

    it('is non-blocking: a provider error returns 200 sent:false', async () => {
        installFetch({ resendOk: false });
        const res = await onRequestPost({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ sent: false, reason: 'provider-422' });
    });

    it('is non-blocking: a token-store failure returns 200 sent:false and sends no email', async () => {
        const { calls } = installFetch({ storeOk: false });
        const res = await onRequestPost({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ sent: false, reason: 'store-failed' });
        expect(calls.some((c) => c.url.includes('api.resend.com/emails'))).toBe(false);
    });
});
