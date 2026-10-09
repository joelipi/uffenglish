import { describe, it, expect } from 'vitest';
import { buildAuthEmail, hasAuthEmailCopy, buildVerifyUrl } from './auth-email-content.js';
import { PROFILE_LANGUAGES } from '../../data/languages.js';

const SUPABASE_URL = 'https://proj.supabase.co';
const base = { supabaseUrl: SUPABASE_URL, redirectTo: 'https://app.example/reset-password' };

describe('buildVerifyUrl', () => {
    it('builds the Supabase verify link with token/type/redirect_to', () => {
        const url = buildVerifyUrl({
            supabaseUrl: SUPABASE_URL,
            action: 'recovery',
            tokenHash: 'abc123',
            redirectTo: 'https://app.example/reset-password',
        });
        expect(url).toBe(
            'https://proj.supabase.co/auth/v1/verify?token=abc123&type=recovery&redirect_to=https%3A%2F%2Fapp.example%2Freset-password'
        );
    });
});

describe('buildAuthEmail — recovery', () => {
    it('localizes the subject and links to the verify URL', () => {
        const email = buildAuthEmail({ action: 'recovery', language: 'es', tokenHash: 'h', ...base });
        expect(email.language).toBe('es');
        expect(email.subject).toBe('Restablece tu contraseña');
        expect(email.html).toContain('auth/v1/verify?token=h&amp;type=recovery');
        expect(email.text).toContain('https://proj.supabase.co/auth/v1/verify?token=h&type=recovery');
    });

    it('escapes the verify URL in the html href (no raw & inside the attribute)', () => {
        const email = buildAuthEmail({ action: 'recovery', language: 'en', tokenHash: 'h', ...base });
        expect(email.html).toContain('&amp;type=recovery');
        expect(email.html).not.toContain('?token=h&type=recovery');
    });
});

describe('buildAuthEmail — email_change', () => {
    it('localizes the subject', () => {
        const email = buildAuthEmail({ action: 'email_change', language: 'de', tokenHash: 'h', ...base });
        expect(email.language).toBe('de');
        expect(email.subject).toBe('Bestätige deine neue E-Mail-Adresse');
    });
});

describe('buildAuthEmail — fallbacks', () => {
    it('uses a fully-English generic email for a non-localized action', () => {
        const email = buildAuthEmail({ action: 'magiclink', language: 'es', tokenHash: 'h', ...base });
        expect(email.language).toBe('en');
        expect(email.subject).toBe('Action required for your Ultrafast Fluency account');
        expect(email.html).toContain('Continue');
        expect(email.html).not.toContain('Continuar'); // never half translated
    });

    it('falls back to English for an unknown language', () => {
        const email = buildAuthEmail({ action: 'recovery', language: 'xx', tokenHash: 'h', ...base });
        expect(email.language).toBe('en');
        expect(email.subject).toBe('Reset your password');
    });

    it('shows the code (no link) for reauthentication', () => {
        const email = buildAuthEmail({ action: 'reauthentication', language: 'es', token: '123456', ...base });
        expect(email.html).toContain('123456');
        expect(email.html).not.toContain('auth/v1/verify');
    });

    it('sends an informational email (no link) for a notification', () => {
        const email = buildAuthEmail({ action: 'password_changed_notification', language: 'es', ...base });
        expect(email.html).not.toContain('auth/v1/verify');
        expect(email.subject).toContain('password was changed');
    });
});

describe('hasAuthEmailCopy completeness', () => {
    const SUPPORTED = [...PROFILE_LANGUAGES.map(({ value }) => value.toLowerCase()), 'tw'];

    it('carries all localized keys for every profile language (plus tw)', () => {
        for (const code of SUPPORTED) {
            expect(hasAuthEmailCopy(code), code).toBe(true);
        }
    });

    it('is false for a partial language (so the email falls back to English)', () => {
        const partial = {
            auth_email_subject_recovery: { es: 'x' },
            auth_email_subject_email_change: { es: 'y' },
            auth_email_body: { es: 'z' },
            auth_email_cta: { es: 'c' },
            // auth_email_ignore deliberately missing
        };
        expect(hasAuthEmailCopy('es', partial)).toBe(false);
    });
});
