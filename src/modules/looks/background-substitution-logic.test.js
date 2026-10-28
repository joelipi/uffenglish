// Unit tests for the studio's live substitution rules (stories/100).
// The module is pure, so every decision the browser adapter and the static
// studio page rely on is pinned here without a canvas, a camera or a model.

import { describe, it, expect } from 'vitest';
import {
    DEFAULT_MASK_BLEND_WEIGHT,
    blendMaskAlpha,
    resolveEdgeSpillMix,
    isAllowedRemoteImageUrl,
    resolveBackgroundSource,
    resolveForegroundSource,
    resolveAssetLayerState,
    shouldStartTake,
    resolveExpandablePane,
    resolveSubstitutionDimensions,
    overlaySelectionFor,
} from './background-substitution-logic.js';
import { OVERLAY_SLUGS } from './recording-looks-logic.js';

describe('resolveSubstitutionDimensions', () => {
    it('captures at the social master size with a 256×256 segmentation input', () => {
        expect(resolveSubstitutionDimensions()).toEqual({
            width: 1080,
            height: 1920,
            fps: 30,
            maskWidth: 256,
            maskHeight: 256,
        });
    });

    it('keeps the mask input far below the output so no 1080p readback is needed', () => {
        const dims = resolveSubstitutionDimensions();
        expect(dims.maskWidth * dims.maskHeight).toBeLessThan((dims.width * dims.height) / 20);
    });
});

describe('blendMaskAlpha', () => {
    it('converts confidence to one byte of alpha per pixel', () => {
        const out = blendMaskAlpha({ next: [0, 0.5, 1] });
        expect(out).toBeInstanceOf(Uint8Array);
        expect([...out]).toEqual([0, 128, 255]);
    });

    it('blends the previous mask in at the default weight', () => {
        // 0.85 × 255 + 0.15 × 0 = 216.75 → 217
        const out = blendMaskAlpha({ next: [1, 1], previous: new Uint8Array([0, 0]) });
        expect([...out]).toEqual([217, 217]);
        expect(DEFAULT_MASK_BLEND_WEIGHT).toBe(0.85);
    });

    it('uses the new mask verbatim when the weight is 1', () => {
        const out = blendMaskAlpha({ next: [0.4], previous: new Uint8Array([255]), weight: 1 });
        expect([...out]).toEqual([102]);
    });

    it('ignores a previous mask of a different length', () => {
        const out = blendMaskAlpha({ next: [1, 1], previous: new Uint8Array([0]) });
        expect([...out]).toEqual([255, 255]);
    });

    it('clamps out-of-range confidence and never throws on empty input', () => {
        expect([...blendMaskAlpha({ next: [-3, 7] })]).toEqual([0, 255]);
        expect(blendMaskAlpha({}).length).toBe(0);
    });
});

describe('resolveEdgeSpillMix', () => {
    it('leaves solid person and solid background untouched', () => {
        expect(resolveEdgeSpillMix(0)).toBe(0);
        expect(resolveEdgeSpillMix(0.1)).toBe(0);
        expect(resolveEdgeSpillMix(0.9)).toBe(0);
        expect(resolveEdgeSpillMix(1)).toBe(0);
    });

    it('peaks at half alpha', () => {
        expect(resolveEdgeSpillMix(0.5)).toBeCloseTo(0.15, 6);
        expect(resolveEdgeSpillMix(0.5, 0.4)).toBeCloseTo(0.4, 6);
    });

    it('ramps down to zero at the rim boundaries', () => {
        expect(resolveEdgeSpillMix(0.15)).toBe(0);
        expect(resolveEdgeSpillMix(0.85)).toBe(0);
        expect(resolveEdgeSpillMix(0.3)).toBeGreaterThan(0);
        expect(resolveEdgeSpillMix(0.3)).toBeLessThan(resolveEdgeSpillMix(0.5));
    });
});

describe('isAllowedRemoteImageUrl', () => {
    it('allows public https images', () => {
        expect(isAllowedRemoteImageUrl('https://r2.ultrafastfluency.com/assets/bg/studio.png')).toBe(true);
        expect(isAllowedRemoteImageUrl('https://upload.wikimedia.org/a/b.png')).toBe(true);
        expect(isAllowedRemoteImageUrl('https://8.8.8.8/bg.png')).toBe(true);
    });

    it('refuses every non-https scheme', () => {
        expect(isAllowedRemoteImageUrl('http://example.com/a.png')).toBe(false);
        expect(isAllowedRemoteImageUrl('data:image/png;base64,AAAA')).toBe(false);
        expect(isAllowedRemoteImageUrl('javascript:alert(1)')).toBe(false);
        expect(isAllowedRemoteImageUrl('not a url')).toBe(false);
        expect(isAllowedRemoteImageUrl(null)).toBe(false);
    });

    it('refuses loopback, private, link-local and CGNAT targets', () => {
        for (const host of [
            'localhost',
            'foo.localhost',
            'something.local',
            'printer.internal',
            '127.0.0.1',
            '127.1.2.3',
            '10.0.0.5',
            '172.16.0.1',
            '172.31.255.254',
            '192.168.1.10',
            '169.254.169.254',
            '100.64.0.1',
            '0.0.0.0',
        ]) {
            expect(isAllowedRemoteImageUrl(`https://${host}/bg.png`), host).toBe(false);
        }
    });

    it('refuses IPv6 loopback, unique-local and link-local', () => {
        for (const host of ['[::1]', '[::]', '[fd00::1]', '[fc00::1]', '[fe80::1]']) {
            expect(isAllowedRemoteImageUrl(`https://${host}/bg.png`), host).toBe(false);
        }
        expect(isAllowedRemoteImageUrl('https://[2606:4700::1111]/bg.png')).toBe(true);
    });
});

