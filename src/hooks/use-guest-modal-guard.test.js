import { describe, it, expect, beforeEach, vi } from 'vitest';

// The guard hook pulls in react-router, react-query, and the API layer; mock
// them so we can unit-test the pure browser-language detection in isolation.
vi.mock('react-router-dom', () => ({
    useLocation: () => ({ pathname: '/', search: '' }),
}));
vi.mock('../modules/api/api.js', () => ({
    useAuthStatus: () => ({ data: false, isLoading: false }),
}));
vi.mock('./usePreloader.js', () => ({
    usePreloader: () => ({ finishPreloader: () => {} }),
}));

import { detectBrowserLanguage } from './use-guest-modal-guard.js';

function setNavigatorLanguage(value) {
    Object.defineProperty(navigator, 'language', {
        value,
        configurable: true,
        writable: true,
    });
}

describe('detectBrowserLanguage', () => {
    beforeEach(() => {
        setNavigatorLanguage('en-US');
    });

    it('detects Hindi from navigator.language', () => {
        setNavigatorLanguage('hi');
        expect(detectBrowserLanguage()).toBe('HI');
        setNavigatorLanguage('hi-IN');
        expect(detectBrowserLanguage()).toBe('HI');
    });

    it('detects Bengali from navigator.language', () => {
        setNavigatorLanguage('bn');
        expect(detectBrowserLanguage()).toBe('BN');
        setNavigatorLanguage('bn-BD');
        expect(detectBrowserLanguage()).toBe('BN');
    });

    it('detects other supported languages', () => {
        setNavigatorLanguage('es-ES');
        expect(detectBrowserLanguage()).toBe('ES');
        setNavigatorLanguage('fr');
        expect(detectBrowserLanguage()).toBe('FR');
    });

    it('falls back to EN when navigator.language is missing', () => {
        setNavigatorLanguage('');
        expect(detectBrowserLanguage()).toBe('EN');
    });
});
