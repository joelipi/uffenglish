// Unit tests for /api/pipeline/status (story 040, Task 3; story 041 Task 2 moved
// it to the private PIPELINE_R2 binding). A fake PIPELINE_R2.get returns the
// stored marker, exactly like the R2 binding would; the public UFF_R2 must
// never be read.

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestGet } from './status.js';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));

function makeRequest({ operatorKey = 'secret', id = 'job-abc12345' } = {}) {
    const headers = new Map();
    if (operatorKey !== null) headers.set('x-operator-key', operatorKey);
    const url = id === null
        ? 'https://app.example.com/api/pipeline/status'
        : `https://app.example.com/api/pipeline/status?id=${encodeURIComponent(id)}`;
    return {
        url,
        headers: { get: (name) => headers.get(name) ?? null },
    };
}

function makeEnv({ operatorKey = 'secret', object = null } = {}) {
    const env = {
        PIPELINE_R2: { get: vi.fn().mockResolvedValue(object) },
        UFF_R2: { get: vi.fn().mockResolvedValue(null) },
    };
    if (operatorKey != null) env.OPERATOR_KEY = operatorKey;
    return env;
}

describe('onRequestGet — status Function', () => {
    it('rejects with 401 and reads nothing when the operator key is missing/wrong', async () => {
        const env = makeEnv();
        const missing = await onRequestGet({ request: makeRequest({ operatorKey: null }), env });
        expect(missing.status).toBe(401);
        const wrong = await onRequestGet({ request: makeRequest({ operatorKey: 'nope' }), env });
        expect(wrong.status).toBe(401);
        expect(env.PIPELINE_R2.get).not.toHaveBeenCalled();
        expect(env.UFF_R2.get).not.toHaveBeenCalled();
    });

    it('rejects invalid ids with 400 and reads nothing', async () => {
        for (const id of ['../x', 'short']) {
            const env = makeEnv();
            const res = await onRequestGet({ request: makeRequest({ id }), env });
            expect(res.status, id).toBe(400);
            expect(env.PIPELINE_R2.get).not.toHaveBeenCalled();
            expect(env.UFF_R2.get).not.toHaveBeenCalled();
        }
    });

    it('returns 404 when no marker exists', async () => {
        const env = makeEnv({ object: null });
        const res = await onRequestGet({ request: makeRequest(), env });
        expect(res.status).toBe(404);
    });

    it('returns the parsed marker as JSON from the private bucket', async () => {
        const marker = { status: 'done', stage: 'publish', jobId: 'job-abc12345', published: [] };
        const env = makeEnv({ object: { text: async () => JSON.stringify(marker) } });
        const res = await onRequestGet({ request: makeRequest(), env });

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/json');
        expect(await res.json()).toEqual(marker);
        expect(env.PIPELINE_R2.get).toHaveBeenCalledWith('raw/status/job-abc12345.json');
        expect(env.UFF_R2.get).not.toHaveBeenCalled();
    });

    it('returns 502 when the marker is not valid JSON', async () => {
        const env = makeEnv({ object: { text: async () => 'not json' } });
        const res = await onRequestGet({ request: makeRequest(), env });
        expect(res.status).toBe(502);
    });

    it('imports statusKey from the shared key module (no literal raw/ prefix)', () => {
        const src = fs.readFileSync(path.join(SELF_DIR, 'status.js'), 'utf8');
        expect(src).toContain(
            "import { statusKey } from '../../../src/modules/video/pipeline-keys.js'"
        );
        expect(src).not.toMatch(/['"]raw\//);
    });

    it('uses the private binding and never env.UFF_R2', () => {
        const src = fs.readFileSync(path.join(SELF_DIR, 'status.js'), 'utf8');
        expect(src).toContain('env.PIPELINE_R2');
        expect(src).not.toMatch(/env\.UFF_R2/);
    });
});
