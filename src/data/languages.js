// languages.js - Curated native-language lists for the UFF app.
//
// Single source of truth for the language dropdowns. Kept free of React /
// Supabase imports so the lists are unit-testable in isolation and stay in
// sync across the guest modal, signup form, and profile editor.

// Curated list for the guest login modal (native-name labels).
export const GUEST_LANGUAGES = [
    { value: 'EN', label: 'English' },
    { value: 'ES', label: 'Español (Spanish)' },
    { value: 'PT', label: 'Português (Portuguese)' },
    { value: 'FR', label: 'Français (French)' },
    { value: 'DE', label: 'Deutsch (German)' },
    { value: 'IT', label: 'Italiano (Italian)' },
    { value: 'JA', label: '日本語 (Japanese)' },
    { value: 'KO', label: '한국어 (Korean)' },
    { value: 'ZH', label: '中文 (Chinese)' },
    { value: 'RU', label: 'Русский (Russian)' },
    { value: 'AR', label: 'العربية (Arabic)' },
    { value: 'HI', label: 'हिन्दी (Hindi)' },
    { value: 'BN', label: 'বাংলা (Bengali)' },
    { value: 'VI', label: 'Tiếng Việt (Vietnamese)' },
    { value: 'TR', label: 'Türkçe (Turkish)' },
    { value: 'NL', label: 'Nederlands (Dutch)' },
    { value: 'PL', label: 'Polski (Polish)' },
    { value: 'SV', label: 'Svenska (Swedish)' },
    { value: 'TH', label: 'ไทย (Thai)' },
];

// Full list for the profile editor (English labels).
export const PROFILE_LANGUAGES = [
    { value: 'EN', label: 'English' },
    { value: 'ES', label: 'Spanish' },
    { value: 'FR', label: 'French' },
    { value: 'DE', label: 'German' },
    { value: 'IT', label: 'Italian' },
    { value: 'PT', label: 'Portuguese' },
    { value: 'ZH', label: 'Chinese' },
    { value: 'JA', label: 'Japanese' },
    { value: 'KO', label: 'Korean' },
    { value: 'RU', label: 'Russian' },
    { value: 'AR', label: 'Arabic' },
    { value: 'HI', label: 'Hindi' },
    { value: 'BN', label: 'Bengali' },
    { value: 'NL', label: 'Dutch' },
    { value: 'PL', label: 'Polish' },
    { value: 'TR', label: 'Turkish' },
    { value: 'VI', label: 'Vietnamese' },
    { value: 'TH', label: 'Thai' },
    { value: 'SV', label: 'Swedish' },
    { value: 'DA', label: 'Danish' },
    { value: 'NB', label: 'Norwegian' },
    { value: 'FI', label: 'Finnish' },
    { value: 'EL', label: 'Greek' },
    { value: 'CS', label: 'Czech' },
    { value: 'HU', label: 'Hungarian' },
    { value: 'RO', label: 'Romanian' },
    { value: 'UK', label: 'Ukrainian' },
];

// Compact list for the signup form (native-name labels).
// The disabled "Select..." placeholder is prepended at the call site
// (SignupForm.web.jsx) so this list stays pure data.
export const SIGNUP_LANGUAGES = [
    { value: 'EN', label: 'English' },
    { value: 'ES', label: 'Español (Spanish)' },
    { value: 'PT', label: 'Português (Portuguese)' },
    { value: 'FR', label: 'Français (French)' },
    { value: 'DE', label: 'Deutsch (German)' },
    { value: 'KO', label: '한국어 (Korean)' },
    { value: 'HI', label: 'हिन्दी (Hindi)' },
    { value: 'BN', label: 'বাংলা (Bengali)' },
];

// Maps the uppercase language codes above to BCP-47 locale tags for Intl
// date formatting (toLocaleDateString). Derived from PROFILE_LANGUAGES so
// the two can never drift apart.
export const LOCALE_MAP = Object.fromEntries(
    PROFILE_LANGUAGES.map(({ value }) => [value, value.toLowerCase()])
);
