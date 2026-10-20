// modules/user/public-profile-logic.js
// Pure helpers for the public share-code profile (/:shareCode). No React, no
// DOM, no data access — the component renders what these return.
//
// The public profile is localized to the VISITOR's language (the app's
// guest-first session language, resolved by useNativeLanguage()), never to the
// language of the profile being read: a Spanish learner opening a Hindi
// speaker's profile must see the page in Spanish.

import { LOCALE_MAP } from '../../data/languages.js';

/**
 * The BCP-47 locale tag used to format the profile's join date.
 *
 * `lang` is the visitor's language and may be any case/locale ('ES', 'es',
 * 'es-ES'). LOCALE_MAP is keyed by the uppercase base code, so normalize for
 * the lookup; a code with no locale entry falls back to English.
 *
 * @param {string|null|undefined} lang
 * @returns {string} a locale tag for Intl date formatting
 */
export function resolveProfileLocale(lang) {
    const base = String(lang || 'en').split('-')[0].toUpperCase();
    return LOCALE_MAP[base] || 'en';
}

/**
 * Localized "member since" date for the public profile, formatted in the
 * VISITOR's locale. Returns '' for a missing or unparseable date so the caller
 * can omit the line instead of rendering "Invalid Date".
 *
 * @param {string|number|Date|null|undefined} joinDate
 * @param {string|null|undefined} lang - the visitor's language
 * @returns {string} the formatted date, or '' when there is no usable date
 */
export function formatProfileJoinDate(joinDate, lang) {
    if (joinDate === null || joinDate === undefined || joinDate === '') return '';
    const time = new Date(joinDate).getTime();
    if (!Number.isFinite(time)) return '';
    return new Date(time).toLocaleDateString(resolveProfileLocale(lang));
}
