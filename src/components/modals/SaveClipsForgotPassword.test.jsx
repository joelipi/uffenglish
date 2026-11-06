// The save-clips dialog's login form must offer the same "Forgot password?"
// affordance as the main login form (LoginForm.web.jsx). Recovery is swapped
// in place: closing the dialog is what triggers the deferred video generation,
// so the link must never route away or close the modal.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { appStore } from '../../modules/store/store.js';
import SaveClipsModal from './SaveClipsModal.web.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('SaveClipsModal — forgot password', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        appStore.setState({
            saveClipsModalOpen: true,
            pendingPublishLessonId: null,
            pendingVideoCreation: false,
            userData: null,
            guestNativeLanguage: 'ES',
        });
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
        container = null;
    });

    const renderModal = () => {
        root = createRoot(container);
        act(() => {
            root.render(
                React.createElement(MemoryRouter, null,
                    React.createElement(SaveClipsModal)
                )
            );
        });
    };

    const click = (element) => {
        expect(element).not.toBeNull();
        act(() => element.click());
    };

    const openLoginForm = () => {
        renderModal();
        click(container.querySelector('#saveClipsLoginLink'));
        return container.querySelector('#saveClipsForgotPasswordLink');
    };

    it('renders a localized "Forgot password?" link styled like the main login form', () => {
        const link = openLoginForm();

        expect(link).not.toBeNull();
        expect(link.textContent).toBe('¿Olvidaste tu contraseña?');
        expect(link.classList.contains('auth-link')).toBe(true);
        // Same placement as LoginForm.web.jsx: under the sign-up line.
        const signup = container.querySelector('#saveClipsSignupLink');
        expect(signup).not.toBeNull();
        expect(signup.parentElement.compareDocumentPosition(link)).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING
        );
    });

    it('swaps in the recovery form without closing the dialog', () => {
        openLoginForm();
        click(container.querySelector('#saveClipsForgotPasswordLink'));

        expect(container.querySelector('#saveClipsForgotPasswordLink')).toBeNull();
        expect(container.textContent).toContain('Recuperar Contraseña');
        expect(container.querySelector('#email')).not.toBeNull();
        // Closing the dialog would fire the deferred generation effect.
        expect(appStore.getState().saveClipsModalOpen).toBe(true);
    });

    it('returns to the login form from the recovery form', () => {
        openLoginForm();
        click(container.querySelector('#saveClipsForgotPasswordLink'));
        click(container.querySelector('#recoverBackToLoginLink'));

        expect(container.querySelector('#saveClipsForgotPasswordLink')).not.toBeNull();
        expect(container.textContent).not.toContain('Recuperar Contraseña');
    });
});
