// Story 037: the guest language-selection step must lead with the value of
// practicing English, drop English from the dropdown, start English browsers
// unselected, and relabel the two non-translation exits.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { appStore } from '../../modules/store/store.js';
import GuestLoginModal from './GuestLoginModal.web.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function renderModal(container, { detectedLang, step = 'select-language', nativeLanguage = null }) {
    appStore.setState({
        isGuestModalOpen: true,
        guestModalStep: step,
        guestModalFriendMode: false,
        guestNativeLanguage: nativeLanguage,
        guestDetectedLang: detectedLang,
        userData: null,
    });
    const root = createRoot(container);
    act(() => {
        root.render(
            React.createElement(
                MemoryRouter,
                null,
                React.createElement(GuestLoginModal),
            ),
        );
    });
    return root;
}

describe('GuestLoginModal language step', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        container = null;
    });

    it('starts an English browser unselected with no English option', () => {
        root = renderModal(container, { detectedLang: 'EN' });

        const select = container.querySelector('#guestLanguageSelect');
        expect(select).not.toBeNull();

        const options = Array.from(select.querySelectorAll('option'));
        expect(options.some((o) => o.value === 'EN')).toBe(false);
        expect(options.some((o) => o.textContent === 'English')).toBe(false);
        expect(select.value).toBe('');

        const continueBtn = container.querySelector('#guestLanguageContinueBtn');
        expect(continueBtn.disabled).toBe(true);
    });

    it('renders the two-line heading with a <br> between the lines', () => {
        root = renderModal(container, { detectedLang: 'EN' });

        const title = container.querySelector('#guestLoginModalTitleText');
        expect(title.textContent).toContain('Practice English with Us Free!');
        expect(title.textContent).toContain('Select your language for translations');
        expect(title.querySelector('br')).not.toBeNull();
    });

    it('keeps the heading fallback literal in sync with the English copy', () => {
        // The `||` fallback only fires when the strings key resolves falsy, so it
        // is not reachable through the render. Guard the source directly (the
        // repo's source-guard pattern) so the stale old title cannot return.
        const source = readFileSync(path.join(__dirname, 'GuestLoginModal.web.jsx'), 'utf8');
        expect(source).toContain('Practice English with Us Free!\\nSelect your language for translations');
        expect(source).not.toContain('Confirm Your Native Language');
    });

    it('renders the non-translation exit as a single text link', () => {
        root = renderModal(container, { detectedLang: 'EN' });

        const link = container.querySelector('#guestEnglishOnlyBtn');
        expect(link).not.toBeNull();
        expect(link.classList.contains('btn-link')).toBe(true);
        expect(container.querySelector('#guestEnglishOnlyBtnText').textContent)
            .toBe('My language is not listed. Continue without translations.');
        // The old duplicate "not on this list" button is gone.
        expect(container.querySelector('#guestNotListedBtn')).toBeNull();
    });

    it('continues without translations (OTHER) and advances to login-choice', () => {
        root = renderModal(container, { detectedLang: 'EN' });

        act(() => {
            container.querySelector('#guestEnglishOnlyBtn').click();
        });

        expect(appStore.getState().guestNativeLanguage).toBe('OTHER');
        expect(appStore.getState().guestModalStep).toBe('login-choice');
    });

    it('pre-selects a non-English browser language and enables Continue', () => {
        root = renderModal(container, { detectedLang: 'ES' });

        const select = container.querySelector('#guestLanguageSelect');
        const options = Array.from(select.querySelectorAll('option'));
        expect(options[1].value).toBe('ES');
        expect(select.value).toBe('ES');

        const continueBtn = container.querySelector('#guestLanguageContinueBtn');
        expect(continueBtn.disabled).toBe(false);
        expect(container.querySelector('#guestLanguageContinueBtnText').textContent).toBe('Español');
    });

    it('renders the step in Portuguese when the browser is Portuguese', () => {
        root = renderModal(container, { detectedLang: 'PT' });

        expect(container.querySelector('#guestLoginModalTitleText').textContent)
            .toContain('Pratique inglês conosco de graça!');
        expect(container.querySelector('#guestLanguageSelect option').textContent)
            .toBe('Selecione seu idioma...');
    });
});

describe('GuestLoginModal login step language', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        container = null;
    });

    // The login-choice step must render in the SAME language as the step the
    // guest just used — every guest_modal_* key carries pt/fr, not just es/hi/bn.
    it('uses the confirmed language on the login-choice step', () => {
        root = renderModal(container, { detectedLang: 'PT', step: 'login-choice', nativeLanguage: 'PT' });

        expect(container.querySelector('#guestLoginModalTitleText').textContent).toBe('Bem-vindo!');
        expect(container.querySelector('#guestLoginModalBodyText').textContent)
            .toBe('Você não está conectado no momento.');
        expect(container.querySelector('#guestLoginBtnText').textContent).toBe('Entrar');
        expect(container.querySelector('#guestSignupBtnText').textContent).toBe('Cadastrar-se');
        expect(container.querySelector('#guestContinueBtnText').textContent).toBe('Continuar como convidado');
    });

    it('falls back to the detected language when the guest chose OTHER', () => {
        root = renderModal(container, { detectedLang: 'ES', step: 'login-choice', nativeLanguage: 'OTHER' });

        expect(container.querySelector('#guestLoginModalTitleText').textContent).toBe('¡Bienvenido!');
        expect(container.querySelector('#guestLoginBtnText').textContent).toBe('Iniciar sesión');
    });
});
