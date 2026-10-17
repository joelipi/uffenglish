// The Turnstile gate in useSignupForm: the token must be verified server-side
// BEFORE any account is created, a failed verification must create no account,
// and `captcha: false` must skip the gate entirely (the success-step modal form).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const { insertCalls, upsertOpts, signUpSpy, verifySpy, tokenSpy, emailSpy } = vi.hoisted(() => ({
    insertCalls: [],
    upsertOpts: [],
    signUpSpy: vi.fn(),
    verifySpy: vi.fn(),
    tokenSpy: vi.fn(),
    emailSpy: vi.fn(),
}));

vi.mock('../../modules/api/supabase.js', () => ({
    supabase: {
        auth: {
            signUp: (...args) => signUpSpy(...args),
        },
        from: () => ({
            upsert: (row, opts) => {
                upsertOpts.push(opts);
                insertCalls.push(row);
                return Promise.resolve({ error: null });
            },
            insert: (row) => {
                insertCalls.push(row);
                return Promise.resolve({ error: null });
            },
        }),
    },
}));

vi.mock('../../modules/api/api.js', () => ({
    queryClient: { setQueryData: vi.fn(), invalidateQueries: vi.fn() },
}));

vi.mock('../../modules/user/email-confirmation.js', () => ({
    sendWelcomeEmail: vi.fn(async () => ({ sent: true })),
}));

vi.mock('../../modules/auth/turnstile-logic.js', () => ({
    verifyTurnstileToken: (...args) => verifySpy(...args),
}));

// The zero-cost email screen also runs inside handleSubmit. Without this mock
// it would attempt a real fetch, so the order assertion below would race the
// network. Its own behaviour is covered in SignupForm.email-validation.test.jsx.
vi.mock('../../modules/auth/email-validation-logic.js', () => ({
    checkEmailAddress: (...args) => emailSpy(...args),
    normalizeEmail: (raw) => (typeof raw === 'string' ? raw.trim().toLowerCase() : ''),
}));

import { useSignupForm } from './SignupForm.jsx';
import { appStore } from '../../modules/store/store.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ options }) {
    const form = useSignupForm(options);
    const click = (id, fn) => (
        <button data-testid={id} onClick={() => fn()}>{id}</button>
    );
    return (
        <div>
            {click('first', () => form.setFirstName('Jo'))}
            {click('last', () => form.setLastName('Kim'))}
            {click('email', () => form.handleEmailChange('jo@example.com'))}
            {click('password', () => form.setPassword('password123'))}
            {click('submit', () => form.handleSubmit({ preventDefault() {} }))}
            <div data-testid="error">{form.error}</div>
        </div>
    );
}

async function submit(options) {
    await act(async () => { host.render(<Harness options={options} />); });
    for (const id of ['first', 'last', 'email', 'password', 'submit']) {
        await act(async () => {
            container.querySelector(`[data-testid="${id}"]`)
                .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
    }
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
}

let host;
let container;

beforeEach(() => {
    insertCalls.length = 0;
    upsertOpts.length = 0;
    signUpSpy.mockReset().mockResolvedValue({
        data: { user: { id: 'new-user-1', email: 'jo@example.com', created_at: '2026-10-10' } },
        error: null,
    });
    verifySpy.mockReset().mockResolvedValue(true);
    tokenSpy.mockReset().mockResolvedValue('cf-token-1');
    emailSpy.mockReset().mockResolvedValue({ valid: true, reason: 'ok', suggestion: '' });
    appStore.setState({ pendingFriendCredits: [] });
    container = document.createElement('div');
    document.body.appendChild(container);
    host = createRoot(container);
});

afterEach(() => {
    act(() => host.unmount());
    container.remove();
});

describe('useSignupForm captcha gate', () => {
    it('verifies the token before creating the account', async () => {
        const order = [];
        tokenSpy.mockImplementation(async () => { order.push('token'); return 'cf-token-1'; });
        verifySpy.mockImplementation(async () => { order.push('verify'); return true; });
        emailSpy.mockImplementation(async () => { order.push('email'); return { valid: true, reason: 'ok', suggestion: '' }; });
        signUpSpy.mockImplementation(async () => {
            order.push('signUp');
            return {
                data: { user: { id: 'u1', email: 'jo@example.com', created_at: '2026-10-10' } },
                error: null,
            };
        });

        await submit({ captcha: true, getCaptchaToken: tokenSpy });

        // Every gate precedes account creation: captcha token, captcha verify,
        // then the email screen.
        expect(order).toEqual(['token', 'verify', 'email', 'signUp']);
        expect(verifySpy).toHaveBeenCalledWith('cf-token-1');
        expect(insertCalls.length).toBe(1);
    });

    it('creates no account when verification fails', async () => {
        verifySpy.mockResolvedValue(false);

        await submit({ captcha: true, getCaptchaToken: tokenSpy });

        expect(signUpSpy).not.toHaveBeenCalled();
        expect(insertCalls.length).toBe(0);
        expect(container.querySelector('[data-testid="error"]').textContent).toMatch(/human verification failed/i);
    });

    it('creates no account when the token provider is missing', async () => {
        await submit({ captcha: true });

        expect(tokenSpy).not.toHaveBeenCalled();
        expect(verifySpy).not.toHaveBeenCalled();
        expect(signUpSpy).not.toHaveBeenCalled();
        expect(insertCalls.length).toBe(0);
    });

    it('skips the gate entirely when captcha is false', async () => {
        await submit({ captcha: false });

        expect(tokenSpy).not.toHaveBeenCalled();
        expect(verifySpy).not.toHaveBeenCalled();
        expect(signUpSpy).toHaveBeenCalledTimes(1);
        expect(insertCalls.length).toBe(1);
    });

    it('gates by default (captcha defaults to on)', async () => {
        await submit({ getCaptchaToken: tokenSpy });

        expect(verifySpy).toHaveBeenCalledWith('cf-token-1');
        expect(signUpSpy).toHaveBeenCalledTimes(1);
    });
});
