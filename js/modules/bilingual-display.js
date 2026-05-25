/**
 * Bilingual Display Utility (Platform-Agnostic)
 *
 * Formats translation fields stored as `{ en: "...", es: "…" }` objects so
 * that English is always shown and a localized version is appended when
 * that version differs from English.
 *
 * Returns structured data for platform-specific rendering (React/React Native).
 */

import { getEnglish, getLocalizedString, shouldShowLocalized } from './bilingual-logic.js';

/**
 * Formats a translation field as structured data for platform-specific rendering.
 *
 * @param {string|object} [translationData] — `{ en: "…", es: "…" }` or `"plain"`
 * @param {string}        [userLang='en']      — e.g. `"es"`, `"pt"`, `null`, `undefined`
 * @param {object}        [options={}]
 * @param {string}  [options.enPrefix='']          — text before the English portion
 * @param {string}  [options.enSuffix='']          — text after the English portion
 * @param {string}  [options.spanPrefix='/ ']      — text between `/` and localized
 * @param {boolean} [options.skipEnglish=false]     — emit only the localized portion
 * @returns {object} Structured data for platform-specific rendering
 */
export function formatBilingualText(
    translationData,
    userLang = 'en',
    { enPrefix = '', enSuffix = '', spanPrefix = ' ', skipEnglish = false } = {}
) {
    const lang = String(userLang || 'en').toLowerCase();
    const english = getEnglish(translationData);
    const localized = getLocalizedString(translationData, lang);

    if (skipEnglish) {
        // When the caller passes a plain string, treat it as the localized text
        // and return only the localized portion.
        const content = typeof translationData === 'string'
            ? translationData
            : localized;

        console.log('formatBilingualText skipEnglish result:', {
            localized: content,
            lang,
            shouldShowLocalized: !!content
        });

        return {
            localized: content,
            lang,
            shouldShowLocalized: !!content
        };
    }

    const showLocalized = shouldShowLocalized(english, localized, userLang);

    if (showLocalized) {
        console.log('formatBilingualText bilingual result:', {
            english,
            localized,
            lang,
            shouldShowLocalized: true,
            enPrefix,
            enSuffix,
            spanPrefix
        });

        return {
            english,
            localized,
            lang,
            shouldShowLocalized: true,
            enPrefix,
            enSuffix,
            spanPrefix
        };
    }

    // Single-language fallback
    console.log('formatBilingualText fallback result:', {
        english,
        shouldShowLocalized: false
    });

    return {
        english,
        shouldShowLocalized: false
    };
}
