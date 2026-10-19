// data/language-order.js
//
// The ordering convention for every language dropdown in the app.
//
// Language menus are not sorted by English name and not by raw code point: they
// are sorted by the language's **endonym** (its own name — `Español`, `हिन्दी`)
// using the **Unicode default collation** (DUCET / CLDR root). That is the
// convention Wikipedia's own language lists document ("by script, then
// alphabetically by displayed native name, using the default DUCET order") and
// what OS, browser and checkout language pickers do.
//
// The practical consequence, which is why a plain `localeCompare` is not enough:
// collation orders scripts, and orders Latin first. Every Latin-script name is
// alphabetized among itself — and diacritics sort where a reader expects, so
// `Čeština` sits with the C-names instead of being exiled after the accented
// Latin names by code point — then the remaining scripts follow in Unicode's
// fixed order (Greek, Cyrillic, Arabic, Devanagari, Bengali, Thai, Hangul, Han,
// Kana). A learner looking for `हिन्दी` therefore finds it grouped with the other
// Indic entries rather than stranded at the end or wherever it happened to be
// typed, and one rule explains the whole list.
//
// Collation is pinned to 'en' rather than left to the runtime default: the
// visitor's own locale would tailor the order per user (Swedish puts `å` after
// `z`), so the list would stop being a single predictable order. 'en' is an
// English-tailored locale, not the CLDR root table — 'und' is the root tag, but
// V8 silently resolves it to the default locale instead of switching tables —
// and English tailoring only affects punctuation and spacing, not script order
// or letter order, so the result is the order documented above.

/**
 * Every language code the app can offer, mapped to its endonym. This is the
 * sort key for the dropdowns — the displayed label may be an English name (the
 * profile editor) or a "native (English)" pair (the guest modal), and neither
 * would give a script-aware order on its own.
 *
 * Kept as explicit data rather than derived from `Intl.DisplayNames` at runtime
 * so the order is identical in every environment; `language-order.test.js`
 * asserts each value against `Intl.DisplayNames`, which catches a misspelled or
 * wrong-language endonym.
 */
export const LANGUAGE_ENDONYMS = Object.freeze({
    EN: 'English',
    ES: 'Español',
    PT: 'Português',
    FR: 'Français',
    DE: 'Deutsch',
    IT: 'Italiano',
    NL: 'Nederlands',
    SV: 'Svenska',
    DA: 'Dansk',
    NB: 'Norsk bokmål',
    FI: 'Suomi',
    PL: 'Polski',
    CS: 'Čeština',
    HU: 'Magyar',
    RO: 'Română',
    VI: 'Tiếng Việt',
    TR: 'Türkçe',
    EL: 'Ελληνικά',
    RU: 'Русский',
    UK: 'Українська',
    AR: 'العربية',
    HI: 'हिन्दी',
    BN: 'বাংলা',
    TH: 'ไทย',
    KO: '한국어',
    ZH: '中文',
    JA: '日本語',
});

/** The endonym for a language code, or '' when the code is unknown. */
export function endonymFor(code) {
    if (typeof code !== 'string') return '';
    return LANGUAGE_ENDONYMS[code.toUpperCase()] || '';
}

// Collation is pinned to 'en' rather than left to the runtime default: the
// visitor's own locale would tailor the order per user (Swedish puts `å` after
// `z`), so the menu would stop being a single predictable order. English
// tailoring only affects punctuation and spacing, not script order or letter
// order, so this yields the documented order; 'und' would *sound* more exact but
// V8 silently resolves it to the default locale instead of the root table.
const collator = new Intl.Collator('en');

/** Warn once per unknown code: a missing endonym sorts by the English label,
 *  which silently puts a non-Latin language in the Latin block. The guard in
 *  language-order.test.js is the real contract; this is the runtime tell. */
const warnedUnknownCodes = new Set();

/**
 * The sort key for a `{ value, label }` entry: its endonym when we know the
 * language, otherwise the label. The fallback keeps a language that has not been
 * added to LANGUAGE_ENDONYMS yet in a sensible alphabetical position instead of
 * dropping it to the bottom; `language-order.test.js` guards that every exported
 * list has a real endonym for every code, so the fallback is never load-bearing.
 */
function sortKeyFor(entry) {
    if (!entry || typeof entry !== 'object') return '';
    const endonym = endonymFor(entry.value);
    if (endonym) return endonym;
    const code = typeof entry.value === 'string' ? entry.value.toUpperCase() : String(entry.value);
    if (!warnedUnknownCodes.has(code)) {
        warnedUnknownCodes.add(code);
        console.warn('[language-order] no endonym for', code, '- sorting it by its label instead');
    }
    return typeof entry.label === 'string' ? entry.label : '';
}

/**
 * Sort language options into the conventional order. Returns a new array; the
 * input is never mutated, and the sort is stable, so two entries whose keys
 * compare equal keep their relative order (e.g. the guest modal still finds the
 * browser language in its natural slot when it prepends it as a suggestion).
 */
export function sortLanguagesByEndonym(list) {
    if (!Array.isArray(list)) return [];
    return [...list].sort((a, b) => collator.compare(sortKeyFor(a), sortKeyFor(b)));
}
