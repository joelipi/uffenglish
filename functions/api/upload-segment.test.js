// functions/api/upload-segment.test.js
// Unit tests for the Cloudflare Pages Function that writes per-segment clips
// to R2. The Function is a standalone module, so it is tested by calling
// onRequestPost({ request, env }) directly with plain objects — no real
// Request/fetch needed. globalThis.fetch is stubbed to simulate Supabase.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { onRequestPost, DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY } from './upload-segment.js';
import { MAX_R2_UPLOAD_BYTES } from '../../src/modules/video/r2-upload-limits.js';

const FALLBACK_URL = DEFAULT_SUPABASE_URL;
const FALLBACK_ANON_KEY = DEFAULT_SUPABASE_ANON_KEY;
const MAX_BYTES = MAX_R2_UPLOAD_BYTES;

function makeRequest({
    shareCode = 'ab12',
    key = 'videos/ab12-model-w-response-01.mp4',
    token = 'valid-token',
    contentType = null,
    contentLength = null,
    bytes = new ArrayBuffer(8),
} = {}) {
    const headers = new Map();
    if (shareCode != null) headers.set('x-share-code', shareCode);
    if (key != null) headers.set('x-r2-key', key);
    if (token != null) headers.set('Authorization', `Bearer ${token}`);
    if (contentType != null) headers.set('Content-Type', contentType);
    if (contentLength != null) headers.set('content-length', String(contentLength));
    return {
        headers: { get: (name) => headers.get(name) ?? null },
        arrayBuffer: async () => bytes,
    };
}

function makeEnv({ url, anonKey } = {}) {
    const env = { UFF_R2: { put: vi.fn().mockResolvedValue(undefined) } };
    if (url != null) env.SUPABASE_URL = url;
    if (anonKey != null) env.SUPABASE_ANON_KEY = anonKey;
    return env;
}

function makeFetchStub({
    userOk = true,
    userBody = { id: 'user-1' },
    profileOk = true,
    profileRows = [{ share_code: 'ab12' }],
} = {}) {
    return vi.fn(async (url) => {
        if (url.includes('/auth/v1/user')) {
            return { ok: userOk, json: async () => userBody };
        }
        if (url.includes('/rest/v1/user_profiles')) {
            return { ok: profileOk, json: async () => profileRows };
        }
        return { ok: false, json: async () => ({}) };
    });
}

