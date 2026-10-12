// scripts/lib/pwa-navigation-deny-list.test.js
// The navigation fallback is the one part of the service worker that can shadow
// a real page, so these tests assert BEHAVIOUR (does this URL get the network or
// the shell?) rather than the config text. Cloudflare serves `public/<name>.html`
// at its extensionless path, so both forms must be denied for each standalone
// page.
import { describe, it, expect } from 'vitest';
import { PWA_NAVIGATION_DENY_LIST, matchesPwaNavigationDenyList } from './pwa-navigation-deny-list.js';

const SHELL_ROUTES = [
    '/',
    '/home',
    '/privacy',
    '/Privacy',
    '/terms',
    '/privacy/',
    '/confirm-email',
    '/confirm-email?token=abc',
    '/courses',
    '/login',
    '/login?redirect=/home',
    '/signup',
    '/profile',
    '/course/wouldyourather/lesson/a',
    '/course/model/lesson/m-g',
    '/abc12', // a friend share code -> /:shareCode
];

describe('matchesPwaNavigationDenyList — standalone pages get the network', () => {
    // public/recorder.html and public/landing.html are real HTML documents
    // served at their extensionless paths (the .html form 308-redirects to
    // them), so every form and every query-string form must be denied.
    for (const stem of ['/recorder', '/landing']) {
        for (const path of [stem, `${stem}.html`, `${stem}?x=1`, `${stem}.html?x=1`]) {
            it(`denies ${path}`, () => {
                expect(matchesPwaNavigationDenyList(path)).toBe(true);
            });
        }
    }

    it('does not deny a path that merely starts with a denied name', () => {
        expect(matchesPwaNavigationDenyList('/recorders')).toBe(false);
        expect(matchesPwaNavigationDenyList('/landing-page')).toBe(false);
        expect(matchesPwaNavigationDenyList('/landing/x')).toBe(false);
    });

    it('denies the non-navigation prefixes', () => {
        for (const path of ['/api/welcome-email', '/assets/main-abc.js', '/whisper/model.bin']) {
            expect(matchesPwaNavigationDenyList(path), path).toBe(true);
        }
    });

    it('is false for an empty or non-string input', () => {
        expect(matchesPwaNavigationDenyList('')).toBe(false);
        expect(matchesPwaNavigationDenyList(null)).toBe(false);
        expect(matchesPwaNavigationDenyList(undefined)).toBe(false);
        expect(matchesPwaNavigationDenyList(42)).toBe(false);
    });
});

describe('matchesPwaNavigationDenyList — SPA client routes keep the shell fallback', () => {
    for (const path of SHELL_ROUTES) {
        it(`does not deny ${path}`, () => {
            expect(matchesPwaNavigationDenyList(path)).toBe(false);
        });
    }
});

describe('PWA_NAVIGATION_DENY_LIST shape', () => {
    it('is an array of anchored regular expressions (an unanchored pattern could match mid-path)', () => {
        expect(Array.isArray(PWA_NAVIGATION_DENY_LIST)).toBe(true);
        expect(PWA_NAVIGATION_DENY_LIST.length).toBeGreaterThan(0);
        for (const pattern of PWA_NAVIGATION_DENY_LIST) {
            expect(pattern).toBeInstanceOf(RegExp);
            expect(pattern.source.startsWith('^')).toBe(true);
        }
    });
});
