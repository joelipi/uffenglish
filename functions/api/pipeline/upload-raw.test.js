// Unit tests for /api/pipeline/upload-raw (story 040, Task 2; story 041 Task 2
// moved it to the private PIPELINE_R2 binding). The Function is a standalone
// module, so it is driven directly with fake request/env — no real
// Request/fetch/R2 needed (mirrors functions/api/upload-segment.test.js).

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestPost } from './upload-raw.js';
import { MAX_R2_UPLOAD_BYTES } from '../../../src/modules/video/r2-upload-limits.js';

const MAX_BYTES = MAX_R2_UPLOAD_BYTES;
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));

function makeRequest({
    operatorKey = 'secret',
    filename = 'lesson_01',
    contentType = null,
    contentLength = null,
    bytes = new ArrayBuffer(8),
} = {}) {
    const headers = new Map();
    if (operatorKey !== null) headers.set('x-operator-key', operatorKey);
    if (filename !== null) headers.set('x-filename', filename);
    if (contentType != null) headers.set('Content-Type', contentType);
    if (contentLength != null) headers.set('content-length', String(contentLength));
    return {
        headers: { get: (name) => headers.get(name) ?? null },
        arrayBuffer: async () => bytes,
    };
}

// Both bindings are present: the private one is written, the public one must
// never be touched (story 041).
function makeEnv({ operatorKey = 'secret', privateBucket = true } = {}) {
    const env = { UFF_R2: { put: vi.fn().mockResolvedValue(undefined) } };
    if (privateBucket) env.PIPELINE_R2 = { put: vi.fn().mockResolvedValue(undefined) };
    if (operatorKey != null) env.OPERATOR_KEY = operatorKey;
    return env;
}

