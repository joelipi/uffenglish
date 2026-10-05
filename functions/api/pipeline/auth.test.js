// Unit tests for the shared operator-key auth used by the pipeline Functions
// (story 040, Task 2). Plain objects stand in for the Cloudflare Request.

import { describe, it, expect } from 'vitest';
import { requireOperatorKey, timingSafeEqual } from './auth.js';

function makeRequest(operatorKey) {
    const headers = new Map();
    if (operatorKey !== undefined) headers.set('x-operator-key', operatorKey);
    return { headers: { get: (name) => headers.get(name) ?? null } };
}

describe('pipeline auth — requireOperatorKey', () => {
    it('returns null for the matching key', () => {
        expect(requireOperatorKey(makeRequest('secret'), { OPERATOR_KEY: 'secret' })).toBe(null);
    });

    it('returns 401 when the header is missing or wrong', async () => {
        const missing = requireOperatorKey(makeRequest(undefined), { OPERATOR_KEY: 'secret' });
        expect(missing.status).toBe(401);
        const wrong = requireOperatorKey(makeRequest('nope'), { OPERATOR_KEY: 'secret' });
        expect(wrong.status).toBe(401);
    });

    it('fails closed with 500 when OPERATOR_KEY is unset', () => {
        const res = requireOperatorKey(makeRequest('secret'), {});
        expect(res.status).toBe(500);
    });

    it('does not reject a valid key just because lengths differ from a wrong guess', () => {
        expect(timingSafeEqual('secret', 'secret')).toBe(true);
        expect(timingSafeEqual('secret', 'secret-longer')).toBe(false);
        expect(timingSafeEqual('secret-longer', 'secret')).toBe(false);
    });
});
