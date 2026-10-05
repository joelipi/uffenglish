// Unit tests for /api/pipeline/render (story 040, Task 3). `fetch` is stubbed
// with vi.stubGlobal — the Function never talks to a real Modal endpoint.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { onRequestPost } from './render.js';
import { PIPELINE_JOB_ID_PATTERN } from '../../../src/modules/video/pipeline-keys.js';

function makeRequest({ operatorKey = 'secret', body = { files: ['lesson_01'] }, rawBody = undefined } = {}) {
    const headers = new Map();
    if (operatorKey !== null) headers.set('x-operator-key', operatorKey);
    return {
        headers: { get: (name) => headers.get(name) ?? null },
        json: async () => {
            if (rawBody !== undefined) return rawBody;
            return body;
        },
    };
}

function makeEnv(overrides = {}) {
    return {
        OPERATOR_KEY: 'secret',
        MODAL_RENDER_URL: 'https://workspace--trigger.modal.run',
        MODAL_PROXY_TOKEN_ID: 'tok-id',
        MODAL_PROXY_TOKEN_SECRET: 'tok-secret',
        ...overrides,
    };
}

describe('onRequestPost — render Function', () => {
    let fetchStub;

    beforeEach(() => {
        fetchStub = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchStub);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('rejects with 401 and does not call Modal when the operator key is missing/wrong', async () => {
        const missing = await onRequestPost({ request: makeRequest({ operatorKey: null }), env: makeEnv() });
        expect(missing.status).toBe(401);
        const wrong = await onRequestPost({ request: makeRequest({ operatorKey: 'nope' }), env: makeEnv() });
        expect(wrong.status).toBe(401);
        expect(fetchStub).not.toHaveBeenCalled();
    });

    it('rejects invalid `files` with 400 and does not call Modal', async () => {
        const cases = [
            { body: {} },
            { body: { files: [] } },
            { body: { files: 'lesson_01' } },
            { body: { files: ['../x'] } },
        ];
        for (const { body } of cases) {
            const res = await onRequestPost({ request: makeRequest({ body }), env: makeEnv() });
            expect(res.status, JSON.stringify(body)).toBe(400);
        }
        expect(fetchStub).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON with 400', async () => {
        const request = makeRequest();
        request.json = async () => {
            throw new Error('bad json');
        };
        const res = await onRequestPost({ request, env: makeEnv() });
        expect(res.status).toBe(400);
        expect(fetchStub).not.toHaveBeenCalled();
    });

    it('fails closed with 500 for each missing Modal env var and does not call Modal', async () => {
        for (const key of ['MODAL_RENDER_URL', 'MODAL_PROXY_TOKEN_ID', 'MODAL_PROXY_TOKEN_SECRET']) {
            const env = makeEnv({ [key]: undefined });
            const res = await onRequestPost({ request: makeRequest(), env });
            expect(res.status, key).toBe(500);
        }
        expect(fetchStub).not.toHaveBeenCalled();
    });

    it('starts the render, forwards the proxy token and returns only the job id', async () => {
        const env = makeEnv();
        const res = await onRequestPost({ request: makeRequest({ body: { files: ['lesson_01'] } }), env });

        expect(res.status).toBe(200);
        expect(fetchStub).toHaveBeenCalledTimes(1);
        const [url, options] = fetchStub.mock.calls[0];
        expect(url).toBe(env.MODAL_RENDER_URL);
        expect(options.method).toBe('POST');
        expect(options.headers).toEqual(expect.objectContaining({
            'Modal-Key': env.MODAL_PROXY_TOKEN_ID,
            'Modal-Secret': env.MODAL_PROXY_TOKEN_SECRET,
        }));

        const forwarded = JSON.parse(options.body);
        expect(PIPELINE_JOB_ID_PATTERN.test(forwarded.jobId)).toBe(true);
        expect(forwarded.files).toEqual(['lesson_01']);

        const text = await res.text();
        const payload = JSON.parse(text);
        expect(payload).toEqual({ jobId: forwarded.jobId });
        // The proxy token must never be echoed to the caller.
        expect(text).not.toContain(env.MODAL_PROXY_TOKEN_ID);
        expect(text).not.toContain(env.MODAL_PROXY_TOKEN_SECRET);
    });

    it('returns 502 when Modal responds non-2xx', async () => {
        fetchStub.mockResolvedValue({ ok: false, status: 500 });
        const res = await onRequestPost({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(502);
    });

    it('returns 502 when the Modal fetch throws', async () => {
        fetchStub.mockRejectedValue(new Error('network down'));
        const res = await onRequestPost({ request: makeRequest(), env: makeEnv() });
        expect(res.status).toBe(502);
    });
});
