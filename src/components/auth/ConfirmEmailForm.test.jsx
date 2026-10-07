// Behavioral test for the /confirm-email landing page. Renders the real DOM
// (no source guard) with the RPC helper mocked, so the pending → confirmed /
// invalid transition is exercised end to end.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const { confirmEmailTokenMock } = vi.hoisted(() => ({
    confirmEmailTokenMock: vi.fn(),
}));

vi.mock('../../modules/user/email-confirmation.js', () => ({
    confirmEmailToken: confirmEmailTokenMock,
}));

import ConfirmEmailForm from './ConfirmEmailForm.web.jsx';
import Strings from '../../data/strings.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('ConfirmEmailForm', () => {
    let container;
    let root;

    beforeEach(() => {
        confirmEmailTokenMock.mockReset();
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
    });

    const render = async (props) => {
        root = createRoot(container);
        await act(async () => {
            root.render(React.createElement(ConfirmEmailForm, props));
        });
    };

    const text = () => container.textContent;

    it('shows the pending copy while the RPC is in flight', async () => {
        confirmEmailTokenMock.mockReturnValue(new Promise(() => {}));
        await render({ token: 'a'.repeat(64), onContinue: () => {} });
        expect(text()).toContain(Strings.get('auth_confirm_email_pending', 'en'));
        expect(container.querySelector('button')).toBeNull();
    });

    it('shows the success copy and calls onContinue when confirmed', async () => {
        confirmEmailTokenMock.mockResolvedValue(true);
        const onContinue = vi.fn();
        await render({ token: 'a'.repeat(64), onContinue });
        expect(text()).toContain(Strings.get('auth_confirm_email_success', 'en'));
        expect(text()).not.toContain(Strings.get('auth_confirm_email_pending', 'en'));

        await act(async () => {
            container.querySelector('button').click();
        });
        expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it('shows the invalid copy when the token is rejected', async () => {
        confirmEmailTokenMock.mockResolvedValue(false);
        await render({ token: 'a'.repeat(64), onContinue: () => {} });
        expect(text()).toContain(Strings.get('auth_confirm_email_invalid', 'en'));
    });

    it('shows the invalid copy when there is no token in the URL', async () => {
        confirmEmailTokenMock.mockResolvedValue(false);
        await render({ token: null, onContinue: () => {} });
        expect(text()).toContain(Strings.get('auth_confirm_email_invalid', 'en'));
        // A missing token is still passed through the shared guard, which
        // rejects it without reaching the RPC.
        expect(confirmEmailTokenMock).toHaveBeenCalledWith(null);
    });

    it('runs the single-use RPC only once under StrictMode', async () => {
        // StrictMode double-invokes effects in dev; a second RPC call would
        // find the token already burned and wrongly show "invalid".
        confirmEmailTokenMock.mockResolvedValue(true);
        root = createRoot(container);
        await act(async () => {
            root.render(
                React.createElement(React.StrictMode, null,
                    React.createElement(ConfirmEmailForm, { token: 'a'.repeat(64), onContinue: () => {} })
                )
            );
        });
        expect(confirmEmailTokenMock).toHaveBeenCalledTimes(1);
        expect(text()).toContain(Strings.get('auth_confirm_email_success', 'en'));
    });
});
