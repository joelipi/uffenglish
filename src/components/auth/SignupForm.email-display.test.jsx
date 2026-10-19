// Separation of concerns at the signup surface: the hook returns a reason CODE
// and SignupForm.web.jsx resolves it into localized copy. These tests pin the
// display half — in particular that the copy is actually localized, which a
// code-only hook makes possible.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { signupFormMock } = vi.hoisted(() => ({ signupFormMock: vi.fn() }));

// Mock the hook so the display is exercised with a fixed verdict, independently
// of the network and of Supabase.
vi.mock('./SignupForm.jsx', () => ({
    useSignupForm: (...args) => signupFormMock(...args),
}));

// The widget pulls a Cloudflare script and the consent block pulls legal copy —
// neither is under test here.
vi.mock('./TurnstileCaptcha.web.jsx', () => ({
    default: () => <div data-testid="turnstile" />,
}));

vi.mock('../legal/SignupConsent.jsx', () => ({
    default: () => <div data-testid="consent" />,
}));

import SignupForm from './SignupForm.web.jsx';
import { emailValidationErrorKey } from '../../modules/auth/email-validation-logic.js';
import Strings from '../../data/strings.js';
import { appStore } from '../../modules/store/store.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE_FORM = {
    firstName: 'Jo',
    setFirstName: () => {},
    lastName: 'Kim',
    setLastName: () => {},
    email: 'jo@example.com',
    handleEmailChange: () => {},
    password: 'password123',
    setPassword: () => {},
    nativeLanguage: 'es',
    setNativeLanguage: () => {},
    userLevel: 'A1',
    setUserLevel: () => {},
    error: '',
    emailError: '',
    emailSuggestion: '',
    loading: false,
    handleSubmit: (e) => e.preventDefault(),
};

async function render({ lang = 'hi', emailError = '', emailSuggestion = '' } = {}) {
    appStore.setState({ guestNativeLanguage: lang, userData: null });
    signupFormMock.mockReturnValue({ ...BASE_FORM, emailError, emailSuggestion });
    await act(async () => { host.render(<SignupForm />); });
}

const alert = () => container.querySelector('[data-testid="email-error"]');
const text = () => container.textContent;

let host;
let container;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    host = createRoot(container);
});

afterEach(() => {
    act(() => host.unmount());
    container.remove();
    signupFormMock.mockReset();
    appStore.setState({ guestNativeLanguage: '', userData: null });
});

