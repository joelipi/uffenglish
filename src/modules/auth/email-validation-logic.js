// modules/auth/email-validation-logic.js — zero-cost email screen for signup.
//
// WHY THERE IS NO SMTP LOOKUP HERE
//
// Two hard facts bound what this module can honestly claim:
//
//   1. Cloudflare Workers/Pages cannot open an outbound TCP connection on port
//      25 ("By default, Workers cannot create outbound TCP connections on port
//      25"), so SMTP `RCPT TO` mailbox probing is impossible from
//      functions/**. There is no way to ask a mail server whether one specific
//      mailbox exists — not with a paid API, not at all.
//   2. Even where SMTP is available it does NOT prove existence: catch-all
//      domains accept every local part, and the large providers deliberately
//      hide mailbox existence. The only reliable existence proof is double
//      opt-in — the recipient clicking a link. This repo already does that
//      (functions/api/welcome-email.js mails /confirm-email?token=... and
//      supabase/migrations/006_add_email_confirmation.sql records the result).
//
// So this screen is a PRE-FLIGHT filter for addresses that are certain to
// bounce — malformed, disposable, misspelled, or on a domain with no mail route
// at all. It is a complement to the confirmation click, never a replacement.
//
// WHY IT IS FREE
//
// The only network dependency is Cloudflare's public DNS-over-HTTPS resolver
// (https://cloudflare-dns.com/dns-query), which is keyless, unmetered and bills
// nothing per query. That resolution happens server-side in
// functions/api/email-validate.js. Everything here — normalization, syntax,
// disposable and typo screening — is pure and offline, and needs no API key, no
// account, no dependency and no environment variable.
//
// FAIL-OPEN CONTRACT
//
// This module never throws and fails OPEN: a network error, a non-2xx response
// or an unreadable body all resolve to `{ valid: true }`, so a signup can never
// be lost to a fault in the checker itself. Only a definite server verdict
// blocks. Note this is a third contract, distinct from the two in this repo:
// functions/api/turnstile-verify.js fails CLOSED (a bot gate must not admit
// bots) and functions/api/welcome-email.js fails OPEN (the mail is optional).
//
// Shared with the server: functions/api/email-validate.js imports the pure
// helpers below so the rules are never implemented twice. This file therefore
// has no module-level side effects and no React, DOM or Supabase imports.

export const EMAIL_VALIDATE_PATH = '/api/email-validate';

// A hung Function must never hang a signup, so the client aborts on its own.
export const EMAIL_VALIDATE_TIMEOUT_MS = 5000;

// RFC 5321 section 4.5.3.1 caps a path (local@domain) at 256 octets including
// the angle brackets, i.e. 254 for the address itself. Counted in characters
// rather than UTF-8 octets: an over-long multi-byte address is rejected by the
// syntax rules or by GoTrue anyway, so the exact off-by-a-few cannot matter.
export const MAX_EMAIL_LENGTH = 254;

// The verdict used whenever the check itself could not be completed. It allows
// signup — see the fail-open contract above.
export const LOOKUP_UNAVAILABLE_REASON = 'lookup-unavailable';

const FAIL_OPEN_VERDICT = Object.freeze({
    valid: true,
    reason: LOOKUP_UNAVAILABLE_REASON,
    suggestion: '',
});

/**
 * Trim and lowercase the whole address.
 *
 * Supabase GoTrue lowercases the address it stores, so doing it here keeps the
 * screen, the profile insert and the login lookup agreeing on one identity.
 * Returns '' for non-strings and is idempotent.
 */
export function normalizeEmail(raw) {
    if (typeof raw !== 'string') return '';
    return raw.trim().toLowerCase();
}

/**
 * The lowercased domain after the last '@', or '' when there is no '@'.
 */
export function extractDomain(email) {
    if (typeof email !== 'string') return '';
    const value = email.trim().toLowerCase();
    const at = value.lastIndexOf('@');
    if (at < 0) return '';
    return value.slice(at + 1);
}

