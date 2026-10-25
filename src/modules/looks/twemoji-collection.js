// Twemoji collection helpers (pure module).
//
// The lookup table itself is generated (src/generated/twemoji-emojis.js) and
// loaded lazily by the picker; this module only turns a codepoint into the
// pinned CDN asset URL and recognises the `twemoji:` slug family used by the
// emoji overlay slot.

export const TWEMOJI_VERSION = '15.0.3';
export const TWEMOJI_CDN_BASE = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@${TWEMOJI_VERSION}/assets/svg`;
export const TWEMOJI_SLUG_PREFIX = 'twemoji:';

export function twemojiSlug(code) {
    return `${TWEMOJI_SLUG_PREFIX}${code}`;
}

export function isTwemojiSlug(slug) {
    return typeof slug === 'string' && slug.startsWith(TWEMOJI_SLUG_PREFIX) && slug.length > TWEMOJI_SLUG_PREFIX.length;
}

export function twemojiCodeFromSlug(slug) {
    return isTwemojiSlug(slug) ? slug.slice(TWEMOJI_SLUG_PREFIX.length) : null;
}

export function twemojiAssetUrl(code) {
    if (!code || typeof code !== 'string') return null;
    return `${TWEMOJI_CDN_BASE}/${code}.svg`;
}

/** The runnable character for a Twemoji code, used as an accessible label. */
export function twemojiCharacter(code) {
    if (!code || typeof code !== 'string') return '';
    const points = code
        .split('-')
        .map((part) => parseInt(part, 16))
        .filter((n) => Number.isFinite(n));
    try {
        return String.fromCodePoint(...points);
    } catch (e) {
        return '';
    }
}
