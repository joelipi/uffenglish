import { describe, it, expect } from 'vitest';
import { buildWelcomeEmail, hasEmailCopy } from './welcome-email-content.js';

const URL = 'https://app.example/confirm-email?token=abc';

describe('buildWelcomeEmail', () => {
    it('localizes subject/html/text and reports the resolved language', () => {
        const email = buildWelcomeEmail('es', URL);
        expect(email.language).toBe('es');
        expect(email.subject).toBe('Confirma tu correo electrónico');
        expect(email.html).toContain('Confirmar mi correo');
        expect(email.html).toContain(`href="${URL}"`);
        expect(email.text).toContain(URL);
    });

    it('covers the signup languages beyond the original examples', () => {
        expect(buildWelcomeEmail('de', URL).subject).toBe('Bestätige deine E-Mail-Adresse');
        expect(buildWelcomeEmail('ko', URL).subject).toBe('이메일 주소를 확인해 주세요');
        expect(buildWelcomeEmail('fr-FR', URL).subject).toBe('Confirmez votre adresse e-mail');
    });

    it('keeps TW (Traditional) and ZH (Simplified) distinct', () => {
        const tw = buildWelcomeEmail('TW', URL);
        const zh = buildWelcomeEmail('ZH', URL);
        expect(tw.language).toBe('tw');
        expect(zh.language).toBe('zh');
        expect(tw.subject).toContain('電子'); // Traditional
        expect(zh.subject).toContain('电子'); // Simplified
        expect(tw.subject).not.toBe(zh.subject);
    });

    it('falls back to English for an unknown or missing language', () => {
        for (const lang of ['xx', '', null, undefined, 'not-a-language']) {
            const email = buildWelcomeEmail(lang, URL);
            expect(email.language, String(lang)).toBe('en');
            expect(email.subject).toBe('Confirm your email address');
        }
    });

    it('treats a partial translation as unsupported (no mixed-language email)', () => {
        // Negative path: this fails if hasEmailCopy only checks the subject.
        const partial = {
            email_welcome_subject: { es: 'Asunto' },
            email_welcome_heading: { es: 'Encabezado' },
            email_welcome_intro: { es: 'Intro' },
            email_welcome_cta: { es: 'CTA' },
            // email_welcome_ignore deliberately missing
        };
        expect(hasEmailCopy('es', partial)).toBe(false);
        expect(hasEmailCopy('es', { ...partial, email_welcome_ignore: { es: 'Ignorar' } })).toBe(true);
    });

    it('has a complete table entry for every supported language', () => {
        // Table-completeness guard: dropping one of the five keys from a
        // supported language fails this (the fallback logic is pinned by the
        // hasEmailCopy negative test above).
        const supported = [
            'en', 'es', 'pt', 'fr', 'de', 'it', 'nl', 'sv', 'da', 'nb', 'fi',
            'pl', 'cs', 'hu', 'ro', 'el', 'ru', 'uk', 'tr', 'ar', 'vi', 'th',
            'ja', 'ko', 'zh', 'tw', 'hi', 'bn',
        ];
        for (const code of supported) {
            expect(buildWelcomeEmail(code, URL).language, code).toBe(code);
        }
    });

    it('mirrors the body for RTL languages (Arabic)', () => {
        expect(buildWelcomeEmail('ar', URL).html).toContain('dir="rtl"');
        expect(buildWelcomeEmail('en', URL).html).not.toContain('dir="rtl"');
    });

    it('escapes the confirmation URL in the HTML href', () => {
        const email = buildWelcomeEmail('en', 'https://x/confirm?token=a&b="c"');
        expect(email.html).toContain('href="https://x/confirm?token=a&amp;b=&quot;c&quot;"');
    });
});
