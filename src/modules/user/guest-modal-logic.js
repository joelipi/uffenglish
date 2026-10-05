// modules/user/guest-modal-logic.js
// Pure decision logic for the guest login/language modal. Keeps the modal
// behaviour deterministic and testable without React, the store, or the DOM.

export const ENGLISH_LANG = 'EN';

// Routes that are public to everyone and must never open the guest modal: the
// public homepage's only job is the friend-challenge entry, and the legal pages
// must stay readable for anonymous visitors arriving from the footer.
export const PUBLIC_ROUTES = ['/', '/privacy', '/terms'];

export function isPublicHomeRoute(pathname) {
    if (typeof pathname !== 'string' || pathname === '') return false;
    // React Router matches paths case-insensitively and tolerates trailing
    // slashes, so normalize to the canonical form before the exact-match lookup.
    const normalized = (pathname.replace(/\/+$/, '') || '/').toLowerCase();
    return PUBLIC_ROUTES.includes(normalized);
}

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

// Build the guest dropdown options. The detected browser language is surfaced
// first when it is a real option; otherwise it is prepended as a synthetic
// entry. English is deliberately never added: an English browser starts with
// nothing selected so the learner must actively choose a translation language.
export function buildGuestLanguageOptions({ detectedLang, languages } = {}) {
    const list = languages || [];
    if (!detectedLang || detectedLang === ENGLISH_LANG) return list;

    const match = list.find((l) => l.value === detectedLang);
    if (match) return [match, ...list.filter((l) => l.value !== detectedLang)];

    let label = detectedLang;
    try {
        if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
            label = new Intl.DisplayNames([detectedLang], { type: 'language' }).of(detectedLang) || detectedLang;
        }
    } catch { /* ignore */ }
    return [{ value: detectedLang, label }, ...list];
}

// Initial dropdown selection: an English browser (or no detected language)
// starts unselected; every other detected language is pre-selected.
export function resolveInitialGuestSelection({ detectedLang } = {}) {
    if (!detectedLang || detectedLang === ENGLISH_LANG) return '';
    return detectedLang;
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
