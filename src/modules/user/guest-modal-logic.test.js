import { describe, it, expect } from 'vitest';
import { ENGLISH_LANG, resolveGuestModalPlan, resolveSilentLanguageReapply } from './guest-modal-logic.js';

describe('resolveGuestModalPlan', () => {
    it('adopts a non-English browser language silently for a friend lesson', () => {
        expect(resolveGuestModalPlan({ isFriendLesson: true, detectedLang: 'ES' }))
            .toEqual({ action: 'adopt-silently', language: 'ES' });
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
