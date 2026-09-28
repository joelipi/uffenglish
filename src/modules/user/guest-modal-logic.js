// modules/user/guest-modal-logic.js
// Pure decision logic for the guest login/language modal. Keeps the modal
// behaviour deterministic and testable without React, the store, or the DOM.

export const ENGLISH_LANG = 'EN';

// - friend lesson + non-English browser -> adopt the browser language silently
//   (no modal at all)
// - friend lesson + English browser     -> language step only
// - non-friend lesson                   -> the existing two-step flow
export function resolveGuestModalPlan({ isFriendLesson, detectedLang } = {}) {
    const lang = (typeof detectedLang === 'string' && detectedLang) ? detectedLang : ENGLISH_LANG;
    const friendMode = !!isFriendLesson;
    if (friendMode && lang !== ENGLISH_LANG) {
        return { action: 'adopt-silently', language: lang, friendMode: true };
    }
    return { action: 'open-language', friendMode };
}

// What the guard's silent-adoption re-apply effect should do after a later
// `userData` write. A logged-in user always wins: their profile must never be
// overwritten by a language a friend lesson adopted earlier.
// Returns { action: 'forget' | 'noop' | 'apply', language? }.
export function resolveSilentLanguageReapply({ isLoggedIn, silentLang, currentUserLang } = {}) {
    if (isLoggedIn) return { action: 'forget' };
    if (!silentLang) return { action: 'noop' };
    if (currentUserLang === silentLang) return { action: 'noop' };
    return { action: 'apply', language: silentLang };
}

/**
 * Applies the guest's chosen language over a profile object. A guest's
 * `guestNativeLanguage` is authoritative: the async bootstrap writes the
 * fetched guest profile (`native_language: 'EN'`) and must not revert a
 * language the guest already confirmed. Logged-in users are untouched (their
 * profile language wins). Returns the SAME reference when nothing changes, so
 * callers/React do not re-render for no reason.
 */
export function applyGuestLanguagePreference({ userData, guestLang, isLoggedIn } = {}) {
    if (isLoggedIn) return userData;
    if (!guestLang) return userData;
    if (!userData || typeof userData !== 'object') return userData;
    if (userData.native_language === guestLang) return userData;
    return { ...userData, native_language: guestLang };
}
