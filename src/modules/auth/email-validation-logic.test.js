// The pure half of the zero-cost signup email screen: normalization, syntax,
// disposable/typo screening, the never-throwing client wrapper and the reason
// code -> strings.js key mapping. The DNS half is functions/api/email-validate.test.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    EMAIL_VALIDATE_PATH,
    EMAIL_VALIDATE_TIMEOUT_MS,
    MAX_EMAIL_LENGTH,
    LOOKUP_UNAVAILABLE_REASON,
    FALLBACK_EMAIL_ERROR_KEY,
    normalizeEmail,
    extractDomain,
    validateEmailSyntax,
    isDisposableDomain,
    suggestDomain,
    checkEmailAddress,
    emailValidationErrorKey,
} from './email-validation-logic.js';

import { strings } from '../../data/strings.js';

// Raw source, read once: several guards below assert on its exact text.
const SOURCE = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'email-validation-logic.js'),
    'utf8',
);

let warnSpy;
let errorSpy;

beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** A fetch double returning a JSON body with the given status. */
function jsonFetch(body, { ok = true, status = 200 } = {}) {
    return vi.fn(async () => ({ ok, status, json: async () => body }));
}

/**
 * Blank out comments while preserving every offset, so an index found in the
 * stripped text still points at the same character in the original. Quote-aware
 * so a "//" inside a string is not mistaken for a comment.
 */
function stripComments(src) {
    let out = '';
    let i = 0;
    let quote = null;
    while (i < src.length) {
        const ch = src[i];
        if (quote) {
            out += ch;
            if (ch === '\\') { out += src[i + 1] ?? ''; i += 2; continue; }
            if (ch === quote) quote = null;
            i += 1;
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') { quote = ch; out += ch; i += 1; continue; }
        if (ch === '/' && src[i + 1] === '/') {
            let end = src.indexOf('\n', i);
            if (end === -1) end = src.length;
            out += ' '.repeat(end - i);
            i = end;
            continue;
        }
        if (ch === '/' && src[i + 1] === '*') {
            const close = src.indexOf('*/', i + 2);
            const end = close === -1 ? src.length : close + 2;
            out += src.slice(i, end).replace(/[^\n]/g, ' ');
            i = end;
            continue;
        }
        out += ch;
        i += 1;
    }
    return out;
}

const CODE = stripComments(SOURCE);

describe('module surface and purity', () => {
    it('exports every documented name', () => {
        expect(EMAIL_VALIDATE_PATH).toBe('/api/email-validate');
        expect(EMAIL_VALIDATE_TIMEOUT_MS).toBe(5000);
        expect(MAX_EMAIL_LENGTH).toBe(254);
        expect(LOOKUP_UNAVAILABLE_REASON).toBe('lookup-unavailable');
        for (const fn of [normalizeEmail, extractDomain, validateEmailSyntax, isDisposableDomain,
            suggestDomain, checkEmailAddress, emailValidationErrorKey]) {
            expect(typeof fn).toBe('function');
        }
    });

    // The Functions bundle imports this module, so it has to stay loadable
    // outside a browser and free of any framework. Asserted on RAW source: the
    // header comment discusses React, the DOM and Supabase by name, so a naive
    // toContain over the whole file could never fail.
    it('imports no framework, DOM or Supabase', () => {
        const imports = [...SOURCE.matchAll(/^\s*import\s.*?from\s+['"]([^'"]+)['"]/gm)]
            .map((m) => m[1]);
        expect(imports, 'the module should have no imports at all').toEqual([]);
    });

    it('references no bare browser or Supabase global in executable code', () => {
        for (const banned of ['window', 'document', 'navigator', 'React', 'useState', 'supabase']) {
            expect(CODE, `bare "${banned}" must not appear in executable code`)
                .not.toMatch(new RegExp(`\\b${banned}\\b`));
        }
    });

    it('reads fetch only inside checkEmailAddress', () => {
        const start = SOURCE.indexOf('export async function checkEmailAddress(');
        const end = SOURCE.indexOf('\nexport function emailValidationErrorKey(');
        expect(start, 'checkEmailAddress not found').toBeGreaterThan(-1);
        expect(end, 'end boundary not found').toBeGreaterThan(start);

        // \b boundaries keep doFetch and fetchImpl out of the count.
        const refs = [...CODE.matchAll(/\bfetch\b/g)].map((m) => m.index);
        expect(refs.length, 'no fetch reference found — the guard would be vacuous')
            .toBeGreaterThan(0);
        for (const at of refs) {
            expect(at, 'fetch is referenced outside checkEmailAddress')
                .toBeGreaterThanOrEqual(start);
            expect(at, 'fetch is referenced outside checkEmailAddress').toBeLessThan(end);
        }
    });

    it('has no module-level side effects', () => {
        // Only column-0 lines are top level; anything indented is inside a
        // declaration. A bare call at column 0 would execute on import, which
        // the Functions bundle must never do.
        const topLevel = CODE.split('\n').filter((l) => l.length > 0 && !/^\s/.test(l));
        expect(topLevel.length, 'the slice looks wrong — guard would be vacuous')
            .toBeGreaterThan(5);
        const allowed = /^(export\s+)?(default\s+)?(async\s+)?function\b|^(export\s+)?(const|let|var)\b|^import\b|^[)\]}]/;
        for (const line of topLevel) {
            expect(line, `possible module-level side effect: ${line.trim()}`)
                .toMatch(allowed);
        }
    });
});

