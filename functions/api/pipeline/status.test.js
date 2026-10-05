// Unit tests for /api/pipeline/status (story 040, Task 3). A fake UFF_R2.get
// returns the stored marker, exactly like the R2 binding would.

import { describe, it, expect, vi } from 'vitest';
import { onRequestGet } from './status.js';

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
    const env = { UFF_R2: { get: vi.fn().mockResolvedValue(object) } };
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
        expect(env.UFF_R2.get).not.toHaveBeenCalled();
    });

    it('rejects invalid ids with 400 and reads nothing', async () => {
        for (const id of ['../x', 'short']) {
            const env = makeEnv();
            const res = await onRequestGet({ request: makeRequest({ id }), env });
            expect(res.status, id).toBe(400);
            expect(env.UFF_R2.get).not.toHaveBeenCalled();
        }
    });

    it('returns 404 when no marker exists', async () => {
        const env = makeEnv({ object: null });
        const res = await onRequestGet({ request: makeRequest(), env });
        expect(res.status).toBe(404);
    });

    it('returns the parsed marker as JSON', async () => {
        const marker = { status: 'done', stage: 'publish', jobId: 'job-abc12345', published: [] };
        const env = makeEnv({ object: { text: async () => JSON.stringify(marker) } });
        const res = await onRequestGet({ request: makeRequest(), env });

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/json');
        expect(await res.json()).toEqual(marker);
        expect(env.UFF_R2.get).toHaveBeenCalledWith('raw/status/job-abc12345.json');
    });

    it('returns 502 when the marker is not valid JSON', async () => {
        const env = makeEnv({ object: { text: async () => 'not json' } });
        const res = await onRequestGet({ request: makeRequest(), env });
        expect(res.status).toBe(502);
    });
});
