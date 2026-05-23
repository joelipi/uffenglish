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
    const targetLang = lang || 'en';
    
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
export function getBilingualCue(translationData, lang = 'en') {
    if (!translationData) return { en: '', localized: '' };
    if (typeof translationData === 'string') return { en: translationData, localized: translationData };
    
    const enVersion = translationData['en'] || '';
    const localizedVersion = lang && lang !== 'en' && translationData[lang]
        ? translationData[lang]
        : enVersion;
    
    return { en: enVersion, localized: localizedVersion };
}
