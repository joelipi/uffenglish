/**
 * Bilingual Logic - Core translation extraction utilities
 *
 * These pure functions extract text for bilingual display.
 * No HTML formatting - just string extraction.
 */

/**
 * Extract English text from a translation field.
 * @param {string|object} translationData
 * @returns {string}
 */
export function getEnglish(translationData) {
    if (!translationData) return '';
    if (typeof translationData === 'string') return translationData;
    return translationData.en || '';
}

/**
 * Extract the user-language text from a translation field.
 * @param {string|object} translationData
 * @param {string} lang
 * @returns {string}
 */
export function getLocalizedString(translationData, lang) {
    if (!translationData || !lang || lang === 'en') return '';
    if (typeof translationData === 'string') return '';
    return translationData[lang] || '';
}

/**
 * True when a distinct localized version worth showing exists.
 * @param {string} english
 * @param {string} localized
 * @param {string} lang
 * @returns {boolean}
 */
export function shouldShowLocalized(english, localized, lang) {
    return (
        !!english
        && !!lang
        && lang !== 'en'
        && !!localized
        && localized !== english
    );
}