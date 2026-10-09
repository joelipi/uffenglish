// modules/user/email-language.js
// Pure language resolution for the transactional welcome email. Kept free of
// strings.js / browser imports so it is cheap to import in the Pages Function
// and unit-testable in isolation.
//
// Language codes are the app's two-letter uppercase codes (languages.js). The
// resolver accepts ANY such code — the email copy itself is looked up in the
// shared translation table (strings.js), so adding a language there localizes
// the email too, and an unknown code falls back to English.

// BCP-47 / POSIX separators: "zh-TW", "zh_Hant", "es-419".
const SEPARATORS = /[-_]/;
const TWO_LETTER = /^[a-z]{2}$/;

// Chinese is special-cased: the app uses TW for non-simplified (Traditional)
// Chinese and ZH for Simplified. A full tag carrying a Traditional signal
// (region TW/HK/MO, or script Hant) maps to TW; every other zh tag maps to ZH.
const TRADITIONAL_ZH_SIGNALS = new Set(['tw', 'hk', 'mo', 'hant']);

/**
 * Normalize an arbitrary language tag to the app's two-letter code.
 * Returns null for anything that is not a usable two-letter language code.
 */
export function normalizeLanguageCode(raw) {
    if (typeof raw !== 'string') return null;
    const tag = raw.trim();
    if (!tag) return null;

    const parts = tag.split(SEPARATORS).filter(Boolean);
    if (parts.length === 0) return null;
    const primary = parts[0].toLowerCase();
    const rest = parts.slice(1).map((part) => part.toLowerCase());

    if (primary === 'zh') {
        return rest.some((part) => TRADITIONAL_ZH_SIGNALS.has(part)) ? 'TW' : 'ZH';
    }
    if (!TWO_LETTER.test(primary)) return null;
    return primary.toUpperCase();
}

/**
 * Pick the highest-priority usable language from an Accept-Language header
 * ("es-ES,es;q=0.9,en;q=0.8" -> "ES"). Returns null when there is none.
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
        const code = normalizeLanguageCode(tag);
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
        normalizeLanguageCode(nativeLanguage) ||
        parseAcceptLanguage(acceptLanguage) ||
        'EN'
    );
}
