import { describe, it, expect } from 'vitest';
import worker, { ALLOWED_ORIGINS } from './index.js';

// The proxy only echoes Access-Control-Allow-Origin for allow-listed origins;
// anything else gets 'null'. This is deliberately the *expected* value rather
// than derived from ALLOWED_ORIGINS, so deleting an entry from the source fails
// the pin below (a guard that derives its own expectations could never fail).
const EXPECTED_ORIGINS = [
    'https://uffenglish.pages.dev',
    'https://go.ultrafastfluency.com',
    'http://localhost:3000',
    'http://localhost:5173',
    'https://ultrafastfluency.com',
    'https://s.ultrafastfluency.com',
    'https://t.ultrafastfluency.com',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
    'http://100.119.79.124',
    'https://100.119.79.124',
    'https://localhost-0.taild13d5c.ts.net',
    'https://beacon-au8.pages.dev',
];

async function allowOrigin(origin) {
    const request = new Request('https://deepseek-proxy.example/', {
        method: 'OPTIONS',
        headers: { Origin: origin },
    });
    const response = await worker.fetch(request, {}, {});
    return response.headers.get('Access-Control-Allow-Origin');
}

describe('deepseek-proxy CORS allow-list', () => {
    it('pins the exact allow-list (a removed origin must fail this test)', () => {
        expect(ALLOWED_ORIGINS).toEqual(EXPECTED_ORIGINS);
    });

    it('echoes every allow-listed origin', async () => {
        for (const origin of EXPECTED_ORIGINS) {
            expect(await allowOrigin(origin)).toBe(origin);
        }
    });

    it('rejects an unknown origin', async () => {
        expect(await allowOrigin('https://evil.example')).toBe('null');
    });
});
