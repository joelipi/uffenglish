// modules/pwa/install-prompt-webonly.test.js
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    readIsStandaloneApp,
    registerInstallElement,
    getRegisteredInstallElement,
} from './install-prompt-webonly.js';
import { STANDALONE_DISPLAY_MODE_QUERY } from './install-prompt-logic.js';

afterEach(() => {
    delete window.matchMedia;
    delete window.navigator.standalone;
    registerInstallElement(null);
    vi.restoreAllMocks();
});

describe('readIsStandaloneApp', () => {
    it('reads false when the browser exposes no display-mode matchMedia (jsdom, old browsers)', () => {
        expect(typeof window.matchMedia).toBe('undefined');
        expect(readIsStandaloneApp()).toBe(false);
    });

    it('reads true when the standalone display mode matches', () => {
        window.matchMedia = vi.fn((query) => ({ matches: query === STANDALONE_DISPLAY_MODE_QUERY }));
        expect(readIsStandaloneApp()).toBe(true);
    });

    it('reads true from iOS Safari navigator.standalone', () => {
        window.navigator.standalone = true;
        expect(readIsStandaloneApp()).toBe(true);
    });

    it('fails closed (not installed) when the media query throws', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        window.matchMedia = () => { throw new Error('media query exploded'); };
        expect(readIsStandaloneApp()).toBe(false);
        expect(error).toHaveBeenCalled();
    });
});

describe('install element registry', () => {
    it('bridges the mounted dialog element to its trigger button', () => {
        expect(getRegisteredInstallElement()).toBeNull();
        const element = { showDialog: vi.fn() };
        registerInstallElement(element);
        expect(getRegisteredInstallElement()).toBe(element);
    });

    it('clears the registration on unmount / a falsy value', () => {
        registerInstallElement({ showDialog: vi.fn() });
        registerInstallElement(null);
        expect(getRegisteredInstallElement()).toBeNull();
        registerInstallElement(undefined);
        expect(getRegisteredInstallElement()).toBeNull();
    });
});
