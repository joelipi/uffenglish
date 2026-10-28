// @vitest-environment node
// Unit tests for /api/pipeline/proxy-image (stories/100).
//
// The Function exists so the studio can load a layer image from a host that
// does not send CORS without tainting the canvas it records. It is therefore a
// server-side fetch of an attacker-influenced URL, so the SSRF rules, the
// operator-key gate and the size/type caps are all pinned here.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestGet, MAX_PROXY_IMAGE_BYTES } from './proxy-image.js';

const OPERATOR_KEY = 'secret';

function makeRequest({ operatorKey = OPERATOR_KEY, url = 'https://r2.ultrafastfluency.com/bg/studio.png' } = {}) {
    const headers = new Map();
    if (operatorKey !== null) headers.set('x-operator-key', operatorKey);
    const search = url === null ? '' : `?url=${encodeURIComponent(url)}`;
    return {
        url: `https://studio.ultrafastfluency.com/api/pipeline/proxy-image${search}`,
        headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
    };
}

function makeEnv({ operatorKey = OPERATOR_KEY } = {}) {
    return operatorKey === null ? {} : { OPERATOR_KEY: operatorKey };
}

function imageResponse({ bytes = new ArrayBuffer(8), type = 'image/png', contentLength = null, ok = true, finalUrl = null } = {}) {
    return {
        ok,
        // A real Response carries the URL it ENDED at after redirects; the
        // Function re-validates it before reading the body.
        url: finalUrl === null ? 'https://r2.ultrafastfluency.com/bg/studio.png' : finalUrl,
        headers: {
            get: (name) => {
                const key = String(name).toLowerCase();
                if (key === 'content-type') return type;
                if (key === 'content-length') return contentLength === null ? null : String(contentLength);
                return null;
            },
        },
        arrayBuffer: async () => bytes,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('onRequestGet — proxy-image Function', () => {
    it('rejects a missing or wrong operator key with 401 and fetches nothing', async () => {
        const fetchImpl = vi.fn();
        vi.stubGlobal('fetch', fetchImpl);
        for (const key of [null, 'nope']) {
            const res = await onRequestGet({ request: makeRequest({ operatorKey: key }), env: makeEnv() });
            expect(res.status, String(key)).toBe(401);
        }
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('returns 500 when OPERATOR_KEY is unset', async () => {
        vi.stubGlobal('fetch', vi.fn());
        const res = await onRequestGet({ request: makeRequest(), env: makeEnv({ operatorKey: null }) });
        expect(res.status).toBe(500);
    });

    it('rejects a missing url with 400', async () => {
        vi.stubGlobal('fetch', vi.fn());
        const res = await onRequestGet({ request: makeRequest({ url: null }), env: makeEnv() });
        expect(res.status).toBe(400);
    });

    it('refuses every non-public-https target before any fetch (SSRF)', async () => {
        const fetchImpl = vi.fn();
        vi.stubGlobal('fetch', fetchImpl);
        for (const url of [
            'http://r2.ultrafastfluency.com/bg.png',
            'https://127.0.0.1/bg.png',
            'https://169.254.169.254/latest/meta-data/',
            'https://10.0.0.5/bg.png',
            'https://192.168.1.20/bg.png',
            'https://localhost/bg.png',
            'https://printer.internal/bg.png',
            'data:image/png;base64,AAAA',
        ]) {
            const res = await onRequestGet({ request: makeRequest({ url }), env: makeEnv() });
            expect(res.status, url).toBe(400);
        }
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('returns the image bytes and content type on a valid public URL', async () => {
        const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
        const fetchImpl = vi.fn().mockResolvedValue(imageResponse({ bytes }));
        vi.stubGlobal('fetch', fetchImpl);
        const res = await onRequestGet({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('image/png');
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(String(fetchImpl.mock.calls[0][0])).toContain('https://r2.ultrafastfluency.com/bg/studio.png');
    });

    it('rejects a non-image content type with 415', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse({ type: 'text/html' })));
        const res = await onRequestGet({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(415);
    });

    it('rejects an oversized declared length with 413 without reading the body', async () => {
        const arrayBuffer = vi.fn();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ...imageResponse({ contentLength: MAX_PROXY_IMAGE_BYTES + 1 }),
            arrayBuffer,
        }));
        const res = await onRequestGet({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(413);
        expect(arrayBuffer).not.toHaveBeenCalled();
    });

    it('rejects an oversized body with 413 when the length is undeclared', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            imageResponse({ bytes: new ArrayBuffer(MAX_PROXY_IMAGE_BYTES + 1) })
        ));
        const res = await onRequestGet({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(413);
    });

    it('refuses a redirect that lands on a non-public host (SSRF)', async () => {
        // `redirect: 'follow'` means the bytes can come from a different host
        // than the one validated: a public URL that 302s to the metadata
        // endpoint would otherwise hand back its contents.
        for (const finalUrl of [
            'http://169.254.169.254/latest/meta-data/',
            'https://127.0.0.1/admin',
            'https://10.0.0.7/bg.png',
            'https://printer.internal/bg.png',
        ]) {
            const arrayBuffer = vi.fn();
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ...imageResponse({ finalUrl }),
                arrayBuffer,
            }));
            const res = await onRequestGet({ request: makeRequest(), env: makeEnv() });
            expect(res.status, finalUrl).toBe(502);
            expect(arrayBuffer).not.toHaveBeenCalled();
        }
    });

    it('accepts a redirect that stays on a public https host', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(imageResponse({
            finalUrl: 'https://cdn.example.com/moved/studio.png',
        }));
        vi.stubGlobal('fetch', fetchImpl);
        const res = await onRequestGet({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(200);
    });

    it('reports 502 when upstream is unreachable or not ok', async () => {        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('dns')));
        expect((await onRequestGet({ request: makeRequest(), env: makeEnv() })).status).toBe(502);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse({ ok: false })));
        expect((await onRequestGet({ request: makeRequest(), env: makeEnv() })).status).toBe(502);
    });
});
