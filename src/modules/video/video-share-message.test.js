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
        expect(buildShareMessage()).toBe('Practica inglés conmigo gratis en este enlace. Es una tecnología nueva genial. Cualquier nivel de inglés sirve (de principiante a avanzado, te enseña qué decir). No necesitamos estar en línea al mismo tiempo. ¡Hazlo ahora, los videos de la lección caducan en 48 horas! https://ultrafastfluency.com/abc123');
    });

    it('prefers the guest language over the profile language', () => {
        appStore.setState({ userData: { native_language: 'EN', shareCode: 'abc123' }, guestNativeLanguage: 'PT' });
        expect(buildShareMessage()).toBe('Pratique inglês comigo de graça neste link. É uma tecnologia nova muito legal. Qualquer nível de inglês serve (de iniciante a avançado, ele ensina o que dizer). Não precisamos estar online ao mesmo tempo. Faça agora, os vídeos da lição expiram em 48 horas! https://ultrafastfluency.com/abc123');
    });

    it('falls back to the bare host when there is no share code', () => {
        appStore.setState({ userData: { native_language: 'EN' } });
        expect(buildShareMessage()).toBe("Practice English with me free at this link. It's a really cool new technology. Any English level is OK (beginner to advanced, it teaches you what to say). We don't need to be online at the same time. Please do it now, the lesson videos expire in 48 hours! https://ultrafastfluency.com");
    });

    it('defaults to English when no language is set', () => {
        appStore.setState({ userData: { shareCode: 'xyz789' } });
        expect(buildShareMessage()).toBe("Practice English with me free at this link. It's a really cool new technology. Any English level is OK (beginner to advanced, it teaches you what to say). We don't need to be online at the same time. Please do it now, the lesson videos expire in 48 hours! https://ultrafastfluency.com/xyz789");
    });

    it('produces a clickable https URL', () => {
        appStore.setState({ userData: { native_language: 'EN', shareCode: 'abc123' } });
        expect(buildShareMessage()).toMatch(/https:\/\/ultrafastfluency\.com\/abc123/);
    });
});
