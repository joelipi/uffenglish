import { describe, it, expect } from 'vitest';
import { currentSiteOrigin } from './current-site-origin.webonly.js';

describe('currentSiteOrigin', () => {
    it('returns the origin the page is served from', () => {
        expect(currentSiteOrigin({ location: { origin: 'https://s.ultrafastfluency.com' } }))
            .toBe('https://s.ultrafastfluency.com');
    });

    it('keeps the scheme and the port of a dev server', () => {
        expect(currentSiteOrigin({ location: { origin: 'http://localhost:5173' } }))
            .toBe('http://localhost:5173');
    });

    it('falls back to the canonical apex when there is no window', () => {
        expect(currentSiteOrigin({})).toBe('https://ultrafastfluency.com');
        expect(currentSiteOrigin({ location: {} })).toBe('https://ultrafastfluency.com');
    });

    it('falls back to the canonical apex for a file:// page', () => {
        // A file:// document reports the string "null" as its origin.
        expect(currentSiteOrigin({ location: { origin: 'null' } })).toBe('https://ultrafastfluency.com');
        expect(currentSiteOrigin({ location: { origin: '' } })).toBe('https://ultrafastfluency.com');
    });

    it('uses the real window by default', () => {
        // jsdom serves the page from http://localhost:3000/ by default.
        expect(currentSiteOrigin()).toBe(window.location.origin);
    });
});
