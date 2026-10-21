/**
 * Bilingual Logic - Core translation extraction utilities
 *
 * These pure functions extract text for bilingual display.
 * No HTML formatting - just string extraction.
 */

import { normalizeLanguageCode } from '../utils/utils.js';

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
    if (!translationData || !lang || normalizeLanguageCode(lang) === 'en') return '';
    if (typeof translationData === 'string') return '';
    return translationData[normalizeLanguageCode(lang)] || '';
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
        && normalizeLanguageCode(lang) !== 'en'
        && !!localized
        && localized !== english
    );
}

/**
 * The English text of a translation field and the learner's-language text
 * beside it — the pair every bilingual surface renders (the mission block, a
 * course title, a topic name).
 *
 * A plain string is its own English and has no localized half; an empty field
 * has neither.
 *
 * @param {string|object} translationData - `{ en: "…" }` or a plain string
 * @param {string} lang - the learner's language
 * @returns {{ english: string, localized: string }}
 */
export function bilingualParts(translationData, lang = 'en') {
    return {
        english: getEnglish(translationData),
        localized: getLocalizedString(translationData, lang),
    };
}