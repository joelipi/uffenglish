/**
 * Gets the localized string from a translation object or string.
 * @param {string|object} translationData - The translation string or object (e.g. { es: "Hola" }).
 * @param {string} lang - The user's native language code (e.g., 'es').
 * @returns {string} - The extracted string, defaulting to English if the target language is missing.
 */
/**
 * Extracts the displayable English cue text from any cue shape.
 * String → the string.  Bilingual object → .en.  Array → first element's .en.
 * Regex → .en || .pattern.  Template string → the string.
 */
export function getCueText(cue) {
    if (!cue) return '';
    if (typeof cue === 'string') return cue;
    if (Array.isArray(cue)) return getCueText(cue[0]);
    if (cue.type === 'regex') return cue.en || cue.pattern || '';
    return cue.en || '';
}

export function getLocalizedTranslation(translationData, lang = 'en') {
    if (!translationData) return '';

    // ── String: return as-is ──
    if (typeof translationData === 'string') return translationData;

    // ── Array: recurse into the first element ──
    if (Array.isArray(translationData)) {
        return getLocalizedTranslation(translationData[0], lang);
    }

    // ── Regex object: use .en, localized key, or pattern as fallback ──
    if (translationData.type === 'regex') {
        const targetLang = (lang || 'en').toLowerCase();
        if (translationData[targetLang]) return translationData[targetLang];
        if (translationData.en) return translationData.en;
        return translationData.pattern || '';
    }

    // Default to 'en' if lang is null or undefined
    const targetLang = (lang || 'en').toLowerCase();

    // Try the target language
    if (translationData[targetLang]) return translationData[targetLang];

    // Fallback to English
    if (translationData['en']) return translationData['en'];

    return '';
}

/**
 * Gets both English and localized versions of a cue translation object.
 * @param {Object|string} translationData - The translation object or string.
 * @param {string} lang - The user's native language code.
 * @returns {Object} - { en: string, localized: string }
 */
export function generateHangmanOps(userResponse, cue) {
    const cueText = getCueText(cue);
    const tokenize = str => str.trim().match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)?|[^\p{L}\p{N}\s]+|\s+/gu) || [];
    const tokA = tokenize(userResponse || ""), tokB = tokenize(cueText || "");
    const m = tokA.length, n = tokB.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = tokA[i - 1].toLowerCase() === tokB[j - 1].toLowerCase() ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

    const ops = []; let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && tokA[i - 1].toLowerCase() === tokB[j - 1].toLowerCase()) { ops.unshift({ type: 'eq', val: tokB[j - 1] }); i--; j--; }
        else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { ops.unshift({ type: 'ins', val: tokB[j - 1] }); j--; }
        else { ops.unshift({ type: 'del', val: tokA[i - 1] }); i--; }
    }
    return ops;
}
