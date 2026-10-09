// modules/user/rtl-languages.js
// Right-to-left languages render the email body mirrored. Arabic is in the
// app's language set today; the others are listed so adding one needs no code
// change. Shared by the welcome + auth email builders.
export const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

export function isRtlLanguage(code) {
    return RTL_LANGUAGES.has(code);
}
