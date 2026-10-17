// The pure half of the zero-cost signup email screen: normalization, syntax,
// disposable/typo screening, the never-throwing client wrapper and the reason
// code -> strings.js key mapping. The DNS half is functions/api/email-validate.test.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
});