describe('onRequestPost — upload-raw Function', () => {
    it('rejects with 401 and writes nothing when x-operator-key is missing', async () => {
        const env = makeEnv();
        const res = await onRequestPost({ request: makeRequest({ operatorKey: null }), env });
        expect(res.status).toBe(401);
        expect(env.PIPELINE_R2.put).not.toHaveBeenCalled();
        expect(env.UFF_R2.put).not.toHaveBeenCalled();
    });

    it('rejects with 401 when the key is wrong', async () => {
        const env = makeEnv();
        const res = await onRequestPost({ request: makeRequest({ operatorKey: 'nope' }), env });
        expect(res.status).toBe(401);
        expect(env.PIPELINE_R2.put).not.toHaveBeenCalled();
        expect(env.UFF_R2.put).not.toHaveBeenCalled();
    });

    it('rejects invalid/missing x-filename with 400 and writes nothing', async () => {
        for (const bad of ['../x', 'a/b', 'x.mp4', '']) {
            const env = makeEnv();
            const res = await onRequestPost({ request: makeRequest({ filename: bad }), env });
            expect(res.status, bad).toBe(400);
            expect(env.PIPELINE_R2.put).not.toHaveBeenCalled();
            expect(env.UFF_R2.put).not.toHaveBeenCalled();
        }
        const env = makeEnv();
        const res = await onRequestPost({ request: makeRequest({ filename: null }), env });
        expect(res.status).toBe(400);
        expect(env.PIPELINE_R2.put).not.toHaveBeenCalled();
        expect(env.UFF_R2.put).not.toHaveBeenCalled();
    });

    it('rejects with 413 when content-length exceeds the cap', async () => {
        const env = makeEnv();
        const res = await onRequestPost({ request: makeRequest({ contentLength: MAX_BYTES + 1 }), env });
        expect(res.status).toBe(413);
        expect(env.PIPELINE_R2.put).not.toHaveBeenCalled();
        expect(env.UFF_R2.put).not.toHaveBeenCalled();
    });

    it('rejects with 413 when the body exceeds the cap without content-length', async () => {
        const env = makeEnv();
        const res = await onRequestPost({
            request: makeRequest({ contentLength: null, bytes: new ArrayBuffer(MAX_BYTES + 1) }),
            env,
        });
        expect(res.status).toBe(413);
        expect(env.PIPELINE_R2.put).not.toHaveBeenCalled();
        expect(env.UFF_R2.put).not.toHaveBeenCalled();
    });

    it('accepts a body exactly at the cap', async () => {
        const env = makeEnv();
        const res = await onRequestPost({
            request: makeRequest({ contentLength: MAX_BYTES, bytes: new ArrayBuffer(MAX_BYTES) }),
            env,
        });
        expect(res.status).toBe(200);
        expect(env.PIPELINE_R2.put).toHaveBeenCalledTimes(1);
        expect(env.UFF_R2.put).not.toHaveBeenCalled();
    });

    it('uploads the raw take to the private bucket with no-store httpMetadata', async () => {
        const env = makeEnv();
        const bytes = new ArrayBuffer(8);
        const res = await onRequestPost({
            request: makeRequest({ filename: 'lesson_01', contentType: 'video/mp4', bytes }),
            env,
        });
        expect(res.status).toBe(200);
        expect(env.PIPELINE_R2.put).toHaveBeenCalledWith('raw/lesson_01.mp4', bytes, {
            httpMetadata: { contentType: 'video/mp4', cacheControl: 'no-store' },
        });
        expect(env.UFF_R2.put).not.toHaveBeenCalled();
        expect(await res.json()).toEqual({
            ok: true,
            key: 'raw/lesson_01.mp4',
        });
    });

    it('defaults the content type to video/mp4 when absent', async () => {
        const env = makeEnv();
        await onRequestPost({ request: makeRequest({ contentType: null }), env });
        expect(env.PIPELINE_R2.put).toHaveBeenCalledWith(
            'raw/lesson_01.mp4',
            expect.any(ArrayBuffer),
            { httpMetadata: { contentType: 'video/mp4', cacheControl: 'no-store' } }
        );
        expect(env.UFF_R2.put).not.toHaveBeenCalled();
    });

    it('is idempotent — a re-take overwrites the same deterministic key', async () => {
        const env = makeEnv();
        await onRequestPost({ request: makeRequest(), env });
        await onRequestPost({ request: makeRequest(), env });
        expect(env.PIPELINE_R2.put).toHaveBeenCalledTimes(2);
        expect(env.PIPELINE_R2.put).toHaveBeenNthCalledWith(
            1,
            'raw/lesson_01.mp4',
            expect.any(ArrayBuffer),
            expect.any(Object)
        );
        expect(env.PIPELINE_R2.put).toHaveBeenNthCalledWith(
            2,
            'raw/lesson_01.mp4',
            expect.any(ArrayBuffer),
            expect.any(Object)
        );
        expect(env.UFF_R2.put).not.toHaveBeenCalled();
    });

    it('fails closed with 500 and writes nothing when OPERATOR_KEY is unset', async () => {
        const env = makeEnv({ operatorKey: null });
        const res = await onRequestPost({ request: makeRequest(), env });
        expect(res.status).toBe(500);
        expect(env.PIPELINE_R2.put).not.toHaveBeenCalled();
        expect(env.UFF_R2.put).not.toHaveBeenCalled();
    });

    it('fails (does not fall back to the public bucket) when PIPELINE_R2 is missing', async () => {
        const env = makeEnv({ privateBucket: false });
        let status = 200;
        try {
            const res = await onRequestPost({ request: makeRequest(), env });
            status = res.status;
        } catch {
            status = 500;
        }
        expect(status).toBeGreaterThanOrEqual(400);
        expect(env.UFF_R2.put).not.toHaveBeenCalled();
    });

    it('derives the key via the shared rawTakeKey helper (no literal raw/ prefix)', () => {
        const src = fs.readFileSync(path.join(SELF_DIR, 'upload-raw.js'), 'utf8');
        expect(src).toContain(
            "import { rawTakeKey } from '../../../src/modules/video/pipeline-keys.js'"
        );
        expect(src).not.toMatch(/['"]raw\//);
    });

    it('uses the private binding and never env.UFF_R2', () => {
        const src = fs.readFileSync(path.join(SELF_DIR, 'upload-raw.js'), 'utf8');
        expect(src).toContain('env.PIPELINE_R2');
        expect(src).not.toMatch(/env\.UFF_R2/);
    });
});
