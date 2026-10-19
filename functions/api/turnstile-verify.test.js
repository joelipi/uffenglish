// functions/api/turnstile-verify.test.js
// The Function is a standalone module, so it is tested by calling
// onRequestPost({ request, env }) directly with plain objects — no real
// Request/fetch needed. globalThis.fetch is stubbed to simulate the Cloudflare
// siteverify endpoint.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { onRequestPost, allowedHostnames, TURNSTILE_ACTION } from './turnstile-verify.js';

const SECRET = '0x4AAAAAAFYNEwvCsQrVybEB-secret';
const HOSTNAMES = 'ultrafastfluency.com,www.ultrafastfluency.com,cogdex.com,uffenglish.pages.dev';

function makeRequest({ token = 'cf-token', contentType = 'application/json', xff = '' } = {}) {
    const headers = new Map();
    if (contentType) headers.set('content-type', contentType);
    if (xff) headers.set('x-forwarded-for', xff);
    return {
        headers: { get: (name) => headers.get(name) ?? null },
        json: async () => ({ token }),
        formData: async () => ({
            get: (name) => (name === 'cf-turnstile-response' ? token : null),
        }),
    };
}

function makeEnv(overrides = {}) {
    return {
        TURNSTILE_SECRET: SECRET,
        TURNSTILE_HOSTNAMES: HOSTNAMES,
        ...overrides,
    };
}

function siteverifyResult(overrides = {}) {
    return {
        ok: true,
        json: async () => ({
            success: true,
            action: TURNSTILE_ACTION,
            hostname: 'ultrafastfluency.com',
            ...overrides,
        }),
    };
}

describe('turnstile-verify allowedHostnames', () => {
    it('splits, trims, lowercases and drops empties', () => {
        expect(allowedHostnames({ TURNSTILE_HOSTNAMES: ' A.com ,, B.com ,, ' })).toEqual([
            'a.com',
            'b.com',
        ]);
    });

    it('is empty when unset', () => {
        expect(allowedHostnames({})).toEqual([]);
        expect(allowedHostnames({ TURNSTILE_HOSTNAMES: '' })).toEqual([]);
    });
});

describe('turnstile-verify onRequestPost', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('rejects a missing token', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const res = await onRequestPost({ request: makeRequest({ token: '' }), env: makeEnv() });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ ok: false, error: 'missing-token' });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects an over-long token', async () => {
        const res = await onRequestPost({
            request: makeRequest({ token: 'x'.repeat(2049) }),
            env: makeEnv(),
        });
        expect(res.status).toBe(400);
    });

    it('fails closed when TURNSTILE_SECRET is not set', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const res = await onRequestPost({
            request: makeRequest(),
            env: makeEnv({ TURNSTILE_SECRET: undefined }),
        });
        expect(res.status).toBe(500);
        expect((await res.json()).error).toBe('captcha-not-configured');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('fails closed when TURNSTILE_HOSTNAMES is not set', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const res = await onRequestPost({
            request: makeRequest(),
            env: makeEnv({ TURNSTILE_HOSTNAMES: undefined }),
        });
        expect(res.status).toBe(500);
        expect((await res.json()).error).toBe('captcha-not-configured');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('posts the canonical siteverify form with secret, response and remoteip', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(siteverifyResult());
        const res = await onRequestPost({
            request: makeRequest({ xff: '203.0.113.7' }),
            env: makeEnv(),
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
        expect(init.method).toBe('POST');
        expect(init.headers['content-type']).toBe('application/x-www-form-urlencoded');
        const body = new URLSearchParams(init.body);
        expect(body.get('secret')).toBe(SECRET);
        expect(body.get('response')).toBe('cf-token');
        expect(body.get('remoteip')).toBe('203.0.113.7');
    });

    it('reads the token from a form-encoded body too', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(siteverifyResult());
        const res = await onRequestPost({
            request: makeRequest({ contentType: 'application/x-www-form-urlencoded' }),
            env: makeEnv(),
        });
        expect(res.status).toBe(200);
    });

    it('rejects when siteverify reports failure', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            siteverifyResult({ success: false, 'error-codes': ['invalid-input-response'] })
        );
        const res = await onRequestPost({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe('verification-failed');
    });

    it('rejects when siteverify is unreachable', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('dns'));
        const res = await onRequestPost({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(403);
    });

    it('rejects when siteverify returns a non-2xx status', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 });
        const res = await onRequestPost({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(403);
    });

    it('rejects an action mismatch', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(siteverifyResult({ action: 'login' }));
        const res = await onRequestPost({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe('action-mismatch');
    });

    it('rejects a hostname outside the allowlist', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            siteverifyResult({ hostname: 'localhost' })
        );
        const res = await onRequestPost({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe('hostname-not-allowed');
    });

    it('accepts any hostname on the allowlist, case-insensitively', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            siteverifyResult({ hostname: 'WWW.UltrafastFluency.com' })
        );
        const res = await onRequestPost({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(200);
    });

    it('never includes localhost in the production allowlist', () => {
        // The widget is registered for localhost/127.0.0.1, but a production
        // backend must not trust a token solved there.
        expect(allowedHostnames({ TURNSTILE_HOSTNAMES: HOSTNAMES })).not.toContain('localhost');
        expect(allowedHostnames({ TURNSTILE_HOSTNAMES: HOSTNAMES })).not.toContain('127.0.0.1');
    });
});
