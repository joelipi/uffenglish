// modules/user/auth-email-content.js
// Builds the localized Supabase auth emails sent from the Send Email Hook
// (functions/api/auth-email-hook.js). Copy lives in the shared translation
// table (data/strings.js) keyed `auth_email_*`, so it localizes to every
// language the app translates and falls back to English otherwise.
//
// The two flows this app exposes — password reset (RecoverPasswordForm) and
// email change (UserProfile) — are localized. Supabase's other actions
// (signup/invite/magiclink/reauthentication and the notification emails) send a
// correct English email so a newly enabled action never silently sends nothing;
// add `auth_email_subject_*` keys + an ACTION_SUBJECT_KEYS entry to localize one.

import { get, strings } from '../../data/strings.js';
import { normalizeEmailLanguage } from './email-language.js';
import { escapeHtml } from './html-escape.js';
import { isRtlLanguage } from './rtl-languages.js';

const FALLBACK_LANGUAGE = 'en';

// A language is used only when it carries the whole localized set, so an auth
// email is never half translated (same rule as the welcome email).
const COPY_KEYS = [
    'auth_email_subject_recovery',
    'auth_email_subject_email_change',
    'auth_email_body',
    'auth_email_cta',
    'auth_email_ignore',
];

const ACTION_SUBJECT_KEYS = {
    recovery: 'auth_email_subject_recovery',
    email_change: 'auth_email_subject_email_change',
};

// Subject for actions with no localized subject; the body/cta/ignore fall back
// to the English entries in strings.js so there is one source of truth.
const GENERIC_SUBJECT = 'Action required for your Ultrafast Fluency account';
const REAUTH_SUBJECT = 'Your Ultrafast Fluency verification code';
const REAUTH_BODY = 'Use this code to verify your identity. It expires shortly.';
const NOTIFICATION_EMAILS = {
    password_changed_notification: {
        subject: 'Your Ultrafast Fluency password was changed',
        body: 'Your password was just changed. If this was not you, reset it and contact support immediately.',
    },
    email_changed_notification: {
        subject: 'Your Ultrafast Fluency email was changed',
        body: 'Your email address was just changed. If this was not you, contact support immediately.',
    },
};

/** True when the shared table carries complete localized auth-email copy. */
export function hasAuthEmailCopy(code, table = strings) {
    return COPY_KEYS.every((key) => Boolean(table[key]?.[code]));
}

/**
 * The Supabase verify link the email button points at. Supabase verifies the
 * token and redirects to `redirect_to` (which must be an allow-listed URL).
 */
export function buildVerifyUrl({ supabaseUrl, action, tokenHash, redirectTo }) {
    const base = String(supabaseUrl || '').replace(/\/+$/, '');
    const params = new URLSearchParams({ token: tokenHash, type: action });
    if (redirectTo) params.set('redirect_to', redirectTo);
    return `${base}/auth/v1/verify?${params.toString()}`;
}

/**
 * @param {object} args
 * @param {string} args.action - Supabase `email_action_type`.
 * @param {string} args.language - the user's language tag.
 * @param {string} [args.tokenHash] - GoTrue token hash (link actions).
 * @param {string} [args.token] - GoTrue token / 6-digit OTP (reauthentication).
 * @param {string} [args.redirectTo] - Supabase `redirect_to`.
 * @param {string} args.supabaseUrl - project URL (for the verify link).
 * @returns {{ subject: string, html: string, text: string, language: string }}
 */
export function buildAuthEmail({ action, language, tokenHash, token, redirectTo, supabaseUrl } = {}) {
    const normalized = normalizeEmailLanguage(language);
    const lang = normalized && hasAuthEmailCopy(normalized) ? normalized : FALLBACK_LANGUAGE;
    const t = (key) => get(key, lang);

    // Notification emails are informational: no link, no action.
    if (NOTIFICATION_EMAILS[action]) {
        const { subject, body } = NOTIFICATION_EMAILS[action];
        return { subject, language: 'en', html: `<p>${body}</p>`, text: body };
    }

    // Reauthentication carries a 6-digit code, not a link.
    if (action === 'reauthentication') {
        const code = escapeHtml(token || '');
        const html = `<h2>${REAUTH_SUBJECT}</h2><p>${REAUTH_BODY}</p><p style="font-size:24px;font-weight:bold">${code}</p>`;
        return { subject: REAUTH_SUBJECT, language: 'en', html, text: `${REAUTH_SUBJECT}\n\n${REAUTH_BODY}\n\n${token || ''}` };
    }

    const subjectKey = ACTION_SUBJECT_KEYS[action];
    // Only actions with a localized subject use the localized shared copy; the
    // rest stay fully English (the en entries in strings.js) so an email is
    // never half translated.
    const useLocalized = Boolean(subjectKey);
    const subject = useLocalized ? t(subjectKey) : GENERIC_SUBJECT;
    const body = useLocalized ? t('auth_email_body') : get('auth_email_body', 'en');
    const cta = useLocalized ? t('auth_email_cta') : get('auth_email_cta', 'en');
    const ignore = useLocalized ? t('auth_email_ignore') : get('auth_email_ignore', 'en');
    const verifyUrl = tokenHash
        ? buildVerifyUrl({ supabaseUrl, action, tokenHash, redirectTo })
        : '';

    // Mirror the body for RTL languages (Arabic today).
    const dir = useLocalized && isRtlLanguage(lang) ? ' dir="rtl"' : '';
    const html =
        `<div${dir}>` +
        `<p>${body}</p>` +
        (verifyUrl
            ? `<p><a href="${escapeHtml(verifyUrl)}" ` +
              'style="display:inline-block;padding:12px 24px;background:#ffd400;color:#111;' +
              `text-decoration:none;border-radius:6px;font-weight:bold">${cta}</a></p>`
            : '') +
        `<p>${ignore}</p>` +
        '</div>';
    const text = verifyUrl
        ? `${body}\n\n${cta}: ${verifyUrl}\n\n${ignore}`
        : `${body}\n\n${ignore}`;

    return { subject, html, text, language: useLocalized ? lang : 'en' };
}
