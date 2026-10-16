// src/modules/auth/turnstile-logic.test.js
// The site key is resolved through import.meta.env, which Vite replaces at
// build time — so the module is re-imported with stubbed env rather than
// asserting on a module-level constant captured at first import.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const SITE_KEY = '0x4AAAAAAFYNEwvCsQrVybEB';

async function importLogic(env = {}) {
    vi.resetModules();
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', env.key ?? '');
    return import('./turnstile-logic.js');
}

describe('turnstile-logic', () => {
    beforeEach(() => {
        vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    describe('getTurnstileSiteKey', () => {
        it('falls back to the committed default when the env var is unset', async () => {
            const logic = await importLogic({ key: '' });
            expect(logic.getTurnstileSiteKey()).toBe(SITE_KEY);
        });

        it('falls back when the env var is whitespace only', async () => {
            const logic = await importLogic({ key: '   ' });
            expect(logic.getTurnstileSiteKey()).toBe(SITE_KEY);
        });

        it('honours a build-time override and trims it', async () => {
            const logic = await importLogic({ key: '  0x4AAAAAAFYNEwvCsQrVybEB  ' });
            expect(logic.getTurnstileSiteKey()).toBe(SITE_KEY);
        });
    });

    describe('isTurnstileEnabled', () => {
        it('is true with the default key', async () => {
            const logic = await importLogic({ key: '' });
            expect(logic.isTurnstileEnabled()).toBe(true);
        });
    });

    it('exposes the action the widget and the Function must agree on', async () => {
        const logic = await importLogic({ key: '' });
        expect(logic.TURNSTILE_ACTION).toBe('signup');
        // The action contract: 1-32 chars of letters, digits, underscore/hyphen.
        expect(logic.TURNSTILE_ACTION).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    });

    describe('verifyTurnstileToken', () => {
        it('returns false for an empty token without calling the network', async () => {
            const fetchSpy = vi.spyOn(globalThis, 'fetch');
            const logic = await importLogic({ key: '' });
            expect(await logic.verifyTurnstileToken('')).toBe(false);
            expect(await logic.verifyTurnstileToken('   ')).toBe(false);
            expect(await logic.verifyTurnstileToken(null)).toBe(false);
            expect(await logic.verifyTurnstileToken(undefined)).toBe(false);
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it('posts the token as JSON and returns true on ok:true', async () => {
            const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                json: async () => ({ ok: true }),
            });
            const logic = await importLogic({ key: '' });

            await expect(logic.verifyTurnstileToken('token-123')).resolves.toBe(true);

            expect(fetchSpy).toHaveBeenCalledTimes(1);
            const [url, init] = fetchSpy.mock.calls[0];
            expect(url).toBe('/api/turnstile-verify');
            expect(init.method).toBe('POST');
            expect(JSON.parse(init.body)).toEqual({ token: 'token-123' });
        });

        it('returns false when the endpoint says not-ok', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                json: async () => ({ ok: false, error: 'verification-failed' }),
            });
            const logic = await importLogic({ key: '' });
            expect(await logic.verifyTurnstileToken('token-123')).toBe(false);
        });

        it('returns false on a non-2xx response', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 });
            const logic = await importLogic({ key: '' });
            expect(await logic.verifyTurnstileToken('token-123')).toBe(false);
        });

        it('returns false when the request throws', async () => {
            vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
            const logic = await importLogic({ key: '' });
            expect(await logic.verifyTurnstileToken('token-123')).toBe(false);
        });
    });
});
