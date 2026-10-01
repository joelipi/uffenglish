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

function renderModal(container, { detectedLang }) {
    appStore.setState({
        isGuestModalOpen: true,
        guestModalStep: 'select-language',
        guestModalFriendMode: false,
        guestNativeLanguage: null,
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

    it('relabels the two non-translation exits', () => {
        root = renderModal(container, { detectedLang: 'EN' });

        expect(container.querySelector('#guestEnglishOnlyBtnText').textContent)
            .toBe('No translations (not recommended)');
        expect(container.querySelector('#guestNotListedBtnText').textContent)
            .toBe('My language is not on this list (continue without translations)');
    });

    it('confirms English-only and advances to login-choice', () => {
        root = renderModal(container, { detectedLang: 'EN' });

        act(() => {
            container.querySelector('#guestEnglishOnlyBtn').click();
        });

        expect(appStore.getState().guestNativeLanguage).toBe('EN');
        expect(appStore.getState().guestModalStep).toBe('login-choice');
    });

    it('records OTHER when the language is not listed', () => {
        root = renderModal(container, { detectedLang: 'EN' });

        act(() => {
            container.querySelector('#guestNotListedBtn').click();
        });

        expect(appStore.getState().guestNativeLanguage).toBe('OTHER');
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
});
