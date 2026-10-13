// modules/pwa/install-prompt-logic.test.js
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    STANDALONE_DISPLAY_MODE_QUERY,
    shouldOfferInstall,
    openInstallDialog,
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