describe('normalizeEmail', () => {
    it('trims and lowercases the local part and the domain', () => {
        expect(normalizeEmail('  Jo @Example.COM ')).toBe('jo @example.com');
        expect(normalizeEmail('JO@EXAMPLE.COM')).toBe('jo@example.com');
    });

    it('returns an empty string for non-strings and blank input', () => {
        expect(normalizeEmail(null)).toBe('');
        expect(normalizeEmail(undefined)).toBe('');
        expect(normalizeEmail(42)).toBe('');
        expect(normalizeEmail({})).toBe('');
        expect(normalizeEmail('   ')).toBe('');
    });

    it('is idempotent', () => {
        const once = normalizeEmail('  Jo@Example.COM ');
        expect(normalizeEmail(once)).toBe(once);
    });
});

describe('extractDomain', () => {
    it('returns the lowercased domain after the last @', () => {
        expect(extractDomain('Jo@Example.COM')).toBe('example.com');
        expect(extractDomain('a.b@sub.example.co.uk')).toBe('sub.example.co.uk');
    });

    it('returns an empty string when there is no @ or the input is not a string', () => {
        expect(extractDomain('jo')).toBe('');
        expect(extractDomain('')).toBe('');
        expect(extractDomain(null)).toBe('');
        expect(extractDomain(7)).toBe('');
    });
});