describe('resolveBackgroundSource / resolveForegroundSource', () => {
    it('passes a public https URL straight through', () => {
        const url = 'https://r2.ultrafastfluency.com/assets/bg/studio.png';
        expect(resolveBackgroundSource(url)).toBe(url);
        expect(resolveForegroundSource(url)).toBe(url);
    });

    it('resolves a bare name inside the layer directory', () => {
        expect(resolveBackgroundSource('studio.png')).toBe('/overlays/backgrounds/studio.png');
        expect(resolveBackgroundSource('studio')).toBe('/overlays/backgrounds/studio.png');
        expect(resolveForegroundSource('studio.png')).toBe('/overlays/foregrounds/studio.png');
        expect(resolveForegroundSource('desk')).toBe('/overlays/foregrounds/desk.png');
    });

    it('treats the off values as no layer', () => {
        for (const value of ['', '   ', 'none', 'None', 'skip', 'SKIP']) {
            expect(resolveBackgroundSource(value), value).toBeNull();
        }
    });

    it('refuses other schemes, path traversal and path-shaped values', () => {
        for (const value of [
            'http://example.com/a.png',
            'javascript:alert(1)',
            'data:image/png;base64,AAAA',
            'file:///etc/passwd',
            '../x.png',
            'a/b.png',
            'a\\b.png',
            'http://127.0.0.1/a.png',
            'https://127.0.0.1/a.png',
        ]) {
            expect(resolveBackgroundSource(value), value).toBeNull();
        }
    });
});

describe('resolveAssetLayerState', () => {
    it('is "none" for a blank or off value', () => {
        expect(resolveAssetLayerState({ sheetValue: '' })).toBe('none');
        expect(resolveAssetLayerState({ sheetValue: 'none' })).toBe('none');
        expect(resolveAssetLayerState({ sheetValue: 'skip' })).toBe('none');
    });

    it('is "error" when the value cannot be resolved', () => {
        expect(resolveAssetLayerState({ sheetValue: '../x.png' })).toBe('error');
        expect(resolveAssetLayerState({ sheetValue: 'studio.png', imageError: true })).toBe('error');
    });

    it('is "loading" then "ready" while the image decodes', () => {
        expect(resolveAssetLayerState({ sheetValue: 'studio.png' })).toBe('loading');
        expect(resolveAssetLayerState({ sheetValue: 'studio.png', imageLoaded: true })).toBe('ready');
    });

    it('uses the injected resolver for the foreground directory', () => {
        const state = resolveAssetLayerState({
            sheetValue: 'desk',
            resolver: resolveForegroundSource,
            imageLoaded: true,
        });
        expect(state).toBe('ready');
    });
});

describe('shouldStartTake', () => {
    it('starts when no layer is configured', () => {
        expect(shouldStartTake({})).toBe(true);
        expect(shouldStartTake({ backgroundState: 'none', foregroundState: 'none' })).toBe(true);
    });

    it('starts when every configured layer is ready', () => {
        expect(shouldStartTake({ backgroundState: 'ready', foregroundState: 'ready' })).toBe(true);
        expect(shouldStartTake({ backgroundState: 'ready', foregroundState: 'none' })).toBe(true);
    });

    it('refuses while a layer is loading or failed', () => {
        expect(shouldStartTake({ backgroundState: 'loading' })).toBe(false);
        expect(shouldStartTake({ backgroundState: 'error' })).toBe(false);
        expect(shouldStartTake({ foregroundState: 'loading' })).toBe(false);
        expect(shouldStartTake({ foregroundState: 'error' })).toBe(false);
    });
});

describe('resolveExpandablePane', () => {
    it('expands the live preview until a take exists', () => {
        expect(resolveExpandablePane({ isReviewing: false })).toBe('preview');
        expect(resolveExpandablePane()).toBe('preview');
    });

    it('expands the recorded take once reviewing', () => {
        expect(resolveExpandablePane({ isReviewing: true })).toBe('playback');
    });
});

describe('overlaySelectionFor', () => {
    it('keeps the prop slots and turns every other category off', () => {
        const selection = overlaySelectionFor({ face: 'carnival', upper: 'witchhat', lower: 'cauldron' });
        expect(selection.slots.face).toBe('carnival');
        expect(selection.slots.upper).toBe('witchhat');
        expect(selection.slots.lower).toBe('cauldron');
        expect(selection.filterId).toBe('none');
        expect(selection.lensId).toBe('none');
        expect(selection.screenId).toBe('none');
    });

    it('accepts a twemoji slug only in the emoji slot', () => {
        const emojiSlug = OVERLAY_SLUGS.includes('smiley-twemoji') ? 'smiley-twemoji' : null;
        if (!emojiSlug) return;
        expect(overlaySelectionFor({ emoji: emojiSlug }).slots.emoji).toBe(emojiSlug);
        expect(overlaySelectionFor({ face: emojiSlug }).slots.face).toBeNull();
    });

    it('drops unknown slugs', () => {
        const selection = overlaySelectionFor({ face: 'nope-not-a-slug' });
        expect(selection.slots.face).toBeNull();
    });
});
