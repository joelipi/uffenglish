import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

// Hoisted mocks: the container imports react-router-dom (navigation + Link)
// and the api layer (auth status + share-code lookup). Both are mocked so the
// container's own lookup/error/navigation behavior drives the real HomeLanding
// DOM without Supabase or a router.
const navigate = vi.fn();
const authStatus = { data: false };
const fetchUserByShareCode = vi.fn();

vi.mock('react-router-dom', () => ({
    useNavigate: () => navigate,
    Link: ({ to, children, ...rest }) => React.createElement('a', { href: to, ...rest }, children),
}));
vi.mock('../../modules/api/api.js', () => ({
    useAuthStatus: () => authStatus,
    fetchUserByShareCode: (...args) => fetchUserByShareCode(...args),
}));

import HomeLandingContainer from './HomeLandingContainer.jsx';
import { appStore } from '../../modules/store/store.js';
import { get } from '../../data/strings.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('HomeLandingContainer', () => {
    let container;
    let root;

    beforeEach(() => {
        navigate.mockClear();
        fetchUserByShareCode.mockReset();
        authStatus.data = false;
        appStore.setState({ guestNativeLanguage: 'en', userData: null });
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
    });

    const render = async () => {
        root = createRoot(container);
        await act(async () => {
            root.render(React.createElement(HomeLandingContainer));
        });
    };

    const q = (testid) => container.querySelector(`[data-testid="${testid}"]`);

    const typeCode = async (value) => {
        const input = q('share-code-input');
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };

    const submit = async () => {
        await act(async () => {
            q('share-code-go').closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
    };

    it('links to /login when logged out', async () => {
        await render();
        expect(q('landing-account-link').getAttribute('href')).toBe('/login');
    });

    it('links to /home when logged in', async () => {
        authStatus.data = true;
        await render();
        expect(q('landing-account-link').getAttribute('href')).toBe('/home');
    });

    it('navigates to the normalized profile route when a profile resolves', async () => {
        fetchUserByShareCode.mockResolvedValue({ id: 'u1' });
        await render();
        await typeCode('  ABC  ');
        await submit();

        expect(navigate).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith('/abc');
        expect(q('share-code-error')).toBeNull();
    });

    it('shows the not-found error and does not navigate for an unknown code', async () => {
        fetchUserByShareCode.mockResolvedValue(null);
        await render();
        await typeCode('missing');
        await submit();

        expect(navigate).not.toHaveBeenCalled();
        expect(q('share-code-error').textContent).toBe(get('home_landing_code_not_found', 'en'));
    });

    it('shows the required error and does not look up an empty code', async () => {
        await render();
        await submit();

        expect(fetchUserByShareCode).not.toHaveBeenCalled();
        expect(q('share-code-error').textContent).toBe(get('home_landing_code_required', 'en'));
    });

    it('shows the lookup error when the lookup rejects', async () => {
        fetchUserByShareCode.mockRejectedValue(new Error('network'));
        await render();
        await typeCode('abc');
        await submit();

        expect(navigate).not.toHaveBeenCalled();
        expect(q('share-code-error').textContent).toBe(get('home_landing_lookup_error', 'en'));
    });

    it('clears the error when the input is edited', async () => {
        fetchUserByShareCode.mockResolvedValue(null);
        await render();
        await typeCode('missing');
        await submit();
        expect(q('share-code-error')).not.toBeNull();

        await typeCode('missing2');
        expect(q('share-code-error')).toBeNull();
    });

    it('clears the error and navigates on a later successful submit', async () => {
        fetchUserByShareCode.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'u1' });
        await render();
        await typeCode('missing');
        await submit();
        expect(q('share-code-error')).not.toBeNull();

        await typeCode('abc');
        await submit();
        expect(q('share-code-error')).toBeNull();
        expect(navigate).toHaveBeenCalledWith('/abc');
    });

    it('localizes the headline from the guest language', async () => {
        appStore.setState({ guestNativeLanguage: 'es' });
        await render();
        expect(q('share-code-headline').textContent).toBe(get('home_landing_headline', 'es'));
    });

    it('navigates to the Would You Rather ask lesson when no code is available', async () => {
        await render();
        await act(async () => { q('no-code').click(); });
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith('/course/wouldrather/lesson/a');
    });

    it('ignores a second submit while the first lookup is still in flight', async () => {
        let resolveLookup;
        fetchUserByShareCode.mockReturnValue(new Promise((resolve) => { resolveLookup = resolve; }));
        await render();
        await typeCode('abc');

        // Second submit fires while the first lookup has not settled.
        await submit();
        await submit();
        expect(fetchUserByShareCode).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveLookup({ id: 'u1' });
        });

        expect(fetchUserByShareCode).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith('/abc');
    });
});