describe('validateEmailSyntax', () => {
    const reasonOf = (value) => validateEmailSyntax(value).reason;

    it('reports empty for blank input', () => {
        expect(reasonOf('')).toBe('empty');
        expect(reasonOf('   ')).toBe('empty');
        expect(reasonOf(null)).toBe('empty');
        expect(validateEmailSyntax('').valid).toBe(false);
    });

    it('reports too-long past the 254-character cap', () => {
        const domain = '@example.com';
        const over = `${'a'.repeat(MAX_EMAIL_LENGTH - domain.length + 1)}${domain}`;
        expect(over.length).toBe(MAX_EMAIL_LENGTH + 1);
        expect(reasonOf(over)).toBe('too-long');
    });

    it('reports syntax for whitespace, a wrong @ count or an empty local part', () => {
        expect(reasonOf('jo')).toBe('syntax');
        expect(reasonOf('jo@@example.com')).toBe('syntax');
        expect(reasonOf('jo k@example.com')).toBe('syntax');
        expect(reasonOf('@example.com')).toBe('syntax');
        expect(reasonOf('jo@example.com extra')).toBe('syntax');
    });

    it('reports domain for a malformed domain or a non-alphabetic TLD', () => {
        expect(reasonOf('jo@example')).toBe('domain');
        expect(reasonOf('jo@.example.com')).toBe('domain');
        expect(reasonOf('jo@example..com')).toBe('domain');
        expect(reasonOf('jo@example.com.')).toBe('domain');
        expect(reasonOf('jo@example.c0m')).toBe('domain');
        expect(reasonOf('jo@example.123')).toBe('domain');
    });

    it('accepts punycode TLDs, which is how IDN domains arrive in ASCII form', () => {
        // .xn--p1ai is .рф and .xn--fiqs8s is .中国. These deliver normally;
        // rejecting them would be a deterministic false rejection of a working
        // signup.
        expect(validateEmailSyntax('jo@example.xn--p1ai')).toEqual({ valid: true, reason: 'ok' });
        expect(validateEmailSyntax('jo@example.xn--fiqs8s')).toEqual({ valid: true, reason: 'ok' });
        expect(validateEmailSyntax('jo@sub.example.xn--p1ai')).toEqual({ valid: true, reason: 'ok' });
    });

    it('still rejects a TLD that is neither alphabetic nor punycode', () => {
        expect(reasonOf('jo@example.c0m')).toBe('domain');
        expect(reasonOf('jo@example.123')).toBe('domain');
        expect(reasonOf('jo@example.-')).toBe('domain');
        expect(reasonOf('jo@example.xn-')).toBe('domain');
        expect(reasonOf('jo@example.xn--')).toBe('domain');
    });

    it('accepts the addresses this app and its suites actually use', () => {
        expect(validateEmailSyntax('jo@example.com')).toEqual({ valid: true, reason: 'ok' });
        expect(validateEmailSyntax('jo@example.edu')).toEqual({ valid: true, reason: 'ok' });
        expect(validateEmailSyntax('user+tag@gmail.com')).toEqual({ valid: true, reason: 'ok' });
        expect(validateEmailSyntax('first.last@sub.example.co.uk')).toEqual({ valid: true, reason: 'ok' });
        expect(validateEmailSyntax('JO@EXAMPLE.COM').valid).toBe(true);
    });
});

