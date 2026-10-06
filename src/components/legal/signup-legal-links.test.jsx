// Task 2 (story 050): every sign-up surface shows the legal links footer —
// SaveClipsModal (via SaveClipsSignupForm), the standalone /signup form, and
// GuestLoginModal on both of its steps. These render the real DOM (no source
// guards) per the story and docs/learnings.md.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { appStore } from '../../modules/store/store.js';
import SaveClipsModal from '../modals/SaveClipsModal.web.jsx';
import SaveClipsSignupForm from '../modals/SaveClipsSignupForm.jsx';
import SignupForm from '../auth/SignupForm.web.jsx';
import GuestLoginModal from '../modals/GuestLoginModal.web.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** True when `other` comes after `node` in document order. */
function comesAfter(node, other) {
    return Boolean(node.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('sign-up surfaces show legal links', () => {
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
    });

    const render = (Component, props = {}) => {
        root = createRoot(container);
        act(() => {
            root.render(
                React.createElement(MemoryRouter, null,
                    React.createElement(Component, props)
                )
            );
        });
    };

    const anchors = (scope = container) =>
        [...scope.querySelectorAll('[data-testid="legal-links"] a')];

    const expectPrivacyAndTerms = (scope = container) => {
        expect(anchors(scope).map((a) => a.getAttribute('href'))).toEqual(['/privacy', '/terms']);
    };

    describe('SaveClipsModal', () => {
        it('shows the legal links after the form', () => {
            appStore.setState({
                saveClipsModalOpen: true,
                pendingPublishLessonId: null,
                userData: null,
                guestNativeLanguage: null,
            });
            render(SaveClipsModal);

            const modal = container.querySelector('#saveClipsModal');
            const links = modal.querySelector('[data-testid="legal-links"]');
            expect(links).not.toBeNull();
            expectPrivacyAndTerms(modal);

            const form = modal.querySelector('form');
            expect(comesAfter(form, links)).toBe(true);
        });
    });

    describe('SaveClipsSignupForm', () => {
        it('shows the legal links after the form', () => {
            render(SaveClipsSignupForm);

            const links = container.querySelector('[data-testid="legal-links"]');
            expect(links).not.toBeNull();
            expectPrivacyAndTerms();

            const form = container.querySelector('form');
            expect(comesAfter(form, links)).toBe(true);
        });

        it('shows the links on initial render and outside the form', () => {
            render(SaveClipsSignupForm);

            const links = container.querySelector('[data-testid="legal-links"]');
            expect(links).not.toBeNull();

            const form = container.querySelector('form');
            expect(form.contains(links)).toBe(false);
        });
    });

    describe('SignupForm (/signup)', () => {
        it('shows the legal links after the form', () => {
            render(SignupForm);

            const links = container.querySelector('[data-testid="legal-links"]');
            expect(links).not.toBeNull();
            expectPrivacyAndTerms();

            const form = container.querySelector('form');
            expect(comesAfter(form, links)).toBe(true);
        });
    });

    describe('GuestLoginModal', () => {
        it('shows the legal links on the login-choice step', () => {
            appStore.setState({
                isGuestModalOpen: true,
                guestModalStep: 'login-choice',
                guestModalFriendMode: false,
                guestNativeLanguage: 'EN',
                guestDetectedLang: 'EN',
                userData: null,
            });
            render(GuestLoginModal);

            const modal = container.querySelector('#guestLoginModal');
            const links = modal.querySelector('[data-testid="legal-links"]');
            expect(links).not.toBeNull();
            expectPrivacyAndTerms(modal);

            const content = modal.querySelector('.modal-content');
            expect(content.contains(links)).toBe(true);
            expect(modal.querySelector('#guestSignupBtn')).not.toBeNull();
        });

        it('shows the legal links on the select-language step, localized', () => {
            appStore.setState({
                isGuestModalOpen: true,
                guestModalStep: 'select-language',
                guestModalFriendMode: false,
                guestNativeLanguage: null,
                guestDetectedLang: 'ES',
                userData: null,
            });
            render(GuestLoginModal);

            const modal = container.querySelector('#guestLoginModal');
            const links = modal.querySelector('[data-testid="legal-links"]');
            expect(links).not.toBeNull();
            expect(anchors(modal).map((a) => a.textContent))
                .toEqual(['Política de Privacidad', 'Términos del Servicio']);
        });
    });
});
