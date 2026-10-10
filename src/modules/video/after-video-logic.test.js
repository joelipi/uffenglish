// after-video-logic.test.js
// Unit tests for the after-video slug/URL resolver (stories/060-autoplay-share-video).
// The last describe block is a source guard: the resolver must stay a pure
// logic module (shared helpers only, no React/DOM), mirroring the
// video-processor-logic.js portability rule.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    AFTER_SUCCESS_BASE,
    AFTER_SHARE_BASE,
    KEEP_PLAYING_ON_HIDDEN,
    resolveAfterVideoSlugs,
    buildAfterVideoUrls,
    shouldAutoPauseOnHidden,
} from './after-video-logic.js';
import { getVideoUrl } from './video-url.js';

describe('resolveAfterVideoSlugs', () => {
    it('returns lang, English fallback, then bare base for a guest language', () => {
        expect(resolveAfterVideoSlugs('aftersuccess', 'es', null)).toEqual([
            'aftersuccess-es',
            'aftersuccess-en',
            'aftersuccess',
        ]);
    });

    it('prefers the profile language when no guest language is set', () => {
        expect(resolveAfterVideoSlugs('aftershare', null, 'bn')).toEqual([
            'aftershare-bn',
            'aftershare-en',
            'aftershare',
        ]);
    });

    it('lets the guest language win and dedupes the English fallback', () => {
        expect(resolveAfterVideoSlugs('aftersuccess', 'en', 'es')).toEqual([
            'aftersuccess-en',
            'aftersuccess',
        ]);
    });

    it('normalizes region tags to the bare language code', () => {
        const slugs = resolveAfterVideoSlugs('aftershare', 'ES-MX', null);
        expect(slugs[0]).toBe('aftershare-es');
    });

    it('defaults to English when both languages are missing', () => {
        expect(resolveAfterVideoSlugs('aftersuccess', null, undefined)).toEqual([
            'aftersuccess-en',
            'aftersuccess',
        ]);
    });

    it('exposes the hardcoded bases', () => {
        expect(AFTER_SUCCESS_BASE).toBe('aftersuccess');
        expect(AFTER_SHARE_BASE).toBe('aftershare');
    });
});

describe('buildAfterVideoUrls', () => {
    it('maps every slug through getVideoUrl in preference order', () => {
        const slugs = resolveAfterVideoSlugs('aftersuccess', 'pt', null);
        expect(buildAfterVideoUrls('aftersuccess', 'pt', null)).toEqual(
            slugs.map(getVideoUrl)
        );
    });

    it('resolves the bare fallback to the proxied/CDN video URL shape', () => {
        const urls = buildAfterVideoUrls('aftershare', 'en', null);
        expect(urls[urls.length - 1]).toMatch(/\/aftershare\.mp4$/);
    });
});

describe('background playback rule', () => {
    it('never auto-pauses on hidden', () => {
        expect(shouldAutoPauseOnHidden()).toBe(false);
        expect(KEEP_PLAYING_ON_HIDDEN).toBe(true);
    });
});

describe('after-video-logic.js purity guard', () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(path.join(__dirname, 'after-video-logic.js'), 'utf8');

    it('wires the shared helpers instead of re-implementing them', () => {
        expect(raw).toContain('normalizeLanguageCode');
        expect(raw).toContain('resolveConfigLanguage');
        expect(raw).toContain('getVideoUrl');
    });

    it('builds no URLs inline', () => {
        expect(raw).not.toMatch(/r2\.ultrafastfluency\.com/);
        expect(raw).not.toMatch(/\/assets\/videos\//);
    });

    it('imports no React, DOM, or React Native surface', () => {
        expect(raw).not.toMatch(/from 'react'/);
        expect(raw).not.toMatch(/\bdocument\b/);
        expect(raw).not.toMatch(/\bwindow\b/);
        expect(raw).not.toMatch(/react-native/i);
    });
});
