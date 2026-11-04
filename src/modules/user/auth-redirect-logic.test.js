import { describe, it, expect } from 'vitest';
import {
    DEFAULT_SITE_URL,
    isPrivateHostname,
    isUsableRedirectUrl,
    resolveSiteOrigin,
    resolveAuthEmailRedirectTo,
} from './auth-redirect-logic.js';

describe('isPrivateHostname', () => {
    it('flags loopback, private and LAN hosts', () => {
        for (const host of [
            'localhost',
            'LOCALHOST',
            'api.localhost',
            '127.0.0.1',
            '127.1.2.3',
            '0.0.0.0',
            '10.0.0.5',
            '172.16.4.2',
            '172.31.255.255',
            '192.168.1.20',
            '169.254.10.1',
            '100.64.0.1',
            '::1',
            '[::1]',
            'fd00::1',
            'fe80::1',
            'box.local',
            'db.internal',
            '',
        ]) {
            expect(isPrivateHostname(host), host).toBe(true);
        }
    });

    it('does not flag public hosts (including 172.x outside the private range)', () => {
        for (const host of ['ultrafastfluency.com', 'www.ultrafastfluency.com', 's.ultrafastfluency.com', '172.32.0.1', '8.8.8.8']) {
            expect(isPrivateHostname(host), host).toBe(false);
        }
    });
});

describe('isUsableRedirectUrl', () => {
    it('accepts an absolute public http(s) URL', () => {
        expect(isUsableRedirectUrl('https://ultrafastfluency.com/reset-password')).toBe(true);
        expect(isUsableRedirectUrl('https://s.ultrafastfluency.com/reset-password')).toBe(true);
    });

    it('rejects local, relative and non-http targets', () => {
        for (const value of [
            'http://localhost:3000/reset-password',
            'http://localhost:3000',
            'http://127.0.0.1:3000/reset-password',
            'http://192.168.1.9/reset-password',
            '/reset-password',
            'reset-password',
            '',
            null,
            undefined,
            'javascript:alert(1)',
            'not a url',
        ]) {
            expect(isUsableRedirectUrl(value), String(value)).toBe(false);
        }
    });
});

describe('resolveSiteOrigin', () => {
    it('returns the configured public origin without a trailing slash', () => {
        expect(resolveSiteOrigin('https://ultrafastfluency.com/')).toBe('https://ultrafastfluency.com');
        expect(resolveSiteOrigin('https://s.ultrafastfluency.com')).toBe('https://s.ultrafastfluency.com');
    });

    it('never returns a localhost origin', () => {
        expect(resolveSiteOrigin('http://localhost:3000')).toBe(DEFAULT_SITE_URL);
        expect(resolveSiteOrigin('http://127.0.0.1:3000')).toBe(DEFAULT_SITE_URL);
        expect(resolveSiteOrigin(undefined)).toBe(DEFAULT_SITE_URL);
        expect(resolveSiteOrigin('not a url')).toBe(DEFAULT_SITE_URL);
        expect(DEFAULT_SITE_URL).toBe('https://ultrafastfluency.com');
    });
});

describe('resolveAuthEmailRedirectTo', () => {
    const siteUrl = 'https://ultrafastfluency.com';

    it('keeps a usable public redirect (staging keeps its own host)', () => {
        expect(
            resolveAuthEmailRedirectTo({ redirectTo: 'https://s.ultrafastfluency.com/reset-password', siteUrl })
        ).toBe('https://s.ultrafastfluency.com/reset-password');
    });

    it('replaces the localhost Site URL GoTrue falls back to', () => {
        expect(resolveAuthEmailRedirectTo({ redirectTo: 'http://localhost:3000', siteUrl, action: 'recovery' })).toBe(
            'https://ultrafastfluency.com/reset-password'
        );
        expect(
            resolveAuthEmailRedirectTo({ redirectTo: 'http://localhost:3000/reset-password', siteUrl, action: 'recovery' })
        ).toBe('https://ultrafastfluency.com/reset-password');
    });

    it('keeps the local path (and query) when swapping the origin', () => {
        expect(
            resolveAuthEmailRedirectTo({
                redirectTo: 'http://localhost:3000/reset-password?from=email',
                siteUrl,
                action: 'recovery',
            })
        ).toBe('https://ultrafastfluency.com/reset-password?from=email');
    });

    it('falls back to the action path when nothing usable was supplied', () => {
        expect(resolveAuthEmailRedirectTo({ siteUrl, action: 'recovery' })).toBe(
            'https://ultrafastfluency.com/reset-password'
        );
        expect(resolveAuthEmailRedirectTo({ redirectTo: '', siteUrl, action: 'email_change' })).toBe(
            'https://ultrafastfluency.com'
        );
    });

    it('rejects non-http schemes without inventing a path', () => {
        expect(resolveAuthEmailRedirectTo({ redirectTo: 'javascript:alert(1)', siteUrl, action: 'recovery' })).toBe(
            'https://ultrafastfluency.com/reset-password'
        );
        expect(resolveAuthEmailRedirectTo({ redirectTo: 'javascript:alert(1)', siteUrl })).toBe(
            'https://ultrafastfluency.com'
        );
    });

    it('uses the production default when SITE_URL itself is local or unset', () => {
        expect(
            resolveAuthEmailRedirectTo({ redirectTo: 'http://localhost:3000/reset-password', siteUrl: 'http://localhost:3000', action: 'recovery' })
        ).toBe('https://ultrafastfluency.com/reset-password');
        expect(resolveAuthEmailRedirectTo({ action: 'recovery' })).toBe('https://ultrafastfluency.com/reset-password');
    });
});
