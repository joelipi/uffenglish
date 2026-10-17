// Separation of concerns at the signup surface: the hook returns a reason CODE
// and SignupForm.web.jsx resolves it into localized copy. These tests pin the
// display half — in particular that the copy is actually localized, which a
// code-only hook makes possible.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

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
    setEmail: () => {},
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
});