describe('SignupForm.web.jsx email screen display', () => {
    it('renders no alert when the hook reports no code', async () => {
        await render({ lang: 'hi', emailError: '' });
        expect(alert()).toBeNull();
    });

    it('resolves the code to the localized copy for the guest language', async () => {
        await render({ lang: 'hi', emailError: 'disposable' });
        expect(alert().textContent).toBe(
            Strings.get(emailValidationErrorKey('disposable'), 'hi'));
        // Not the English source string: the copy really is localized.
        expect(alert().textContent).not.toBe(Strings.get(emailValidationErrorKey('disposable'), 'en'));
        expect(alert().textContent).toMatch(/[\u0900-\u097F]/); // Devanagari
    });

    it.each(['es', 'pt', 'fr', 'hi', 'bn'])('localizes the copy for %s', async (lang) => {
        await render({ lang, emailError: 'domain-not-found' });
        expect(alert().textContent).toBe(
            Strings.get(emailValidationErrorKey('domain-not-found'), lang));
        expect(alert().textContent).not.toBe(
            Strings.get(emailValidationErrorKey('domain-not-found'), 'en'));
    });

    // Every code in every non-English locale. Only domain-not-found was checked
    // across locales before, so a dropped es value on any other new key would
    // have gone unnoticed.
    it.each([
        ['empty', 'auth_email_error_required'],
        ['syntax', 'auth_email_error_invalid'],
        ['domain', 'auth_email_error_invalid'],
        ['too-long', 'auth_email_error_invalid'],
        ['disposable', 'auth_email_error_disposable'],
        ['typo', 'auth_email_error_typo'],
        ['domain-not-found', 'auth_email_error_no_mail'],
        ['null-mx', 'auth_email_error_no_mail'],
        ['no-mail-route', 'auth_email_error_no_mail'],
        ['something-unmapped', 'auth_email_error_invalid'],
    ])('renders %s localized, not English, in every UI language', async (code, key) => {
        for (const lang of ['es', 'pt', 'fr', 'hi', 'bn']) {
            await render({ lang, emailError: code, emailSuggestion: 'gmail.com' });
            expect(alert().textContent, `${code}/${lang}`).toBe(
                Strings.get(key, lang, { suggestion: 'gmail.com' }));
            expect(alert().textContent, `${code}/${lang} fell back to English`)
                .not.toBe(Strings.get(key, 'en', { suggestion: 'gmail.com' }));
        }
    });

    it.each([
        ['empty', 'auth_email_error_required', ''],
        ['syntax', 'auth_email_error_invalid', ''],
        ['domain', 'auth_email_error_invalid', ''],
        ['too-long', 'auth_email_error_invalid', ''],
        ['disposable', 'auth_email_error_disposable', ''],
        ['typo', 'auth_email_error_typo', 'gmail.com'],
        ['domain-not-found', 'auth_email_error_no_mail', ''],
        ['null-mx', 'auth_email_error_no_mail', ''],
        ['no-mail-route', 'auth_email_error_no_mail', ''],
        ['something-unmapped', 'auth_email_error_invalid', ''],
    ])('renders the right message for the %s code', async (code, key, suggestion) => {
        await render({ lang: 'en', emailError: code, emailSuggestion: suggestion });
        // Compared against the same substitution the view performs, so a broken
        // placeholder cannot pass unnoticed.
        expect(alert().textContent).toBe(Strings.get(key, 'en', { suggestion }));
    });

    it('interpolates the suggested domain into the typo message', async () => {
        await render({ lang: 'en', emailError: 'typo', emailSuggestion: 'gmail.com' });
        expect(alert().textContent).toContain('gmail.com');
        // The raw placeholder must not survive into the rendered output.
        expect(alert().textContent).not.toContain('{suggestion}');
    });

    it('interpolates the suggestion in a non-English language too', async () => {
        await render({ lang: 'hi', emailError: 'typo', emailSuggestion: 'gmail.com' });
        expect(alert().textContent).toContain('gmail.com');
        expect(alert().textContent).not.toContain('{suggestion}');
    });

    it('keeps the email alert separate from the generic submit error', async () => {
        signupFormMock.mockReturnValue({
            ...BASE_FORM,
            error: 'Password should be at least 8 characters.',
            emailError: 'disposable',
        });
        appStore.setState({ guestNativeLanguage: 'en', userData: null });
        await act(async () => { host.render(<SignupForm />); });

        const alerts = [...container.querySelectorAll('[role="alert"]')];
        expect(alerts).toHaveLength(2);
        expect(alerts.some((el) => el.dataset.testid === 'email-error')).toBe(true);
    });

    it('routes a keystroke on #email through the hook, without throwing', async () => {
        // Regression: the view once destructured setEmailError/setEmailSuggestion,
        // which the hook never returned, so typing after a rejection threw
        // `setEmailError is not a function` on EVERY keystroke — breaking the
        // one path the user must be able to take to recover. Driven through the
        // real DOM event, because no unit test of the hook alone could catch it.
        const changes = [];
        signupFormMock.mockReturnValue({
            ...BASE_FORM,
            emailError: 'disposable',
            handleEmailChange: (value) => changes.push(value),
        });
        appStore.setState({ guestNativeLanguage: 'en', userData: null });
        await act(async () => { host.render(<SignupForm />); });
        expect(alert()).not.toBeNull();

        // React tracks the input's value, so assigning `.value` directly is
        // swallowed; the native setter bypasses the tracker and lets onChange run.
        const input = container.querySelector('#email');
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value').set;
        await act(async () => {
            nativeSetter.call(input, 'jo@gmail.com');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });

        expect(changes).toEqual(['jo@gmail.com']);
    });

    it('renders the same resolved copy on the save-clips modal', async () => {
        // The modal shares the hook, so a rejected address there used to
        // re-enable the button with no message at all. Asserted behaviourally
        // because a token check cannot tell an alert apart from a destructuring.
        // (The structural side of this lives in signup-email-check-wiring.test.js,
        // which also covers the modal; this is the behavioural side.)
        const { default: SaveClips } = await import('../modals/SaveClipsSignupForm.jsx');
        signupFormMock.mockReturnValue({
            ...BASE_FORM,
            emailError: 'domain-not-found',
        });
        appStore.setState({ guestNativeLanguage: 'es', userData: null });

        // Own container + root: `host` is already bound to `container`, so
        // mounting a second root there would leak on a failed assertion.
        const modalContainer = document.createElement('div');
        document.body.appendChild(modalContainer);
        const modalRoot = createRoot(modalContainer);
        try {
            await act(async () => { modalRoot.render(<SaveClips />); });

            const modalAlert = modalContainer.querySelector('[data-testid="email-error"]');
            expect(modalAlert, 'the modal renders no email verdict').not.toBeNull();
            expect(modalAlert.textContent)
                .toBe(Strings.get(emailValidationErrorKey('domain-not-found'), 'es'));
            // Localized, not the English source string.
            expect(modalAlert.textContent)
                .not.toBe(Strings.get(emailValidationErrorKey('domain-not-found'), 'en'));
        } finally {
            act(() => modalRoot.unmount());
            modalContainer.remove();
        }
    });
});
