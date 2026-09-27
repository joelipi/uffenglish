import { describe, it, expect, beforeEach } from 'vitest';
import { buildShareMessage } from './video-share.web.js';
import { appStore } from '../store/store.js';

// buildShareMessage reads the learner's language + share code from the store and
// produces the localized share text with their personal link. The URL must be
// scheme-qualified so it is clickable in the shared message.
describe('buildShareMessage', () => {
    beforeEach(() => {
        appStore.setState({ userData: null, guestNativeLanguage: null });
    });

    it('uses the share code and the profile language', () => {
        appStore.setState({ userData: { native_language: 'ES', shareCode: 'abc123' } });
        expect(buildShareMessage()).toBe('Practica inglés conmigo gratis aquí: https://ultrafastfluency.com/abc123');
    });

    it('prefers the guest language over the profile language', () => {
        appStore.setState({ userData: { native_language: 'EN', shareCode: 'abc123' }, guestNativeLanguage: 'PT' });
        expect(buildShareMessage()).toBe('Pratique inglês comigo de graça aqui: https://ultrafastfluency.com/abc123');
    });

    it('falls back to the bare host when there is no share code', () => {
        appStore.setState({ userData: { native_language: 'EN' } });
        expect(buildShareMessage()).toBe('Practice English with me free here: https://ultrafastfluency.com');
    });

    it('defaults to English when no language is set', () => {
        appStore.setState({ userData: { shareCode: 'xyz789' } });
        expect(buildShareMessage()).toBe('Practice English with me free here: https://ultrafastfluency.com/xyz789');
    });

    it('produces a clickable https URL', () => {
        appStore.setState({ userData: { native_language: 'EN', shareCode: 'abc123' } });
        expect(buildShareMessage()).toMatch(/https:\/\/ultrafastfluency\.com\/abc123/);
    });
});