describe('onRequestPost — upload-segment Function', () => {
    let fetchStub;

    beforeEach(() => {
        fetchStub = makeFetchStub();
        vi.stubGlobal('fetch', fetchStub);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('uploads with the publishable fallbacks when env vars are missing (regression for the 500)', async () => {
        const env = makeEnv(); // no SUPABASE_URL / SUPABASE_ANON_KEY
        const res = await onRequestPost({ request: makeRequest(), env });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            ok: true,
            url: 'https://r2.ultrafastfluency.com/videos/ab12-model-w-response-01.mp4',
        });
        expect(env.UFF_R2.put).toHaveBeenCalledWith(
            'videos/ab12-model-w-response-01.mp4',
            expect.any(ArrayBuffer),
            { httpMetadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=3600' } }
        );
        // Both Supabase calls used the publishable fallbacks.
        expect(fetchStub).toHaveBeenCalledWith(
            `${FALLBACK_URL}/auth/v1/user`,
            expect.objectContaining({ headers: expect.objectContaining({ apikey: FALLBACK_ANON_KEY }) })
        );
        expect(fetchStub).toHaveBeenCalledWith(
            `${FALLBACK_URL}/rest/v1/user_profiles?select=share_code&id=eq.user-1`,
            expect.objectContaining({ headers: expect.objectContaining({ apikey: FALLBACK_ANON_KEY }) })
        );
    });

    it('uses the env SUPABASE_URL/SUPABASE_ANON_KEY when present', async () => {
        const env = makeEnv({ url: 'https://custom.supabase.co', anonKey: 'custom-anon-key' });
        const res = await onRequestPost({ request: makeRequest(), env });

        expect(res.status).toBe(200);
        expect(fetchStub).toHaveBeenCalledWith(
            'https://custom.supabase.co/auth/v1/user',
            expect.objectContaining({ headers: expect.objectContaining({ apikey: 'custom-anon-key' }) })
        );
        expect(fetchStub).toHaveBeenCalledWith(
            'https://custom.supabase.co/rest/v1/user_profiles?select=share_code&id=eq.user-1',
            expect.objectContaining({ headers: expect.objectContaining({ apikey: 'custom-anon-key' }) })
        );
        expect(env.UFF_R2.put).toHaveBeenCalledTimes(1);
        expect(env.UFF_R2.put).toHaveBeenCalledWith(
            'videos/ab12-model-w-response-01.mp4',
            expect.any(ArrayBuffer),
            { httpMetadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=3600' } }
        );
    });

    it('rejects with 400 when x-share-code or x-r2-key is missing', async () => {
        const noShareCode = await onRequestPost({ request: makeRequest({ shareCode: null }), env: makeEnv() });
        expect(noShareCode.status).toBe(400);

        const noKey = await onRequestPost({ request: makeRequest({ key: null }), env: makeEnv() });
        expect(noKey.status).toBe(400);
    });

    it('rejects with 403 when the key is outside the shareCode namespace or not a media file', async () => {
        const wrongNamespace = await onRequestPost({
            request: makeRequest({ key: 'videos/other-model-w-response-01.mp4' }),
            env: makeEnv(),
        });
        expect(wrongNamespace.status).toBe(403);

        const wrongExt = await onRequestPost({
            request: makeRequest({ key: 'videos/ab12-model-w-response-01.txt' }),
            env: makeEnv(),
        });
        expect(wrongExt.status).toBe(403);
    });

    it('rejects with 401 when no Authorization token is present', async () => {
        const res = await onRequestPost({ request: makeRequest({ token: null }), env: makeEnv() });
        expect(res.status).toBe(401);
    });

    it('rejects with 401 when Supabase rejects the token', async () => {
        vi.stubGlobal('fetch', makeFetchStub({ userOk: false }));
        const res = await onRequestPost({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(401);
    });

    it('rejects with 403 when the profile share_code does not match x-share-code', async () => {
        vi.stubGlobal('fetch', makeFetchStub({ profileRows: [{ share_code: 'zz99' }] }));
        const res = await onRequestPost({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(403);
    });

    it('rejects with 413 when content-length exceeds the 50 MB cap', async () => {
        const env = makeEnv();
        const res = await onRequestPost({
            request: makeRequest({ contentLength: MAX_BYTES + 1 }),
            env,
        });
        expect(res.status).toBe(413);
        expect(env.UFF_R2.put).not.toHaveBeenCalled();
    });

    it('rejects with 413 when the body exceeds the 50 MB cap without a content-length header', async () => {
        const env = makeEnv();
        const res = await onRequestPost({
            request: makeRequest({ contentLength: null, bytes: new ArrayBuffer(MAX_BYTES + 1) }),
            env,
        });
        expect(res.status).toBe(413);
        expect(env.UFF_R2.put).not.toHaveBeenCalled();
    });

    it('accepts a body exactly at the 50 MB cap (boundary is inclusive)', async () => {
        const env = makeEnv();
        const res = await onRequestPost({
            request: makeRequest({ contentLength: MAX_BYTES, bytes: new ArrayBuffer(MAX_BYTES) }),
            env,
        });
        expect(res.status).toBe(200);
        expect(env.UFF_R2.put).toHaveBeenCalledTimes(1);
    });

    it('accepts a body exactly at the cap without a content-length header', async () => {
        const env = makeEnv();
        const res = await onRequestPost({
            request: makeRequest({ contentLength: null, bytes: new ArrayBuffer(MAX_BYTES) }),
            env,
        });
        expect(res.status).toBe(200);
        expect(env.UFF_R2.put).toHaveBeenCalledTimes(1);
    });

    it('accepts the concatenated recap key (videos/<shareCode>-<courseId>-<lessonId>-complete.mp4)', async () => {
        const env = makeEnv();
        const res = await onRequestPost({
            request: makeRequest({ key: 'videos/ab12-model-w-complete.mp4' }),
            env,
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            ok: true,
            url: 'https://r2.ultrafastfluency.com/videos/ab12-model-w-complete.mp4',
        });
        expect(env.UFF_R2.put).toHaveBeenCalledWith(
            'videos/ab12-model-w-complete.mp4',
            expect.any(ArrayBuffer),
            { httpMetadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=3600' } }
        );
    });

    it('accepts a co-authored B complete key (videos/<creator>-<other>-<course>-<lesson>-complete.mp4)', async () => {
        const env = makeEnv();
        const res = await onRequestPost({
            request: makeRequest({ key: 'videos/ab12-cd34-friend-b-complete.mp4' }),
            env,
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            ok: true,
            url: 'https://r2.ultrafastfluency.com/videos/ab12-cd34-friend-b-complete.mp4',
        });
        expect(env.UFF_R2.put).toHaveBeenCalledWith(
            'videos/ab12-cd34-friend-b-complete.mp4',
            expect.any(ArrayBuffer),
            { httpMetadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=3600' } }
        );
    });

    it('rejects a co-authored complete key whose creator prefix does not match', async () => {
        const env = makeEnv();
        const res = await onRequestPost({
            request: makeRequest({ key: 'videos/other-cd34-friend-b-complete.mp4' }),
            env,
        });
        expect(res.status).toBe(403);
        expect(env.UFF_R2.put).not.toHaveBeenCalled();
    });

    it('rejects a complete key outside the shareCode namespace', async () => {
        const env = makeEnv();
        const res = await onRequestPost({
            request: makeRequest({ key: 'videos/other-model-w-complete.mp4' }),
            env,
        });
        expect(res.status).toBe(403);
        expect(env.UFF_R2.put).not.toHaveBeenCalled();
    });

    it('rejects a complete key with a non-mp4 extension', async () => {
        const env = makeEnv();
        const res = await onRequestPost({
            request: makeRequest({ key: 'videos/ab12-model-w-complete.webm' }),
            env,
        });
        expect(res.status).toBe(403);
        expect(env.UFF_R2.put).not.toHaveBeenCalled();
    });
});
