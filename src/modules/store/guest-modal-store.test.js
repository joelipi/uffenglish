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
