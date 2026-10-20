// modules/user/guest-modal-logic.js
// Pure decision logic for the guest login/language modal. Keeps the modal
// behaviour deterministic and testable without React, the store, or the DOM.

import { HOME_LANGUAGES } from '../../data/languages.js';

export const ENGLISH_LANG = 'EN';

// Routes that are public to everyone and must never open the guest modal: the
// public homepage's only job is the friend-challenge entry, the legal pages
// must stay readable for anonymous visitors arriving from the footer, the
// email-confirmation landing page is opened from an inbox with no session, and
// the course listings page is linked from the expired state of a public
// profile, so it must be readable without the modal.
//
// The topic chooser (/welcome) and the topic pages (/tags/<topic>) are public
// for the same reason: they are where a visitor WITHOUT a friend's code goes
// ("Start without friend's code"), and a language/login prompt in the middle of
// that path interrupts it — the modal would also cover the topic buttons, so
// the visitor could not even pick a topic until they dismissed it.
export const PUBLIC_ROUTES = ['/', '/privacy', '/terms', '/confirm-email', '/courses', '/welcome'];

// Route prefixes that are public to everyone: every path UNDER one of them is
// public too (the topic pages, `/tags/<topic>`). Kept apart from PUBLIC_ROUTES
// because those are exact paths.
export const PUBLIC_ROUTE_PREFIXES = ['/tags'];

export function isPublicHomeRoute(pathname) {
    if (typeof pathname !== 'string' || pathname === '') return false;
    // React Router matches paths case-insensitively and tolerates trailing
    // slashes, so normalize to the canonical form before the exact-match lookup.
    const normalized = (pathname.replace(/\/+$/, '') || '/').toLowerCase();
    if (PUBLIC_ROUTES.includes(normalized)) return true;
    return PUBLIC_ROUTE_PREFIXES.some(
        (prefix) => normalized === prefix || normalized.startsWith(prefix + '/'),
    );
}

export const HOMEPAGE_ROUTE = '/';

// True only for the homepage itself (case/trailing-slash normalized), not the
// other public routes (legal pages, confirm-email, courses).
export function isHomepageRoute(pathname) {
    if (typeof pathname !== 'string' || pathname === '') return false;
    return (pathname.replace(/\/+$/, '') || '/').toLowerCase() === HOMEPAGE_ROUTE;
}

// True for the routes that SILENTLY adopt the browser language for an
// anonymous visitor: the homepage, the course listings (/courses), the topic
// chooser (/welcome) and the topic pages (/tags/<topic>).
//
// On those pages the copy is the first thing a visitor reads and the guest
// modal is suppressed (they are public routes), so the page must speak the
// visitor's language without prompting for it. Without this, a visitor who
// opens a topic page directly — never through the homepage — would read
// English only, and the topic names (English word + the learner's word) would
// lose their translation.
export function isLanguageAdoptingRoute(pathname) {
    if (isHomepageRoute(pathname)) return true;
    if (typeof pathname !== 'string' || pathname === '') return false;
    const normalized = (pathname.replace(/\/+$/, '') || '/').toLowerCase();
    if (normalized === '/welcome' || normalized === '/courses') return true;
    return PUBLIC_ROUTE_PREFIXES.some(
        (prefix) => normalized === prefix || normalized.startsWith(prefix + '/'),
    );
}

// Whether a route should silently adopt the browser language. English is a
// no-op (English already renders); a logged-in user or an already chosen guest
// language wins; an unsupported code (e.g. DE/JA) is a no-op so
// guestNativeLanguage stays within the app's six languages.
// Returns { action: 'adopt', language } | { action: 'noop' }.
export function resolveSilentLanguageAdoption({ isLoggedIn, guestLang, detectedLang, supportedLangs } = {}) {
    if (isLoggedIn) return { action: 'noop' };
    if (guestLang) return { action: 'noop' };
    if (!detectedLang || detectedLang === ENGLISH_LANG) return { action: 'noop' };
    const supported = Array.isArray(supportedLangs) ? supportedLangs : HOME_LANGUAGES.map((l) => l.value);
    if (!supported.includes(detectedLang)) return { action: 'noop' };
    return { action: 'adopt', language: detectedLang };
}

// Static single-segment routes declared in routes.jsx before the /:shareCode
// catch-all. Any other single-segment path is a share code and resolves to the
// public profile route, so it must be excluded from the guest modal too.
// Derived from PUBLIC_ROUTES (single source) plus the non-public static
// single-segment routes; `guest-modal-logic.test.js` cross-checks this list
// against routes.jsx so a new static route cannot be silently misclassified.
export const STATIC_SINGLE_SEGMENT_ROUTES = [
    ...PUBLIC_ROUTES,
    '/home', '/profile', '/friends', '/login', '/signup', '/recover-password', '/reset-password',
];

// User profile pages: the logged-in profile (/profile) and the public
// share-code profile (/:shareCode). The guest login/language modal must not
// open on either, so an anonymous visitor is never gated by a language or
// login prompt while reading a profile.
export function isProfileRoute(pathname) {
    if (typeof pathname !== 'string' || pathname === '') return false;
    const normalized = (pathname.replace(/\/+$/, '') || '/').toLowerCase();
    if (normalized === '/profile') return true;
    const segments = normalized.split('/').filter(Boolean);
    if (segments.length !== 1) return false;
    return !STATIC_SINGLE_SEGMENT_ROUTES.includes('/' + segments[0]);
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