/**
 * Local-shape and domain-shape checks over the normalized address.
 *
 * Reason precedence is deliberate, cheapest test first:
 *   empty    -> blank input
 *   too-long -> over the 254-character cap
 *   syntax   -> whitespace, not exactly one '@', or an empty local part
 *   domain   -> a malformed domain label or a non-alphabetic TLD
 *   valid    -> everything else
 *
 * Deliberately permissive about characters we cannot judge offline: there are
 * no local-part dot rules and no domain charset restriction, so
 * user+tag@gmail.com and unicode domains pass. Rejecting a legitimate address
 * costs a real signup, so this function only fails on things that cannot work.
 */
export function validateEmailSyntax(email) {
    const value = normalizeEmail(email);
    if (value.length === 0) return { valid: false, reason: 'empty' };
    if (value.length > MAX_EMAIL_LENGTH) return { valid: false, reason: 'too-long' };

    if (/\s/.test(value)) return { valid: false, reason: 'syntax' };

    const parts = value.split('@');
    if (parts.length !== 2) return { valid: false, reason: 'syntax' };

    const [local, domain] = parts;
    if (local.length === 0) return { valid: false, reason: 'syntax' };

    // A domain must have at least one dot, no empty label (which is what a
    // leading, trailing or doubled dot produces) and an alphabetic TLD.
    const labels = domain.split('.');
    if (labels.length < 2) return { valid: false, reason: 'domain' };
    if (labels.some((label) => label.length === 0)) return { valid: false, reason: 'domain' };
    if (!/^[a-z]{2,}$/.test(labels[labels.length - 1])) return { valid: false, reason: 'domain' };

    return { valid: true, reason: 'ok' };
}

/**
 * Throwaway / temporary-mail providers, matched on the exact normalized domain.
 *
 * Committed and offline on purpose: fetching a blocklist at request time would
 * add a network dependency that can fail, and a check that fails open silently
 * would be pointless. Extend the list by appending a domain — exact matches
 * only, no suffix matching, so a disposable provider's own subdomains are not
 * swept in and real providers on a shared platform (example.com) cannot be
 * caught by accident.
 *
 * NEVER add the reserved example.com / example.org / example.net domains: the
 * existing signup suites use jo@example.com as their identity.
 */
const DISPOSABLE_DOMAINS = new Set([
    '10minutemail.com',
    '20minutemail.com',
    '33mail.com',
    'dispostable.com',
    'getnada.com',
    'guerrillamail.com',
    'guerrillamail.info',
    'guerrillamail.net',
    'maildrop.cc',
    'mailinator.com',
    'mailnesia.com',
    'mintemail.com',
    'mohmal.com',
    'sharklasers.com',
    'spam4.me',
    'temp-mail.org',
    'tempmail.com',
    'throwawaymail.com',
    'trashmail.com',
    'yopmail.com',
    'yopmail.fr',
]);

/**
 * Exact-domain match against the throwaway list. Case-insensitive.
 */
export function isDisposableDomain(domain) {
    if (typeof domain !== 'string') return false;
    const value = domain.trim().toLowerCase();
    if (value.length === 0) return false;
    return DISPOSABLE_DOMAINS.has(value);
}

/**
 * High-confidence misspellings of the big providers, mapped to the real domain.
 *
 * These are addresses that would silently receive mail at a domain the sender
 * does not control, so the user is asked to correct them instead. The map is
 * exact-match and intentionally tiny: a wrong entry here rejects a real
 * signup, so only unambiguous transpositions belong.
 *
 * Two categories must stay out. `googlemail.com` is a genuine Google domain,
 * not a typo. And the ccTLD variants of a provider are real domains too
 * (yahoo.co.uk, yahoo.fr, yahoo.com.br), so a provider is never matched by
 * prefix — only its exact misspellings are.
 */
const DOMAIN_TYPOS = new Map([
    ['gmai.com', 'gmail.com'],
    ['gmial.com', 'gmail.com'],
    ['gmail.co', 'gmail.com'],
    ['gmil.com', 'gmail.com'],
    ['gnail.com', 'gmail.com'],
    ['hotmial.com', 'hotmail.com'],
    ['hotmai.com', 'hotmail.com'],
    ['hotmail.co', 'hotmail.com'],
    ['outlok.com', 'outlook.com'],
    ['outllok.com', 'outlook.com'],
    ['yahho.com', 'yahoo.com'],
    ['yhoo.com', 'yahoo.com'],
]);

