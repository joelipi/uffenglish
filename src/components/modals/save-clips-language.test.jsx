// The save-clips signup/login modal and its inline form must resolve the active
// language the same way (guest-first, AGENTS.md). The modal title/body are
// guest-first in SaveClipsModal; the form previously read userData first, so a
// guest who picked Bengali while the async bootstrap wrote the fetched "EN"
// profile saw a Bengali title over English labels.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { appStore } from '../../modules/store/store.js';
import SaveClipsSignupForm from './SaveClipsSignupForm.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('save-clips form language', () => {
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

    const render = () => {
        root = createRoot(container);
        act(() => {
            root.render(
                React.createElement(MemoryRouter, null,
                    React.createElement(SaveClipsSignupForm)
                )
            );
        });
    };

    const label = (id) => container.querySelector(`label[for="${id}"]`).textContent;

    it('uses the guest language when the bootstrap profile disagrees', () => {
        appStore.setState({
            guestNativeLanguage: 'ES',
            userData: { native_language: 'EN' },
        });
        render();

        expect(label('save-clips-first-name')).toBe('Nombre');
        expect(label('save-clips-last-name')).toBe('Apellido');
    });

    it('falls back to the profile language for a logged-in user with no guest choice', () => {
        appStore.setState({
            guestNativeLanguage: null,
            userData: { native_language: 'ES' },
        });
        render();

        expect(label('save-clips-first-name')).toBe('Nombre');
    });
});
