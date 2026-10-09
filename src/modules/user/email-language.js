// modules/user/email-language.js
// Language resolution for the transactional welcome email. Reuses the app's
// canonical normalizeLanguageCode (modules/utils/utils.js) so the email and the
// UI agree on codes, and adds the one case the shared helper can't express: the
// app surfaces Simplified Chinese as ZH, but for a `zh-TW`/`zh-Hant`/`zh-HK`
// caller we keep non-simplified (Traditional) Chinese distinct as TW instead of
// letting normalizeLanguageCode collapse it to "zh".
//
// Codes are the app's lowercase primary subtags; the email copy itself lives in
// the shared translation table (strings.js), so any language added there is
// picked up automatically and an unknown code falls back to English.

import { normalizeLanguageCode } from '../utils/utils.js';

const TRADITIONAL_ZH_SIGNALS = new Set(['tw', 'hk', 'mo', 'hant']);
const TWO_LETTER = /^[a-z]{2}$/;

function subtags(raw) {
    // Split on '-' only, matching the shared normalizeLanguageCode / Strings.get
    // convention (a POSIX '_' tag is not localized by the UI either, so the
    // email must not accept more than the app does).
    return raw.split('-').filter(Boolean).map((part) => part.toLowerCase());
}

/**
 * Normalize an arbitrary language tag to the app's lowercase two-letter code,
 * keeping Traditional Chinese (TW) distinct from Simplified (ZH). Returns null
 * for input that is not a usable two-letter language code.
 */
export function normalizeEmailLanguage(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const parts = subtags(raw.trim());
    if (parts.length === 0) return null;

    const primary = normalizeLanguageCode(parts[0]);
    if (primary === 'zh') {
        return parts.slice(1).some((part) => TRADITIONAL_ZH_SIGNALS.has(part)) ? 'tw' : 'zh';
    }
    return TWO_LETTER.test(primary) ? primary : null;
}

/**
 * Pick the highest-priority usable language from an Accept-Language header
 * ("es-ES,es;q=0.9,en;q=0.8" -> "es"). Returns null when there is none.
 */
export function parseAcceptLanguage(header) {
    if (typeof header !== 'string' || !header.trim()) return null;

    const ranked = header
        .split(',')
        .map((entry) => {
            const [tag, ...params] = entry.trim().split(';');
            const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
            const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
            return { tag: (tag || '').trim(), q: Number.isFinite(q) ? q : 0 };
        })
        .filter(({ tag, q }) => tag && tag !== '*' && q > 0)
        .sort((a, b) => b.q - a.q);

    for (const { tag } of ranked) {
        const code = normalizeEmailLanguage(tag);
        if (code) return code;
    }
    return null;
}

/**
 * Resolve the email language: the learner's stored native language wins, then
 * the request's Accept-Language, then English.
 */
export function resolveEmailLanguage({ nativeLanguage, acceptLanguage } = {}) {
    return (
        normalizeEmailLanguage(nativeLanguage) ||
        parseAcceptLanguage(acceptLanguage) ||
        'en'
    );
}
