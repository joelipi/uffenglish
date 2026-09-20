// src/modules/utils/posthog-client.test.js
// Verifies initPostHog falls back to the publishable project defaults when
// VITE_PUBLIC_POSTHOG_* are missing at build time (CI builds no longer read a
// committed .env), mirroring the Supabase fallback pattern.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockInit } = vi.hoisted(() => ({ mockInit: vi.fn() }));

vi.mock('posthog-js', () => ({
    default: { init: mockInit },
}));

vi.mock('./posthog.js', () => ({
    _setPostHog: vi.fn(),
}));

const FALLBACK_KEY = 'phc_qrpnnzkDtNhbaCrKDycWvJkGHSLEwzyFWjg8cwTDrYQG';
const FALLBACK_HOST = 'https://us.i.posthog.com';

describe('initPostHog', () => {
    beforeEach(() => {
        // _initialized is module-level state; re-import fresh per test.
        vi.resetModules();
        mockInit.mockClear();
        // jsdom defaults to localhost, which initPostHog skips — shadow the
        // location with a non-local host so the init path actually runs.
        Object.defineProperty(window, 'location', {
            value: { hostname: 's.ultrafastfluency.com' },
            configurable: true,
        });
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('initializes with the publishable fallback when VITE_PUBLIC_POSTHOG_* are missing', async () => {
        vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', '');
        vi.stubEnv('VITE_PUBLIC_POSTHOG_HOST', '');
        const { initPostHog } = await import('./posthog-client.js');

        initPostHog();

        expect(mockInit).toHaveBeenCalledWith(
            FALLBACK_KEY,
            expect.objectContaining({ api_host: FALLBACK_HOST })
        );
    });

    it('uses the env values when provided', async () => {
        vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', 'phc_env_key');
        vi.stubEnv('VITE_PUBLIC_POSTHOG_HOST', 'https://env.posthog.com');
        const { initPostHog } = await import('./posthog-client.js');

        initPostHog();

        expect(mockInit).toHaveBeenCalledWith(
            'phc_env_key',
            expect.objectContaining({ api_host: 'https://env.posthog.com' })
        );
    });
});