import { describe, it, expect } from 'vitest';
import {
    ENGLISH_LANG,
    resolveGuestModalPlan,
    resolveSilentLanguageReapply,
    applyGuestLanguagePreference,
} from './guest-modal-logic.js';

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
