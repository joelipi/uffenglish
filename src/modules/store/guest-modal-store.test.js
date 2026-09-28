import { describe, it, expect, beforeEach } from 'vitest';
import { appStore } from './store.js';

// Session flags + guest language actions introduced by the friend-lesson modal
// story. These are not persisted, so setState is enough to arrange state.
function state() {
    return appStore.getState();
}

describe('guest-modal store actions', () => {
    beforeEach(() => {
        appStore.setState({
            isGuestModalOpen: false,
            guestModalStep: 'select-language',
            guestModalFriendMode: false,
            guestNativeLanguage: null,
            userData: null,
        });
    });

    it('setGuestLanguageSilent adopts the language without opening the modal or advancing', () => {
        state().setGuestLanguageSilent('ES');

        expect(state().guestNativeLanguage).toBe('ES');
        expect(state().userData.native_language).toBe('ES');
        expect(state().isGuestModalOpen).toBe(false);
        expect(state().guestModalStep).toBe('select-language');
    });

    it('setGuestLanguageSilent preserves the rest of an existing userData object', () => {
        appStore.setState({ userData: { $id: 'guest', native_language: 'EN' } });

        state().setGuestLanguageSilent('ES');

        expect(state().userData.native_language).toBe('ES');
        expect(state().userData.$id).toBe('guest');
    });

    it('setGuestModalFriendMode toggles the session flag', () => {
        state().setGuestModalFriendMode(true);
        expect(state().guestModalFriendMode).toBe(true);
    });

    it('confirmGuestLanguage advances to login-choice outside friend mode', () => {
        appStore.setState({ isGuestModalOpen: true, guestModalFriendMode: false });

        state().confirmGuestLanguage('ES');

        expect(state().guestModalStep).toBe('login-choice');
        expect(state().isGuestModalOpen).toBe(true);
        expect(state().userData.native_language).toBe('ES');
        expect(state().guestNativeLanguage).toBe('ES');
    });

    it('confirmGuestLanguage closes the modal in friend mode and never reaches login-choice', () => {
        appStore.setState({ isGuestModalOpen: true, guestModalFriendMode: true });

        state().confirmGuestLanguage('ES');

        expect(state().isGuestModalOpen).toBe(false);
        expect(state().guestModalStep).toBe('select-language');
        expect(state().userData.native_language).toBe('ES');
    });

    it('confirmGuestLanguage in friend mode accepts unsupported languages', () => {
        appStore.setState({ isGuestModalOpen: true, guestModalFriendMode: true });

        state().confirmGuestLanguage('OTHER');

        expect(state().isGuestModalOpen).toBe(false);
        expect(state().guestNativeLanguage).toBe('OTHER');
        expect(state().userData.native_language).toBe('OTHER');
    });
});

describe('setCourseData preserves a chosen guest language', () => {
    beforeEach(() => {
        appStore.setState({
            isLoggedIn: false,
            guestNativeLanguage: null,
            userData: null,
            configData: null,
            courseId: null,
            userLevel: 'A0',
        });
    });

    it('keeps the chosen guest language when the async bootstrap writes the fetched profile', () => {
        appStore.setState({ guestNativeLanguage: 'ES', userData: { $id: 'guest', native_language: 'ES' } });

        state().setCourseData({ userData: { $id: 'guest', native_language: 'EN' } });

        expect(state().userData.native_language).toBe('ES');
        expect(state().userData.$id).toBe('guest');
    });

    it('lets a logged-in profile language win', () => {
        appStore.setState({
            isLoggedIn: true,
            guestNativeLanguage: 'ES',
            userData: { $id: 'u1', native_language: 'ES' },
        });

        state().setCourseData({ userData: { $id: 'u1', native_language: 'EN' } });

        expect(state().userData.native_language).toBe('EN');
    });

    it('keeps the profile language when no guest language was chosen', () => {
        state().setCourseData({ userData: { $id: 'guest', native_language: 'EN' } });

        expect(state().userData.native_language).toBe('EN');
    });

    it('re-applies the guest language for a config-only update and writes those fields', () => {
        appStore.setState({
            guestNativeLanguage: 'ES',
            userData: { $id: 'guest', native_language: 'EN' },
        });

        state().setCourseData({ configData: { lessons: [] }, courseId: 'friend' });

        expect(state().userData.native_language).toBe('ES');
        expect(state().configData).toEqual({ lessons: [] });
        expect(state().courseId).toBe('friend');
        expect(state().userLevel).toBe('A0');
    });

    it('preserves unspecified fields and returns a new userData object with $id intact', () => {
        appStore.setState({
            guestNativeLanguage: 'ES',
            userData: { $id: 'guest', native_language: 'EN' },
            configData: { old: true },
            courseId: 'old',
            userLevel: 'B1',
        });
        const before = state().userData;

        state().setCourseData({ userData: { $id: 'guest', native_language: 'EN' } });

        expect(state().userData).not.toBe(before);
        expect(state().userData.$id).toBe('guest');
        expect(state().configData).toEqual({ old: true });
        expect(state().courseId).toBe('old');
        expect(state().userLevel).toBe('B1');
    });
});
