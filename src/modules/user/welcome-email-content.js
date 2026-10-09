// modules/user/welcome-email-content.js
// Builds the localized welcome/confirm email. Copy lives in the shared
// translation table (data/strings.js) keyed `email_welcome_*`, so the email
// localizes to every language the app translates and picks up new ones for
// free; unknown codes fall back to English via Strings.get.

import { get, strings } from '../../data/strings.js';
import { normalizeEmailLanguage } from './email-language.js';

const FALLBACK_LANGUAGE = 'en';

// Right-to-left languages render the body mirrored. Arabic is in the app's
// language set today; the others are listed so adding one needs no code change.
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

// A language is only "supported" when it carries the whole email — checking the
// subject alone would let a partial translation emit a mixed-language email.
const COPY_KEYS = [
    'email_welcome_subject',
    'email_welcome_heading',
    'email_welcome_intro',
    'email_welcome_cta',
    'email_welcome_ignore',
];

/** True when the shared table carries complete copy for this language code. */
export function hasEmailCopy(code, table = strings) {
    return COPY_KEYS.every((key) => Boolean(table[key]?.[code]));
}

/** Escape a value for use inside an HTML attribute. */
function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

/**
 * @param {string} lang - any language tag; normalized + English-fallback.
 * @param {string} confirmUrl - absolute confirmation link.
 * @returns {{ subject: string, html: string, text: string, language: string }}
 */
export function buildWelcomeEmail(lang, confirmUrl) {
    const normalized = normalizeEmailLanguage(lang);
    // Report the language the copy is actually in, so an unknown-but-valid code
    // (e.g. "xx") resolves to English rather than claiming to be localized.
    const language = normalized && hasEmailCopy(normalized) ? normalized : FALLBACK_LANGUAGE;
    const t = (key) => get(key, language);

    const subject = t('email_welcome_subject');
    const heading = t('email_welcome_heading');
    const intro = t('email_welcome_intro');
    const cta = t('email_welcome_cta');
    const ignore = t('email_welcome_ignore');

    // Mirror the body for RTL languages (Arabic today).
    const dir = RTL_LANGUAGES.has(language) ? ' dir="rtl"' : '';
    const html =
        `<div${dir}>` +
        `<h2>${heading}</h2>` +
        `<p>${intro}</p>` +
        `<p><a href="${escapeHtml(confirmUrl)}" ` +
        'style="display:inline-block;padding:12px 24px;background:#ffd400;color:#111;' +
        `text-decoration:none;border-radius:6px;font-weight:bold">${cta}</a></p>` +
        `<p>${ignore}</p>` +
        '</div>';

    const text = `${heading}\n\n${intro}\n\n${cta}: ${confirmUrl}\n\n${ignore}`;

    return { subject, html, text, language };
}
