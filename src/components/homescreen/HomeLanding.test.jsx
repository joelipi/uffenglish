import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import HomeLanding from './HomeLanding.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('HomeLanding', () => {
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

    const render = (props = {}) => {
        root = createRoot(container);
        act(() => {
            root.render(
                React.createElement(MemoryRouter, null,
                    React.createElement(HomeLanding, props)
                )
            );
        });
    };

    const q = (testid) => container.querySelector(`[data-testid="${testid}"]`);

    it('renders the English copy, account link and controls by default', () => {
        render();
        expect(q('share-code-headline').textContent).toBe('Practice English with your friends for free.');
        expect(q('share-code-subheadline').textContent).toBe("Enter your friend's share code");
        expect(q('share-code-go').textContent).toBe('Go');
        expect(q('no-code').textContent).toBe("I don't have a share code");
        expect(q('landing-account-link').getAttribute('href')).toBe('/login');
        expect(q('landing-account-link').textContent).toBe('Sign In');
    });

    it('links a logged-in visitor to /home with the Home label', () => {
        render({ isLoggedIn: true });
        expect(q('landing-account-link').getAttribute('href')).toBe('/home');
        expect(q('landing-account-link').textContent).toBe('Home');
    });

    it('localizes the headline and Go button', () => {
        render({ lang: 'es' });
        expect(q('share-code-headline').textContent).toBe('Practica inglés con tus amigos gratis.');
        expect(q('share-code-go').textContent).toBe('Ir');
    });

    it('updates the input value and calls onInputChange when typed into', () => {
        const onInputChange = vi.fn();
        render({ onInputChange });
        const input = q('share-code-input');
        act(() => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, 'abc');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(input.value).toBe('abc');
        expect(onInputChange).toHaveBeenCalledTimes(1);
    });

    it('calls onSubmitCode with the raw field value on submit', () => {
        const onSubmitCode = vi.fn();
        render({ onSubmitCode });
        const input = q('share-code-input');
        act(() => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, 'abc');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => {
            q('share-code-go').closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        expect(onSubmitCode).toHaveBeenCalledTimes(1);
        expect(onSubmitCode).toHaveBeenCalledWith('abc');
    });

    it('uses a submit-type Go button so click/Enter submits the form', () => {
        render();
        expect(q('share-code-go').getAttribute('type')).toBe('submit');
    });

    it('renders an alert error when error is non-null', () => {
        render({ error: 'boom' });
        expect(q('share-code-error')).not.toBeNull();
        expect(q('share-code-error').textContent).toBe('boom');
        expect(q('share-code-error').getAttribute('role')).toBe('alert');
    });

    it('renders no error element when error is null', () => {
        render({ error: null });
        expect(q('share-code-error')).toBeNull();
    });

    it('disables the Go button while loading', () => {
        render({ loading: true });
        expect(q('share-code-go').hasAttribute('disabled')).toBe(true);
    });

    it('leaves the Go button enabled when not loading', () => {
        render({ loading: false });
        expect(q('share-code-go').hasAttribute('disabled')).toBe(false);
    });

    it('calls onNoCode (and not onSubmitCode) when the no-code button is clicked', () => {
        const onNoCode = vi.fn();
        const onSubmitCode = vi.fn();
        render({ onNoCode, onSubmitCode });
        act(() => { q('no-code').click(); });
        expect(onNoCode).toHaveBeenCalledTimes(1);
        expect(onSubmitCode).not.toHaveBeenCalled();
    });
});
