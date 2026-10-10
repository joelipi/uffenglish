import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    ENGLISH_LANG,
    PUBLIC_ROUTES,
    STATIC_SINGLE_SEGMENT_ROUTES,
    isPublicHomeRoute,
    isHomepageRoute,
    resolveHomepageLanguageAdoption,
    isProfileRoute,
    resolveGuestModalPlan,
    resolveSilentLanguageReapply,
    applyGuestLanguagePreference,
    buildGuestLanguageOptions,
    resolveInitialGuestSelection,
} from './guest-modal-logic.js';
import { GUEST_LANGUAGES } from '../../data/languages.js';

describe('resolveGuestModalPlan', () => {
    it('adopts a non-English browser language silently for a friend lesson', () => {
        expect(resolveGuestModalPlan({ isFriendLesson: true, detectedLang: 'ES' }))
            .toEqual({ action: 'adopt-silently', language: 'ES', friendMode: true });
    });

    it('opens only the language step for a friend lesson in English', () => {
        expect(resolveGuestModalPlan({ isFriendLesson: true, detectedLang: 'EN' }))
            .toEqual({ action: 'open-language', friendMode: true });
    });

    it('keeps the two-step flow for non-friend lessons in any language', () => {
        expect(resolveGuestModalPlan({ isFriendLesson: false, detectedLang: 'ES' }))
            .toEqual({ action: 'open-language', friendMode: false });
        expect(resolveGuestModalPlan({ isFriendLesson: false, detectedLang: 'EN' }))
            .toEqual({ action: 'open-language', friendMode: false });
    });

    it('falls back to EN when the detected language is missing', () => {
        expect(resolveGuestModalPlan({ isFriendLesson: true, detectedLang: undefined }))
            .toEqual({ action: 'open-language', friendMode: true });
        expect(resolveGuestModalPlan({ isFriendLesson: true, detectedLang: '' }))
            .toEqual({ action: 'open-language', friendMode: true });
        expect(resolveGuestModalPlan({ isFriendLesson: true, detectedLang: null }))
            .toEqual({ action: 'open-language', friendMode: true });
    });

    it('defaults to a non-friend two-step flow with no arguments', () => {
        expect(resolveGuestModalPlan()).toEqual({ action: 'open-language', friendMode: false });
    });

    it('pins the English language constant', () => {
        expect(ENGLISH_LANG).toBe('EN');
    });
});

describe('isPublicHomeRoute', () => {
    it('is true for the public homepage, the legal pages, confirm-email and the course listings', () => {
        expect(isPublicHomeRoute('/')).toBe(true);
        expect(isPublicHomeRoute('/privacy')).toBe(true);
        expect(isPublicHomeRoute('/terms')).toBe(true);
        expect(isPublicHomeRoute('/confirm-email')).toBe(true);
        expect(isPublicHomeRoute('/courses')).toBe(true);
    });

    it('matches the same non-canonical URLs the router resolves (case + trailing slash)', () => {
        expect(isPublicHomeRoute('/privacy/')).toBe(true);
        expect(isPublicHomeRoute('/Privacy')).toBe(true);
        expect(isPublicHomeRoute('/Privacy/')).toBe(true);
        expect(isPublicHomeRoute('/terms/')).toBe(true);
        expect(isPublicHomeRoute('/Terms')).toBe(true);
        expect(isPublicHomeRoute('/confirm-email/')).toBe(true);
        expect(isPublicHomeRoute('/Confirm-Email')).toBe(true);
        expect(isPublicHomeRoute('/courses/')).toBe(true);
        expect(isPublicHomeRoute('/Courses')).toBe(true);
    });

    it('is false for the dashboard, auth, lesson, profile and share-code routes', () => {
        expect(isPublicHomeRoute('/home')).toBe(false);
        expect(isPublicHomeRoute('/login')).toBe(false);
        expect(isPublicHomeRoute('/course/model/lesson/g')).toBe(false);
        expect(isPublicHomeRoute('/abc123')).toBe(false);
    });

    it('is false for empty and non-string input', () => {
        expect(isPublicHomeRoute('')).toBe(false);
        expect(isPublicHomeRoute(undefined)).toBe(false);
    });

    it('pins the public route list', () => {
        expect(PUBLIC_ROUTES).toEqual(['/', '/privacy', '/terms', '/confirm-email', '/courses']);
    });
});

