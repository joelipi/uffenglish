// languages.js - Curated native-language lists for the UFF app.
//
// Single source of truth for the language dropdowns. Kept free of React /
// Supabase imports so the lists are unit-testable in isolation and stay in
// sync across the guest modal, signup form, and profile editor.
//
// Every list is exported in the conventional menu order — by endonym, Unicode
// default collation, so Latin names come first in alphabetical order and the
// other scripts follow in Unicode's fixed order (see language-order.js). The
// entries below are written in that order so the file reads the way the menus
// do, but the exported order is produced by the sort rather than relied on by
// hand: a language added anywhere in a list lands in its conventional slot, and
// the four dropdowns agree even though three of them show English labels.

import { sortLanguagesByEndonym } from './language-order.js';

// Curated list for the guest login modal (native-name labels).
export const GUEST_LANGUAGES = sortLanguagesByEndonym([
    { value: 'DE', label: 'Deutsch (German)' },
    { value: 'ES', label: 'Español (Spanish)' },
    { value: 'FR', label: 'Français (French)' },
    { value: 'IT', label: 'Italiano (Italian)' },
    { value: 'NL', label: 'Nederlands (Dutch)' },
    { value: 'PL', label: 'Polski (Polish)' },
    { value: 'PT', label: 'Português (Portuguese)' },
    { value: 'SV', label: 'Svenska (Swedish)' },
    { value: 'VI', label: 'Tiếng Việt (Vietnamese)' },
    { value: 'TR', label: 'Türkçe (Turkish)' },
    { value: 'RU', label: 'Русский (Russian)' },
    { value: 'AR', label: 'العربية (Arabic)' },
    { value: 'HI', label: 'हिन्दी (Hindi)' },
    { value: 'BN', label: 'বাংলা (Bengali)' },
    { value: 'TH', label: 'ไทย (Thai)' },
    { value: 'KO', label: '한국어 (Korean)' },
    { value: 'ZH', label: '中文 (Chinese)' },
    { value: 'JA', label: '日本語 (Japanese)' },
]);

// Languages the public homepage is translated into. English plus the five UI
// translations. Used by the homepage language selector and by the homepage
// silent browser-language adoption.
export const HOME_LANGUAGES = sortLanguagesByEndonym([
    { value: 'EN', label: 'English' },
    { value: 'ES', label: 'Español' },
    { value: 'FR', label: 'Français' },
    { value: 'PT', label: 'Português' },
    { value: 'HI', label: 'हिन्दी' },
    { value: 'BN', label: 'বাংলা' },
]);

// Full list for the profile editor (English labels). Ordered by endonym, not by
// these English labels, so it matches the other three dropdowns.
export const PROFILE_LANGUAGES = sortLanguagesByEndonym([
    { value: 'CS', label: 'Czech' },
    { value: 'DA', label: 'Danish' },
    { value: 'DE', label: 'German' },
    { value: 'EN', label: 'English' },
    { value: 'ES', label: 'Spanish' },
    { value: 'FR', label: 'French' },
    { value: 'IT', label: 'Italian' },
    { value: 'HU', label: 'Hungarian' },
    { value: 'NL', label: 'Dutch' },
    { value: 'NB', label: 'Norwegian' },
    { value: 'PL', label: 'Polish' },
    { value: 'PT', label: 'Portuguese' },
    { value: 'RO', label: 'Romanian' },
    { value: 'FI', label: 'Finnish' },
    { value: 'SV', label: 'Swedish' },
    { value: 'VI', label: 'Vietnamese' },
    { value: 'TR', label: 'Turkish' },
    { value: 'EL', label: 'Greek' },
    { value: 'RU', label: 'Russian' },
    { value: 'UK', label: 'Ukrainian' },
    { value: 'AR', label: 'Arabic' },
    { value: 'HI', label: 'Hindi' },
    { value: 'BN', label: 'Bengali' },
    { value: 'TH', label: 'Thai' },
    { value: 'KO', label: 'Korean' },
    { value: 'ZH', label: 'Chinese' },
    { value: 'JA', label: 'Japanese' },
]);

// Compact list for the signup form (native-name labels).
// The disabled "Select..." placeholder is prepended at the call site
// (SignupForm.web.jsx) so this list stays pure data.
export const SIGNUP_LANGUAGES = sortLanguagesByEndonym([
    { value: 'DE', label: 'Deutsch (German)' },
    { value: 'EN', label: 'English' },
    { value: 'ES', label: 'Español (Spanish)' },
    { value: 'FR', label: 'Français (French)' },
    { value: 'PT', label: 'Português (Portuguese)' },
    { value: 'HI', label: 'हिन्दी (Hindi)' },
    { value: 'BN', label: 'বাংলা (Bengali)' },
    { value: 'KO', label: '한국어 (Korean)' },
]);

// Maps the uppercase language codes above to BCP-47 locale tags for Intl
// date formatting (toLocaleDateString). Derived from PROFILE_LANGUAGES so
// the two can never drift apart.
export const LOCALE_MAP = Object.fromEntries(
    PROFILE_LANGUAGES.map(({ value }) => [value, value.toLowerCase()])
);
