/**
 * Gets the localized string from a translation object or string.
 * @param {string|object} translationData - The translation string or object (e.g. { es: "Hola" }).
 * @param {string} lang - The user's native language code (e.g., 'es').
 * @returns {string} - The extracted string, defaulting to English if the target language is missing.
 */
export function getLocalizedTranslation(translationData, lang = 'en') {
    if (!translationData) return '';
    if (typeof translationData === 'string') return translationData;
    
    // Default to 'en' if lang is null or undefined
    const targetLang = (lang || 'en').toLowerCase();
    
    // Try the target language
    if (translationData[targetLang]) return translationData[targetLang];
    
    // Fallback to English
    if (translationData['en']) return translationData['en'];
    
    // Fallback to the first available language
    const keys = Object.keys(translationData);
    if (keys.length > 0) return translationData[keys[0]];
    
    return '';
}

/**
 * Gets both English and localized versions of a cue translation object.
 * @param {Object|string} translationData - The translation object or string.
 * @param {string} lang - The user's native language code.
 * @returns {Object} - { en: string, localized: string }
 */
export function generateHangmanOps(userResponse, cue) {
    const cueText = typeof cue === 'object' ? cue?.en : cue;
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