describe('isHomepageRoute', () => {
    it('is true only for the homepage itself', () => {
        expect(isHomepageRoute('/')).toBe(true);
        expect(isHomepageRoute('//')).toBe(true);
    });

    it('is false for the other public routes and app routes', () => {
        expect(isHomepageRoute('/privacy')).toBe(false);
        expect(isHomepageRoute('/terms')).toBe(false);
        expect(isHomepageRoute('/confirm-email')).toBe(false);
        expect(isHomepageRoute('/courses')).toBe(false);
        expect(isHomepageRoute('/home')).toBe(false);
        expect(isHomepageRoute('/course/model/lesson/g')).toBe(false);
        expect(isHomepageRoute('/abc123')).toBe(false);
    });

    it('is false for empty and non-string input', () => {
        expect(isHomepageRoute('')).toBe(false);
        expect(isHomepageRoute(undefined)).toBe(false);
        expect(isHomepageRoute(null)).toBe(false);
    });
});

describe('resolveHomepageLanguageAdoption', () => {
    it('adopts a supported non-English browser language for an anonymous visitor', () => {
        expect(resolveHomepageLanguageAdoption({ isLoggedIn: false, guestLang: null, detectedLang: 'ES' }))
            .toEqual({ action: 'adopt', language: 'ES' });
    });

    it('no-ops for English (English already renders)', () => {
        expect(resolveHomepageLanguageAdoption({ isLoggedIn: false, guestLang: null, detectedLang: 'EN' }))
            .toEqual({ action: 'noop' });
    });

    it('no-ops for an unsupported browser language', () => {
        expect(resolveHomepageLanguageAdoption({ isLoggedIn: false, guestLang: null, detectedLang: 'DE' }))
            .toEqual({ action: 'noop' });
        expect(resolveHomepageLanguageAdoption({ isLoggedIn: false, guestLang: null, detectedLang: 'JA' }))
            .toEqual({ action: 'noop' });
    });

    it('honors an explicit supportedLangs list', () => {
        expect(resolveHomepageLanguageAdoption({ isLoggedIn: false, guestLang: null, detectedLang: 'DE', supportedLangs: ['DE'] }))
            .toEqual({ action: 'adopt', language: 'DE' });
    });

    it('no-ops when no language was detected', () => {
        expect(resolveHomepageLanguageAdoption({ isLoggedIn: false, guestLang: null, detectedLang: undefined }))
            .toEqual({ action: 'noop' });
        expect(resolveHomepageLanguageAdoption({ isLoggedIn: false, guestLang: null, detectedLang: '' }))
            .toEqual({ action: 'noop' });
        expect(resolveHomepageLanguageAdoption({ isLoggedIn: false, guestLang: null, detectedLang: null }))
            .toEqual({ action: 'noop' });
    });

    it('never adopts for a logged-in user', () => {
        expect(resolveHomepageLanguageAdoption({ isLoggedIn: true, guestLang: null, detectedLang: 'ES' }))
            .toEqual({ action: 'noop' });
    });

    it('never overrides an already-chosen guest language', () => {
        expect(resolveHomepageLanguageAdoption({ isLoggedIn: false, guestLang: 'BN', detectedLang: 'ES' }))
            .toEqual({ action: 'noop' });
    });
});

