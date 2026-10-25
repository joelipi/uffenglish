import { describe, it, expect } from 'vitest';
import { TWEMOJI_CATEGORIES, TWEMOJI_EMOJIS } from '../../generated/twemoji-emojis.js';
import {
    TWEMOJI_CDN_BASE,
    isTwemojiSlug,
    twemojiAssetUrl,
    twemojiCharacter,
    twemojiCodeFromSlug,
    twemojiSlug,
} from './twemoji-collection.js';

describe('the generated Twemoji collection', () => {
    it('contains the full pinned SVG set and its categories', () => {
        expect(TWEMOJI_EMOJIS.length).toBeGreaterThan(3000);
        expect(TWEMOJI_CATEGORIES).toContain('Smileys & Emotion');
        expect(TWEMOJI_CATEGORIES).toContain('Animals & Nature');
        expect(TWEMOJI_EMOJIS.find((e) => e.code === '1f600').name).toMatch(/grinning/i);
    });

    it('has no duplicate codes', () => {
        const codes = new Set(TWEMOJI_EMOJIS.map((e) => e.code));
        expect(codes.size).toBe(TWEMOJI_EMOJIS.length);
    });
});

describe('Twemoji slug helpers', () => {
    it('round-trips a slug and builds the pinned CDN URL', () => {
        const slug = twemojiSlug('1f600');
        expect(slug).toBe('twemoji:1f600');
        expect(isTwemojiSlug(slug)).toBe(true);
        expect(twemojiCodeFromSlug(slug)).toBe('1f600');
        expect(twemojiAssetUrl('1f600')).toBe(`${TWEMOJI_CDN_BASE}/1f600.svg`);
    });

    it('rejects non-Twemoji slugs', () => {
        expect(isTwemojiSlug('smiley')).toBe(false);
        expect(isTwemojiSlug('twemoji:')).toBe(false);
        expect(twemojiCodeFromSlug('smiley')).toBeNull();
    });

    it('turns a code into its Unicode character', () => {
        expect(twemojiCharacter('1f600')).toBe('😀');
    });
});