/**
 * The corrected domain for a misspelled one, or '' when there is no confident
 * suggestion. Returns '' for every already-correct, legitimate or unknown
 * domain, including the reserved example domains.
 */
export function suggestDomain(domain) {
    if (typeof domain !== 'string') return '';
    const value = domain.trim().toLowerCase();
    if (value.length === 0) return '';
    return DOMAIN_TYPOS.get(value) || '';
}

/**
 * Ask the Pages Function for a verdict on one address.
 *
 * The server is authoritative — a browser-only check is bypassed by posting
 * straight to Supabase — so this is a thin, never-throwing wrapper whose only
 * job is to produce one verdict the signup hook can branch on. It sends the
 * normalized address wrapped in { email }.
 *
 * Fails OPEN: a missing or blocked /api (dev server with no Functions behind
 * the proxy, network down, 500, unreadable body) resolves to
 * `{ valid: true, reason: 'lookup-unavailable' }` rather than throwing, so the
 * caller always gets a verdict and a checker outage can never block signup.
 *
 * `fetchImpl` is injectable so tests never touch the network.
 */
export async function checkEmailAddress(email, { fetchImpl } = {}) {
    const doFetch = typeof fetchImpl === 'function'
        ? fetchImpl
        : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);

    if (!doFetch) {
        console.warn('[EmailCheck] no fetch implementation available — allowing signup');
        return { ...FAIL_OPEN_VERDICT };
    }

    try {
        const res = await doFetch(EMAIL_VALIDATE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: normalizeEmail(email) }),
            signal: AbortSignal.timeout(EMAIL_VALIDATE_TIMEOUT_MS),
        });
        if (!res.ok) {
            console.error(`[EmailCheck] validate endpoint returned ${res.status}`);
            return { ...FAIL_OPEN_VERDICT };
        }
        const data = await res.json();
        if (!data || typeof data.valid !== 'boolean') {
            console.error('[EmailCheck] validate endpoint returned no verdict — allowing signup');
            return { ...FAIL_OPEN_VERDICT };
        }
        return {
            valid: data.valid,
            // An explicit valid:false is a server verdict and is respected even
            // without a reason; 'invalid' lands on the generic copy fallback.
            reason: typeof data.reason === 'string' ? data.reason : (data.valid ? 'ok' : 'invalid'),
            suggestion: typeof data.suggestion === 'string' ? data.suggestion : '',
        };
    } catch (e) {
        console.error('[EmailCheck] validation request failed:', e?.message || e);
        return { ...FAIL_OPEN_VERDICT };
    }
}

// Reason code -> src/data/strings.js key. Several codes deliberately share one
// key: the user does not care whether a malformed address failed the local-shape
// or the domain-shape rule, only that the address cannot work.
const ERROR_KEYS = {
    'empty': 'auth_email_error_required',
    'syntax': 'auth_email_error_invalid',
    'domain': 'auth_email_error_invalid',
    'too-long': 'auth_email_error_invalid',
    'invalid': 'auth_email_error_invalid',
    'bad-request': 'auth_email_error_invalid',
    'disposable': 'auth_email_error_disposable',
    'typo': 'auth_email_error_typo',
    'domain-not-found': 'auth_email_error_no_mail',
    'null-mx': 'auth_email_error_no_mail',
    'no-mail-route': 'auth_email_error_no_mail',
};

export const FALLBACK_EMAIL_ERROR_KEY = 'auth_email_error_invalid';

/**
 * The strings.js key for a reason code, so the hook can hand the view a code
 * and the view resolves the copy (logic owns decisions, display owns language).
 *
 * Codes that never block signup ('ok', 'lookup-unavailable') fall back with the
 * rest, so an unexpected reason renders a sensible message instead of nothing.
 */
export function emailValidationErrorKey(reason) {
    if (typeof reason !== 'string' || reason.length === 0) return FALLBACK_EMAIL_ERROR_KEY;
    return ERROR_KEYS[reason] || FALLBACK_EMAIL_ERROR_KEY;
}