describe('isProfileRoute', () => {
    it('is true for the private profile route', () => {
        expect(isProfileRoute('/profile')).toBe(true);
        expect(isProfileRoute('/profile/')).toBe(true);
        expect(isProfileRoute('/Profile')).toBe(true);
    });

    it('is true for a public share-code profile (the single-segment catch-all)', () => {
        expect(isProfileRoute('/abc123')).toBe(true);
        expect(isProfileRoute('/FriendTest1/')).toBe(true);
    });

    it('is false for every static single-segment route declared before the catch-all', () => {
        // '/profile' is itself a profile route; the rest are not.
        for (const route of STATIC_SINGLE_SEGMENT_ROUTES.filter((r) => r !== '/profile')) {
            expect(isProfileRoute(route), route).toBe(false);
        }
        expect(isProfileRoute('/home')).toBe(false);
        expect(isProfileRoute('/courses')).toBe(false);
    });

    it('is false for multi-segment lesson routes', () => {
        expect(isProfileRoute('/course/model/lesson/g')).toBe(false);
        expect(isProfileRoute('/course/friend/lesson/b')).toBe(false);
    });

    it('is false for empty and non-string input', () => {
        expect(isProfileRoute('')).toBe(false);
        expect(isProfileRoute(undefined)).toBe(false);
        expect(isProfileRoute(null)).toBe(false);
    });

    // Keep the static list in lockstep with routes.jsx: a new static
    // single-segment route added there but not here would be silently read as a
    // share code and lose its guest modal.
    it('covers every static single-segment route declared in routes.jsx', () => {
        const routesSrc = readFileSync(
            path.join(path.dirname(fileURLToPath(import.meta.url)), '../../routes/routes.jsx'),
            'utf8',
        );
        const declared = [...routesSrc.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
        const singleSegmentStatic = declared.filter(
            (p) => p.startsWith('/') && !p.slice(1).includes('/') && !p.includes(':'),
        );
        expect(singleSegmentStatic.length).toBeGreaterThan(0);
        for (const route of singleSegmentStatic) {
            expect(STATIC_SINGLE_SEGMENT_ROUTES, route).toContain(route);
        }
    });
});

describe('resolveSilentLanguageReapply', () => {
    it('forgets the adopted language once the user is logged in', () => {
        // Even though the current profile language (EN) differs from the
        // adopted one (ES), a logged-in user must never be overwritten.
        expect(resolveSilentLanguageReapply({ isLoggedIn: true, silentLang: 'ES', currentUserLang: 'EN' }))
            .toEqual({ action: 'forget' });
        expect(resolveSilentLanguageReapply({ isLoggedIn: true, silentLang: 'ES', currentUserLang: null }))
            .toEqual({ action: 'forget' });
        expect(resolveSilentLanguageReapply({ isLoggedIn: true }))
            .toEqual({ action: 'forget' });
    });

    it('does nothing when no language was adopted', () => {
        expect(resolveSilentLanguageReapply({ silentLang: null, currentUserLang: 'EN' }))
            .toEqual({ action: 'noop' });
        expect(resolveSilentLanguageReapply({}))
            .toEqual({ action: 'noop' });
    });

    it('does nothing when the profile already has the adopted language', () => {
        expect(resolveSilentLanguageReapply({ silentLang: 'ES', currentUserLang: 'ES' }))
            .toEqual({ action: 'noop' });
    });

    it('re-applies the adopted language when a later write replaced it', () => {
        expect(resolveSilentLanguageReapply({ silentLang: 'ES', currentUserLang: 'EN' }))
            .toEqual({ action: 'apply', language: 'ES' });
        expect(resolveSilentLanguageReapply({ silentLang: 'ES' }))
            .toEqual({ action: 'apply', language: 'ES' });
    });
});

describe('applyGuestLanguagePreference', () => {
    it('applies the chosen guest language over the profile language', () => {
        const userData = { $id: 'guest', native_language: 'EN', shareCode: null };
        const out = applyGuestLanguagePreference({ userData, guestLang: 'ES', isLoggedIn: false });

        expect(out.native_language).toBe('ES');
        expect(out.$id).toBe('guest');
        expect(out.shareCode).toBeNull();
        expect(out).not.toBe(userData);
    });

    it('returns the same reference when the language already matches', () => {
        const userData = { native_language: 'ES' };
        expect(applyGuestLanguagePreference({ userData, guestLang: 'ES', isLoggedIn: false }))
            .toBe(userData);
    });

    it('leaves a guest with no chosen language untouched', () => {
        const userData = { native_language: 'EN' };
        expect(applyGuestLanguagePreference({ userData, guestLang: null, isLoggedIn: false }))
            .toBe(userData);
        expect(applyGuestLanguagePreference({ userData, guestLang: undefined, isLoggedIn: false }))
            .toBe(userData);
        expect(applyGuestLanguagePreference({ userData, guestLang: '', isLoggedIn: false }))
            .toBe(userData);
    });

    it('never overrides a logged-in profile language', () => {
        const userData = { native_language: 'EN' };
        expect(applyGuestLanguagePreference({ userData, guestLang: 'ES', isLoggedIn: true }))
            .toBe(userData);
    });

    it('passes through null / non-object userData unchanged', () => {
        expect(applyGuestLanguagePreference({ userData: null, guestLang: 'ES', isLoggedIn: false }))
            .toBeNull();
        expect(applyGuestLanguagePreference({ userData: undefined, guestLang: 'ES', isLoggedIn: false }))
            .toBeUndefined();
        expect(applyGuestLanguagePreference({ userData: 'x', guestLang: 'ES', isLoggedIn: false }))
            .toBe('x');
    });

    it('accepts an unsupported guest language (OTHER) as authoritative', () => {
        const out = applyGuestLanguagePreference({
            userData: { native_language: 'EN' },
            guestLang: 'OTHER',
            isLoggedIn: false,
        });
        expect(out.native_language).toBe('OTHER');
    });

    it('returns undefined with no arguments', () => {
        expect(applyGuestLanguagePreference()).toBeUndefined();
    });
});

describe('buildGuestLanguageOptions', () => {
    it('never surfaces English, even for an English browser', () => {
        const options = buildGuestLanguageOptions({ detectedLang: 'EN', languages: GUEST_LANGUAGES });
        expect(options.some((o) => o.value === 'EN')).toBe(false);
        expect(options).toHaveLength(GUEST_LANGUAGES.length);
    });

    it('moves an already-listed detected language to the front without duplicating it', () => {
        const options = buildGuestLanguageOptions({ detectedLang: 'ES', languages: GUEST_LANGUAGES });
        expect(options[0].value).toBe('ES');
        expect(options).toHaveLength(GUEST_LANGUAGES.length);
        const values = options.map((o) => o.value);
        expect(new Set(values).size).toBe(values.length);
    });

    it('prepends a synthetic entry for a detected language not in the list', () => {
        const options = buildGuestLanguageOptions({ detectedLang: 'DA', languages: GUEST_LANGUAGES });
        expect(options[0].value).toBe('DA');
        expect(options[0].label).toBeTruthy();
        expect(options.slice(1)).toEqual(GUEST_LANGUAGES);
    });

    it('returns the list unchanged when no language was detected', () => {
        expect(buildGuestLanguageOptions({ detectedLang: undefined, languages: GUEST_LANGUAGES }))
            .toBe(GUEST_LANGUAGES);
    });
});

describe('resolveInitialGuestSelection', () => {
    it('starts an English browser unselected', () => {
        expect(resolveInitialGuestSelection({ detectedLang: 'EN' })).toBe('');
    });

    it('pre-selects a non-English detected language', () => {
        expect(resolveInitialGuestSelection({ detectedLang: 'ES' })).toBe('ES');
    });

    it('starts unselected when no language was detected', () => {
        expect(resolveInitialGuestSelection({ detectedLang: undefined })).toBe('');
    });
});
