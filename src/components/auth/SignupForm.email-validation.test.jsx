// The zero-cost email screen inside useSignupForm: it must run after the captcha
// gate and strictly BEFORE supabase.auth.signUp, a definite rejection must
// create no account and no profile row, and it must hand back a reason CODE
// rather than user-facing copy (display owns language).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const { insertCalls, signUpSpy, verifySpy, tokenSpy, emailSpy } = vi.hoisted(() => ({
    insertCalls: [],
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

vi.mock('../../modules/auth/email-validation-logic.js', () => ({
    checkEmailAddress: (...args) => emailSpy(...args),
    normalizeEmail: (raw) => (typeof raw === 'string' ? raw.trim().toLowerCase() : ''),
}));

import { useSignupForm } from './SignupForm.jsx';
import { appStore } from '../../modules/store/store.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ options, email = 'jo@example.com' }) {
    const form = useSignupForm(options);
    const click = (id, fn) => (
        <button data-testid={id} onClick={() => fn()}>{id}</button>
    );
    return (
        <div>
            {click('first', () => form.setFirstName('Jo'))}
            {click('last', () => form.setLastName('Kim'))}
            {click('email', () => form.setEmail(email))}
            {click('password', () => form.setPassword('password123'))}
            {click('submit', () => form.handleSubmit({ preventDefault() {} }))}
            <div data-testid="error">{form.error}</div>
            <div data-testid="email-error">{form.emailError}</div>
            <div data-testid="email-suggestion">{form.emailSuggestion}</div>
            <div data-testid="loading">{String(form.loading)}</div>
        </div>
    );
}

async function submit(options, email) {
    await act(async () => { host.render(<Harness options={options} email={email} />); });
    for (const id of ['first', 'last', 'email', 'password', 'submit']) {
        await act(async () => {
            container.querySelector(`[data-testid="${id}"]`)
                .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
    }
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
}

const read = (id) => container.querySelector(`[data-testid="${id}"]`).textContent;

let host;
let container;

beforeEach(() => {
    insertCalls.length = 0;
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
    vi.restoreAllMocks();
});

describe('useSignupForm email screen', () => {
    it('runs after the captcha gate and before signUp', async () => {
        const order = [];
        tokenSpy.mockImplementation(async () => { order.push('token'); return 'cf-token-1'; });
        verifySpy.mockImplementation(async () => { order.push('verify'); return true; });
        emailSpy.mockImplementation(async () => {
            order.push('email');
            return { valid: true, reason: 'ok', suggestion: '' };
        });
        signUpSpy.mockImplementation(async () => {
            order.push('signUp');
            return {
                data: { user: { id: 'u1', email: 'jo@example.com', created_at: '2026-10-10' } },
                error: null,
            };
        });

        await submit({ captcha: true, getCaptchaToken: tokenSpy });

        expect(order).toEqual(['token', 'verify', 'email', 'signUp']);
        expect(insertCalls.length).toBe(1);
    });

    it('creates no account and no profile row when the address is rejected', async () => {
        emailSpy.mockResolvedValue({ valid: false, reason: 'disposable', suggestion: '' });

        await submit({ captcha: true, getCaptchaToken: tokenSpy });

        expect(signUpSpy).not.toHaveBeenCalled();
        expect(insertCalls.length).toBe(0);
    });

    it('surfaces the reason CODE, not copy, and clears the generic submit error', async () => {
        emailSpy.mockResolvedValue({ valid: false, reason: 'disposable', suggestion: '' });

        await submit({ captcha: true, getCaptchaToken: tokenSpy });

        expect(read('email-error')).toBe('disposable');
        // A rejected address must not read as a generic failure.
        expect(read('error')).toBe('');
        // The early return still runs the finally, so the button re-enables.
        expect(read('loading')).toBe('false');
    });

    it('carries the server suggestion for a typo verdict', async () => {
        emailSpy.mockResolvedValue({ valid: false, reason: 'typo', suggestion: 'gmail.com' });

        await submit({ captcha: true, getCaptchaToken: tokenSpy });

        expect(read('email-error')).toBe('typo');
        expect(read('email-suggestion')).toBe('gmail.com');
        expect(signUpSpy).not.toHaveBeenCalled();
    });

    it('sends the normalized address, so the screen sees one canonical identity', async () => {
        await submit({ captcha: true, getCaptchaToken: tokenSpy }, '  Jo@Example.COM ');

        expect(emailSpy).toHaveBeenCalledWith('jo@example.com');
    });

    it('signs up normally and leaves emailError empty when the address passes', async () => {
        await submit({ captcha: true, getCaptchaToken: tokenSpy });

        expect(signUpSpy).toHaveBeenCalledTimes(1);
        expect(insertCalls.length).toBe(1);
        expect(read('email-error')).toBe('');
        expect(read('email-suggestion')).toBe('');
    });

    it('treats a fail-open verdict as indistinguishable from a pass', async () => {
        // lookup-unavailable means the screen could not reach a verdict. It must
        // behave exactly like a pass, or a resolver outage would cost a signup.
        emailSpy.mockResolvedValue({ valid: true, reason: 'lookup-unavailable', suggestion: '' });

        await submit({ captcha: true, getCaptchaToken: tokenSpy });

        expect(signUpSpy).toHaveBeenCalledTimes(1);
        expect(insertCalls.length).toBe(1);
        expect(read('error')).toBe('');
        expect(read('email-error')).toBe('');
    });

    it('blocks on a definite DNS verdict, naming the reason', async () => {
        // The opposite of fail-open: a domain with no mail route is a real
        // rejection, so no account may be created.
        emailSpy.mockResolvedValue({ valid: false, reason: 'no-mail-route', suggestion: '' });

        await submit({ captcha: true, getCaptchaToken: tokenSpy });

        expect(signUpSpy).not.toHaveBeenCalled();
        expect(insertCalls.length).toBe(0);
        expect(read('email-error')).toBe('no-mail-route');
        expect(read('error')).toBe('');
    });

    it('clears a stale rejection when the next submit passes', async () => {
        emailSpy.mockResolvedValueOnce({ valid: false, reason: 'disposable', suggestion: '' });
        await submit({ captcha: true, getCaptchaToken: tokenSpy });
        expect(read('email-error')).toBe('disposable');

        emailSpy.mockResolvedValue({ valid: true, reason: 'ok', suggestion: '' });
        await submit({ captcha: true, getCaptchaToken: tokenSpy });

        expect(read('email-error')).toBe('');
        expect(read('email-suggestion')).toBe('');
        expect(signUpSpy).toHaveBeenCalledTimes(1);
    });

    it('applies to the captcha:false surface too (the SaveClipsSignupForm path)', async () => {
        // The email screen is a data-quality gate, not a bot gate, so turning
        // the captcha off must not silently turn this one off as well.
        emailSpy.mockResolvedValue({ valid: false, reason: 'null-mx', suggestion: '' });

        await submit({ captcha: false });

        expect(verifySpy).not.toHaveBeenCalled();
        expect(tokenSpy).not.toHaveBeenCalled();
        expect(emailSpy).toHaveBeenCalledTimes(1);
        expect(signUpSpy).not.toHaveBeenCalled();
        expect(insertCalls.length).toBe(0);
        expect(read('email-error')).toBe('null-mx');
    });
});
