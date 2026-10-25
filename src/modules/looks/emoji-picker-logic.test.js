import { describe, it, expect } from 'vitest';
import { DEFAULT_EMOJI_CATEGORY, EMOJI_PAGE_SIZE, filterEmojis, visibleEmojis } from './emoji-picker-logic.js';

const EMOJIS = [
    { code: '1f600', name: 'Grinning face', category: 'Smileys & Emotion' },
    { code: '1f436', name: 'Dog face', category: 'Animals & Nature' },
    { code: '1f921', name: 'Clown face', category: 'Smileys & Emotion' },
];

describe('filterEmojis', () => {
    it('keeps only the active category', () => {
        expect(filterEmojis(EMOJIS, { category: DEFAULT_EMOJI_CATEGORY }).map((e) => e.code))
            .toEqual(['1f600', '1f921']);
    });

    it('matches a case-insensitive name or code query', () => {
        expect(filterEmojis(EMOJIS, { category: 'Animals & Nature', query: 'DOG' }).map((e) => e.code))
            .toEqual(['1f436']);
        // Search is global, not limited to the browsed category.
        expect(filterEmojis(EMOJIS, { category: DEFAULT_EMOJI_CATEGORY, query: 'dog' }).map((e) => e.code))
            .toEqual(['1f436']);
        expect(filterEmojis(EMOJIS, { category: DEFAULT_EMOJI_CATEGORY, query: '1f921' }).map((e) => e.code))
            .toEqual(['1f921']);
    });

    it('tolerates a missing collection', () => {
        expect(filterEmojis(null, { category: DEFAULT_EMOJI_CATEGORY })).toEqual([]);
    });
});

describe('visibleEmojis', () => {
    it('caps the rendered page and can grow it', () => {
        const many = Array.from({ length: EMOJI_PAGE_SIZE + 10 }, (_, i) => ({ code: String(i) }));
        expect(visibleEmojis(many, EMOJI_PAGE_SIZE)).toHaveLength(EMOJI_PAGE_SIZE);
        expect(visibleEmojis(many, EMOJI_PAGE_SIZE + 10)).toHaveLength(EMOJI_PAGE_SIZE + 10);
    });
});