describe('isDisposableDomain', () => {
    it('flags the seeded throwaway providers, case-insensitively', () => {
        expect(isDisposableDomain('mailinator.com')).toBe(true);
        expect(isDisposableDomain('MAILINATOR.COM')).toBe(true);
        expect(isDisposableDomain('guerrillamail.com')).toBe(true);
        expect(isDisposableDomain('yopmail.com')).toBe(true);
        expect(isDisposableDomain('10minutemail.com')).toBe(true);
    });

    it('never flags real providers', () => {
        expect(isDisposableDomain('gmail.com')).toBe(false);
        expect(isDisposableDomain('outlook.com')).toBe(false);
        expect(isDisposableDomain('kernel.org')).toBe(false);
    });

    it('never flags the reserved example domains the signup suites sign up with', () => {
        expect(isDisposableDomain('example.com')).toBe(false);
        expect(isDisposableDomain('example.org')).toBe(false);
        expect(isDisposableDomain('example.net')).toBe(false);
    });

    it('returns false for blank and non-string input', () => {
        expect(isDisposableDomain('')).toBe(false);
        expect(isDisposableDomain(null)).toBe(false);
        expect(isDisposableDomain(3)).toBe(false);
    });

    it('matches the exact domain only, never a suffix of it', () => {
        // A real provider must not be caught because a throwaway domain happens
        // to end with the same characters.
        expect(isDisposableDomain('notmailinator.com')).toBe(false);
        expect(isDisposableDomain('mailinator.com.evil.test')).toBe(false);
    });

    it('keeps the blocklist an offline Set in the source, never fetched', () => {
        // Behavioural tests cannot tell a committed Set from any other
        // structure, and the list must never be fetched at request time: a
        // blocklist lookup that fails open would be worse than no check.
        expect(SOURCE).toMatch(/DISPOSABLE_DOMAINS\s*=\s*new Set\(\[/);
        expect(SOURCE).not.toMatch(/DISPOSABLE_DOMAINS\s*=\s*await/);
        // The Set is populated inline, so it is a literal rather than a fetch.
        const block = SOURCE.slice(
            SOURCE.indexOf('const DISPOSABLE_DOMAINS'),
            SOURCE.indexOf('];', SOURCE.indexOf('const DISPOSABLE_DOMAINS')));
        expect(block.split('\n').filter((l) => l.includes("'")).length)
            .toBeGreaterThan(10);
    });
});

describe('suggestDomain', () => {
    it('suggests the real domain for each seeded typo', () => {
        expect(suggestDomain('gmial.com')).toBe('gmail.com');
        expect(suggestDomain('gmai.com')).toBe('gmail.com');
        expect(suggestDomain('gnail.com')).toBe('gmail.com');
        expect(suggestDomain('hotmial.com')).toBe('hotmail.com');
        expect(suggestDomain('outlok.com')).toBe('outlook.com');
        expect(suggestDomain('yahho.com')).toBe('yahoo.com');
    });

    it('returns an empty string for every correct, legitimate or unknown domain', () => {
        expect(suggestDomain('gmail.com')).toBe('');
        expect(suggestDomain('kernel.org')).toBe('');
        expect(suggestDomain('example.com')).toBe('');
    });

    it('never treats googlemail.com as a typo — it is a real Google domain', () => {
        expect(suggestDomain('googlemail.com')).toBe('');
    });

    it('never treats a provider ccTLD as a typo', () => {
        expect(suggestDomain('yahoo.co.uk')).toBe('');
        expect(suggestDomain('yahoo.fr')).toBe('');
        expect(suggestDomain('yahoo.com.br')).toBe('');
        expect(suggestDomain('yahoo.co.jp')).toBe('');
    });

    it('returns an empty string for blank and non-string input', () => {
        expect(suggestDomain('')).toBe('');
        expect(suggestDomain(null)).toBe('');
    });
});

describe('checkEmailAddress', () => {
    it('POSTs the normalized address to the validate endpoint with an abort signal', async () => {
        const fetchImpl = jsonFetch({ valid: true, reason: 'ok', suggestion: '' });
        const verdict = await checkEmailAddress('  Jo@Example.COM ', { fetchImpl });

        expect(verdict).toEqual({ valid: true, reason: 'ok', suggestion: '' });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe(EMAIL_VALIDATE_PATH);
        expect(init.method).toBe('POST');
        expect(init.headers['content-type']).toBe('application/json');
        expect(JSON.parse(init.body)).toEqual({ email: 'jo@example.com' });
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('passes a server rejection through unchanged', async () => {
        const fetchImpl = jsonFetch({ valid: false, reason: 'typo', suggestion: 'gmail.com' });
        const verdict = await checkEmailAddress('jo@gmial.com', { fetchImpl });

        expect(verdict).toEqual({ valid: false, reason: 'typo', suggestion: 'gmail.com' });
    });

    it('keeps an explicit rejection that carries no reason, using the generic code', async () => {
        const fetchImpl = jsonFetch({ valid: false });
        expect(await checkEmailAddress('jo@example.com', { fetchImpl }))
            .toEqual({ valid: false, reason: 'invalid', suggestion: '' });
    });

    describe('fails open so a checker fault can never block a signup', () => {
        const failOpen = { valid: true, reason: LOOKUP_UNAVAILABLE_REASON, suggestion: '' };

        it('when the request throws', async () => {
            const fetchImpl = vi.fn(async () => { throw new Error('network down'); });
            await expect(checkEmailAddress('jo@example.com', { fetchImpl })).resolves.toEqual(failOpen);
            expect(errorSpy).toHaveBeenCalled();
        });

        it('when the endpoint returns 500', async () => {
            const fetchImpl = jsonFetch({ valid: false }, { ok: false, status: 500 });
            await expect(checkEmailAddress('jo@example.com', { fetchImpl })).resolves.toEqual(failOpen);
            expect(errorSpy).toHaveBeenCalled();
        });

        it('when the body is not JSON', async () => {
            const fetchImpl = vi.fn(async () => ({
                ok: true,
                status: 200,
                json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
            }));
            await expect(checkEmailAddress('jo@example.com', { fetchImpl })).resolves.toEqual(failOpen);
        });

        it('when the body carries no verdict at all', async () => {
            const fetchImpl = jsonFetch({ nope: true });
            await expect(checkEmailAddress('jo@example.com', { fetchImpl })).resolves.toEqual(failOpen);
        });

        it('when there is no fetch implementation at all', async () => {
            const original = globalThis.fetch;
            // eslint-disable-next-line no-global-assign
            globalThis.fetch = undefined;
            try {
                await expect(checkEmailAddress('jo@example.com')).resolves.toEqual(failOpen);
            } finally {
                globalThis.fetch = original;
            }
        });
    });
});

describe('emailValidationErrorKey', () => {
    it('maps each blockable reason to its documented key', () => {
        expect(emailValidationErrorKey('empty')).toBe('auth_email_error_required');
        expect(emailValidationErrorKey('syntax')).toBe('auth_email_error_invalid');
        expect(emailValidationErrorKey('domain')).toBe('auth_email_error_invalid');
        expect(emailValidationErrorKey('too-long')).toBe('auth_email_error_invalid');
        expect(emailValidationErrorKey('bad-request')).toBe('auth_email_error_invalid');
        expect(emailValidationErrorKey('disposable')).toBe('auth_email_error_disposable');
        expect(emailValidationErrorKey('typo')).toBe('auth_email_error_typo');
        expect(emailValidationErrorKey('domain-not-found')).toBe('auth_email_error_no_mail');
        expect(emailValidationErrorKey('null-mx')).toBe('auth_email_error_no_mail');
        expect(emailValidationErrorKey('no-mail-route')).toBe('auth_email_error_no_mail');
    });

    it('falls back for reasons that never block, and for anything unexpected', () => {
        expect(emailValidationErrorKey('ok')).toBe(FALLBACK_EMAIL_ERROR_KEY);
        expect(emailValidationErrorKey(LOOKUP_UNAVAILABLE_REASON)).toBe(FALLBACK_EMAIL_ERROR_KEY);
        expect(emailValidationErrorKey('who-knows')).toBe(FALLBACK_EMAIL_ERROR_KEY);
        expect(emailValidationErrorKey('')).toBe(FALLBACK_EMAIL_ERROR_KEY);
        expect(emailValidationErrorKey(undefined)).toBe(FALLBACK_EMAIL_ERROR_KEY);
    });

    it('only ever returns a key that exists in the raw strings table', () => {
        // Assert the raw table, not Strings.get(): get() falls back to the
        // English value for a missing locale, so a dropped translation would
        // still pass and the guard could never fail.
        const reasons = ['empty', 'syntax', 'domain', 'too-long', 'invalid', 'bad-request',
            'disposable', 'typo', 'domain-not-found', 'null-mx', 'no-mail-route',
            'ok', LOOKUP_UNAVAILABLE_REASON, 'who-knows'];
        for (const reason of reasons) {
            const key = emailValidationErrorKey(reason);
            expect(strings[key], `missing strings entry ${key} for reason ${reason}`).toBeDefined();
            for (const lang of ['en', 'es', 'pt', 'fr', 'hi', 'bn']) {
                expect(strings[key][lang], `${key}.${lang} is empty`).toBeTruthy();
            }
        }
    });

    it('gives every new signup-screen key real copy in all six locales', () => {
        // The generic hi/bn script sweep in strings.test.js would not catch a
        // dropped es/pt/fr, so assert the raw table for these five keys.
        const keys = ['auth_email_error_required', 'auth_email_error_invalid',
            'auth_email_error_disposable', 'auth_email_error_typo', 'auth_email_error_no_mail'];
        for (const key of keys) {
            expect(strings[key], `${key} is not in the table`).toBeDefined();
            for (const lang of ['en', 'es', 'pt', 'fr', 'hi', 'bn']) {
                const value = strings[key][lang];
                expect(typeof value, `${key}.${lang} is not a string`).toBe('string');
                expect(value.trim().length, `${key}.${lang} is empty`).toBeGreaterThan(0);
            }
            // A locale that silently fell back to English would defeat the point.
            expect(strings[key].es).not.toBe(strings[key].en);
            expect(strings[key].pt).not.toBe(strings[key].en);
            expect(strings[key].fr).not.toBe(strings[key].en);
        }
    });

    it('keeps {suggestion} in every locale of the typo message', () => {
        // Dropping the token from one translation would render "did you mean ?".
        for (const lang of ['en', 'es', 'pt', 'fr', 'hi', 'bn']) {
            expect(strings.auth_email_error_typo[lang], `typo.${lang} lost the placeholder`)
                .toContain('{suggestion}');
        }
    });
});
