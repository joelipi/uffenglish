// modules/pwa/install-prompt-logic.test.js
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    STANDALONE_DISPLAY_MODE_QUERY,
    shouldOfferInstall,
    openInstallDialog,
    toInstallLocale,
} from './install-prompt-logic.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('shouldOfferInstall', () => {
    it('offers the install entry point when the app is not installed', () => {
        expect(shouldOfferInstall({ isStandalone: false })).toBe(true);
        expect(shouldOfferInstall({})).toBe(true);
        expect(shouldOfferInstall()).toBe(true);
    });

    it('hides the entry point inside an already-installed (standalone) app', () => {
        expect(shouldOfferInstall({ isStandalone: true })).toBe(false);
    });
});

describe('openInstallDialog', () => {
    it('asks the registered install element to open its dialog', () => {
        const showDialog = vi.fn();
        expect(openInstallDialog({ showDialog })).toBe(true);
        expect(showDialog).toHaveBeenCalledWith(false);
    });

    it('passes force through so the dialog can open without a native prompt', () => {
        const showDialog = vi.fn();
        expect(openInstallDialog({ showDialog }, { force: true })).toBe(true);
        expect(showDialog).toHaveBeenCalledWith(true);
    });

    it('is fail-open for a missing, un-upgraded or broken element', () => {
        expect(openInstallDialog(null)).toBe(false);
        expect(openInstallDialog(undefined)).toBe(false);
        expect(openInstallDialog({})).toBe(false);
        expect(openInstallDialog({ showDialog: 'not-a-function' })).toBe(false);

        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const boom = () => { throw new Error('dialog exploded'); };
        expect(openInstallDialog({ showDialog: boom })).toBe(false);
        expect(error).toHaveBeenCalled();
    });
});

describe('STANDALONE_DISPLAY_MODE_QUERY', () => {
    it('is the standard installed-PWA media query', () => {
        expect(STANDALONE_DISPLAY_MODE_QUERY).toBe('(display-mode: standalone)');
    });
});

describe('toInstallLocale', () => {
    it('maps the supported app languages to the dialog locales', () => {
        expect(toInstallLocale('en')).toBe('en');
        expect(toInstallLocale('es')).toBe('es');
        expect(toInstallLocale('pt')).toBe('pt');
        expect(toInstallLocale('fr')).toBe('fr');
    });

    it('normalizes the app\'s uppercase codes and full locales', () => {
        expect(toInstallLocale('EN')).toBe('en');
        expect(toInstallLocale('ES')).toBe('es');
        expect(toInstallLocale('PT')).toBe('pt');
        expect(toInstallLocale('FR')).toBe('fr');
        expect(toInstallLocale('es-ES')).toBe('es');
        expect(toInstallLocale('pt_BR')).toBe('pt');
    });

    it('falls back to English for languages the dialog does not ship', () => {
        // The component has no hi/bn translations, so they resolve the same way
        // its own lookup does when a locale is missing.
        expect(toInstallLocale('hi')).toBe('en');
        expect(toInstallLocale('bn')).toBe('en');
        expect(toInstallLocale('HI')).toBe('en');
        expect(toInstallLocale('de')).toBe('en');
        expect(toInstallLocale('OTHER')).toBe('en');
        expect(toInstallLocale('')).toBe('en');
        expect(toInstallLocale(null)).toBe('en');
        expect(toInstallLocale(undefined)).toBe('en');
        expect(toInstallLocale(42)).toBe('en');
    });
});
