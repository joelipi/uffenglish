// --- modules/video-source.js ---
// Friend/UGC-vs-system video classification, shared by the URL resolver
// (video-url.js) and the recap planner (video-processor-logic.js).
// No browser globals, no URL construction — safe for any platform.
// (Not stateless: the share-code registry below is module state, set once the
// codes are known.)
//
// A UGC slug starts with a share code: `{recorder}-{inviter}-{course}-...`
// (the recorder is whoever recorded the clip, the inviter is the code that
// invited them; the same code twice when self-initiated). UGC covers both a
// friend's recorded clip and the concatenated end-of-lesson recap.
//
// UGC is identified by MATCHING THE CODES ACTUALLY IN PLAY, never by the slug's
// shape: a share code and a course/word segment are both just [a-z0-9] runs, so
// a shape rule would misclassify a system slug whose words are hyphenated
// ("do-you-think-youre-a-good-friend"). The app knows its own code and
// the friend's code at every call site that matters; the rest of the app uses
// the registry set once the codes are known.

// The share codes currently in play: the user's own and the friend's.
let knownShareCodes = [];

/** Replace the set of share codes considered "in play". */
export function setKnownShareCodes(codes) {
    knownShareCodes = (codes || [])
        .filter((c) => typeof c === 'string' && c.trim() !== '')
        .map((c) => c.trim().toLowerCase());
}

/**
 * Whether a slug is a UGC clip: it starts with one of the codes in play.
 *
 * @param {string} slug
 * @param {string[]} [codes] defaults to the registry set by setKnownShareCodes
 * @returns {boolean}
 */
export function isUgcSlug(slug, codes = knownShareCodes) {
    if (typeof slug !== 'string' || slug === '') return false;
    // An unresolved friend reference (pre-{friendCode}-substitution) is UGC too;
    // it is a placeholder, not a shape guess.
    if (slug.includes('{friendCode}')) return true;
    if (!Array.isArray(codes) || codes.length === 0) return false;
    const lower = slug.toLowerCase();
    return codes.some((c) => c && lower.startsWith(`${String(c).toLowerCase()}-`));
}

// Historical name (predates recaps counting as UGC too). Same behaviour.
export const isFriendVideoSlug = isUgcSlug;

export function remoteSource(slug, codes) {
    return isUgcSlug(slug, codes) ? 'friend' : 'system';
}
