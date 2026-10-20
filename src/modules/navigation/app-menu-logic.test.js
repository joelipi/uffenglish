// The shared app header's menu: the entries it lists and the gates that decide
// who sees the install / push entries and which auth action is offered.
import { describe, it, expect } from 'vitest';
import {
    APP_MENU_ITEMS,
    isRegisteredViewer,
    resolveMenuAuthAction,
} from './app-menu-logic.js';
import Strings from '../../data/strings.js';

describe('APP_MENU_ITEMS', () => {
    it('lists every inside page of the app', () => {
        const paths = APP_MENU_ITEMS.map((item) => item.path);
        expect(paths).toEqual(['/home', '/profile', '/friends', '/privacy', '/terms']);
    });

    it('never points at the landing page or a lesson', () => {
        for (const item of APP_MENU_ITEMS) {
            expect(item.path).not.toBe('/');
            expect(item.path.startsWith('/course/')).toBe(false);
        }
    });

    it('gives every entry an icon and a localized label', () => {
        for (const item of APP_MENU_ITEMS) {
            expect(item.icon, item.path).toMatch(/^bi /);
            expect(item.labelKey, item.path).toBeTruthy();
            // The label must exist in the strings table for every UI language.
            for (const lang of ['en', 'es', 'pt', 'fr', 'hi', 'bn']) {
                expect(Strings.get(item.labelKey, lang), `${item.labelKey}/${lang}`).toBeTruthy();
            }
        }
    });

    it('has no duplicate paths', () => {
        const paths = APP_MENU_ITEMS.map((item) => item.path);
        expect(new Set(paths).size).toBe(paths.length);
    });
});

describe('isRegisteredViewer', () => {
    it('accepts a signed-in user', () => {
        expect(isRegisteredViewer('user-1')).toBe(true);
    });

    it('rejects the guest stub and anonymous visitors', () => {
        expect(isRegisteredViewer('guest')).toBe(false);
        expect(isRegisteredViewer(null)).toBe(false);
        expect(isRegisteredViewer(undefined)).toBe(false);
        expect(isRegisteredViewer('')).toBe(false);
    });
});

describe('resolveMenuAuthAction', () => {
    it('offers sign out to a signed-in user', () => {
        expect(resolveMenuAuthAction({ isLoggedIn: true })).toBe('sign-out');
    });

    it('offers sign in to everybody else', () => {
        expect(resolveMenuAuthAction({ isLoggedIn: false })).toBe('sign-in');
        expect(resolveMenuAuthAction({})).toBe('sign-in');
    });
});
