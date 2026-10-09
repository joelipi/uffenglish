// modules/user/welcome-email-content.js
// Builds the localized welcome/confirm email. Copy lives in the shared
// translation table (data/strings.js) keyed `email_welcome_*`, so the email
// localizes to every language the app translates and picks up new ones for
// free; unknown codes fall back to English via Strings.get.

import { get, strings } from '../../data/strings.js';
import { normalizeEmailLanguage } from './email-language.js';

const FALLBACK_LANGUAGE = 'en';

/** True when the shared table actually carries copy for this language code. */
function hasEmailCopy(code) {
    return Boolean(strings.email_welcome_subject?.[code]);
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

    // Direction is not inferred: the app's language set is LTR today. If an RTL
    // language (e.g. AR) is added, set dir="rtl" on the wrapper here.
    const html =
        `<h2>${heading}</h2>` +
        `<p>${intro}</p>` +
        `<p><a href="${confirmUrl}" ` +
        'style="display:inline-block;padding:12px 24px;background:#ffd400;color:#111;' +
        `text-decoration:none;border-radius:6px;font-weight:bold">${cta}</a></p>` +
        `<p>${ignore}</p>`;

    const text = `${heading}\n\n${intro}\n\n${cta}: ${confirmUrl}\n\n${ignore}`;

    return { subject, html, text, language };
}
