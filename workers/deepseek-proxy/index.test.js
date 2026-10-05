import { describe, it, expect } from 'vitest';
import worker from './index.js';

// The proxy only echoes Access-Control-Allow-Origin for allow-listed origins;
// anything else gets 'null'. Exercising the real fetch handler pins the list.
async function allowOrigin(origin) {
    const request = new Request('https://deepseek-proxy.example/', {
        method: 'OPTIONS',
        headers: { Origin: origin },
    });
    const response = await worker.fetch(request, {}, {});
    return response.headers.get('Access-Control-Allow-Origin');
}

describe('deepseek-proxy CORS allow-list', () => {
    it('allows the staging origin (s.)', async () => {
        expect(await allowOrigin('https://s.ultrafastfluency.com'))
            .toBe('https://s.ultrafastfluency.com');
    });

    it('allows the production origins', async () => {
        expect(await allowOrigin('https://ultrafastfluency.com'))
            .toBe('https://ultrafastfluency.com');
        expect(await allowOrigin('https://go.ultrafastfluency.com'))
            .toBe('https://go.ultrafastfluency.com');
        expect(await allowOrigin('https://uffenglish.pages.dev'))
            .toBe('https://uffenglish.pages.dev');
    });

    it('rejects an unknown origin', async () => {
        expect(await allowOrigin('https://evil.example')).toBe('null');
    });
});
