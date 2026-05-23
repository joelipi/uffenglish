/**
 * Bilingual Display Utility
 *
 * Formats translation fields stored as `{ en: "...", es: "…" }` objects so
 * that English is always shown and a `<span lang="L">` with the user-language
 * version is appended when that version differs from English.
 *
 *     `Hello <span lang="es">/ ¿Cómo estás?</span>`
 *     `Hello`                               ← single-language or identical
 *     `Hello`                               ← lang is `en`, `null`, or `undefined`
 */

/**
 * Extract English text from a translation field.
 * @param {string|object} translationData
 * @returns {string}
 */
function getEnglish(translationData) {
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
function getLocalizedString(translationData, lang) {
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
function shouldShowLocalized(english, localized, lang) {
    return (
        !!english
        && !!lang
        && lang !== 'en'
        && !!localized
        && localized !== english
    );
}

/**
 * Formats a translation field as bilingual HTML.
 *
 * **Default output**
 * ```
 * English <span lang="es">/ Localized</span>
 * ```
 *
 * the `/` separator inside the span are both hardcoded.
 *
 * `spanPrefix` controls what is appended *after* the `/` and *before* the
 * localized word inside the `<span>`.  Default `' '` produces `/ Hola`.
 * Pass `'// '` for `/ // Hola`, or `''` for `/Hola`.
 *
 * `enPrefix` / `enSuffix` let callers wrap the English portion
 * (e.g. `<strong>`  /  `</strong>`).
 *
 * `{ skipEnglish: true }` emits only the `<span lang="…">localized</span>`.
 *
 * @param {string|object} [translationData] — `{ en: "…", es: "…" }` or `"plain"`
 * @param {string}        [userLang='en']      — e.g. `"es"`, `"pt"`, `null`, `undefined`
 * @param {object}        [options={}]
 * @param {string}  [options.enPrefix='']          — text before the English portion
 * @param {string}  [options.enSuffix='']          — text after the English portion
 * @param {string}  [options.spanPrefix='/ ']      — text inside span between `/` and localized
 * @param {boolean} [options.skipEnglish=false]     — emit only the localized span
 * @param {Function} [options.wrapper=html=>html]  — wrap the final HTML string
 * @returns {string} HTML for `.innerHTML` / Zustand `htmlChunk`
 */
export function formatBilingualHTML(
    translationData,
    userLang = 'en',
    { enPrefix = '', enSuffix = '', spanPrefix = ' ', skipEnglish = false, wrapper = _v => _v } = {}
) {
    const lang = String(userLang || 'en').toLowerCase();
    const english = getEnglish(translationData);
    const localized = getLocalizedString(translationData, lang);

    console.trace('formatBilingualHTML called', {
        translationData,
        userLang,
        options: { enPrefix, enSuffix, spanPrefix, skipEnglish },
        english,
        localized
    });

    if (skipEnglish) {
        // when the caller passes a plain string, treat it as the localized text
        // and return just the <span lang="..."> wrapper (no English part).
        const content = typeof translationData === 'string'
            ? translationData
            : localized;

        const inner = content
            ? `<span lang="${lang}">${content}</span>`
            : '';
        console.log('formatBilingualHTML skipEnglish result:', inner);
        return wrapper(inner);
    }

    if (shouldShowLocalized(english, localized, userLang)) {
        const inner =
            enPrefix +
            english +
            enSuffix +
            ' <span lang="' + lang + '">' +
            spanPrefix +
            localized +
            '</span>';
        console.log('formatBilingualHTML bilingual result:', inner);
        return wrapper(inner);
    }

    // Single-language fallback
    const inner = enPrefix + english + enSuffix;
    console.log('formatBilingualHTML fallback result:', inner);
    return wrapper(inner);
}
