// Pure filtering/paging for the emoji overlay picker.

export const EMOJI_PAGE_SIZE = 240;
export const DEFAULT_EMOJI_CATEGORY = 'Smileys & Emotion';

/** Filter by the active category and a case-insensitive name/code query. */
export function filterEmojis(emojis, { category, query } = {}) {
    if (!Array.isArray(emojis)) return [];
    const q = String(query || '').trim().toLowerCase();
    return emojis.filter((emoji) => {
        // A search is global; the category filter only narrows browsing.
        if (!q && category && emoji.category !== category) return false;
        if (!q) return true;
        return emoji.name.toLowerCase().includes(q) || emoji.code.toLowerCase().includes(q);
    });
}

/** The page shown so far: the picker renders a bounded number of cells. */
export function visibleEmojis(emojis, visibleCount = EMOJI_PAGE_SIZE) {
    if (!Array.isArray(emojis)) return [];
    return emojis.slice(0, Math.max(0, visibleCount));
}
