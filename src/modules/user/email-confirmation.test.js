import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getAccessTokenMock, rpcMock } = vi.hoisted(() => ({
    getAccessTokenMock: vi.fn(),
    rpcMock: vi.fn(),
}));

vi.mock('../api/supabase.js', () => ({
    getAccessToken: getAccessTokenMock,
    supabase: { rpc: rpcMock },
}));

import {
    isValidConfirmToken,
    hashConfirmToken,
    sendWelcomeEmail,
    confirmEmailToken,
} from './email-confirmation.js';
import { sha256Hex, isConfirmToken } from '../../../functions/api/welcome-email.js';

const HEX_64 = 'a'.repeat(64);

beforeEach(() => {
    getAccessTokenMock.mockReset();
    rpcMock.mockReset();
});

describe('isValidConfirmToken', () => {
    it('accepts only 64-char lowercase hex', () => {
        expect(isValidConfirmToken(HEX_64)).toBe(true);
        expect(isValidConfirmToken('ABC')).toBe(false);
        expect(isValidConfirmToken('A'.repeat(64))).toBe(false);
        expect(isValidConfirmToken('')).toBe(false);
        expect(isValidConfirmToken(null)).toBe(false);
        expect(isValidConfirmToken(123)).toBe(false);
    });
});

describe('hashConfirmToken', () => {
    it('returns a stable 64-char lowercase hex SHA-256', async () => {
        const hash = await hashConfirmToken(HEX_64);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(await hashConfirmToken(HEX_64)).toBe(hash);
        expect(hash).not.toBe(await hashConfirmToken('b'.repeat(64)));
    });

    // The client hashes the token and the Pages Function hashes it when
    // storing; if those two canonicalizations ever drift, every confirm link
    // silently fails. Pin them to the same output for fixed inputs.
    it('matches the Pages Function SHA-256 for fixed inputs', async () => {
        for (const input of ['', 'abc', HEX_64, 'token-with-ünicode-✓']) {
            expect(await hashConfirmToken(input)).toBe(await sha256Hex(input));
        }
    });

    it('agrees with the Pages Function on which tokens are well-formed', () => {
        for (const value of [HEX_64, '', 'ABC', 'A'.repeat(64), 'f'.repeat(63), 'f'.repeat(65), null]) {
            expect(isValidConfirmToken(value)).toBe(isConfirmToken(value));
        }
    });
});

describe('sendWelcomeEmail', () => {
    it('reports no-session without calling the endpoint when there is no access token', async () => {
        getAccessTokenMock.mockResolvedValue(null);
        const fetchImpl = vi.fn();
        await expect(sendWelcomeEmail({ fetchImpl })).resolves.toEqual({ sent: false, reason: 'no-session' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('posts the bearer token and reports the provider result', async () => {
        getAccessTokenMock.mockResolvedValue('jwt-1');
        const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sent: true }) });
        await expect(sendWelcomeEmail({ fetchImpl })).resolves.toEqual({ sent: true, reason: undefined });
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe('/api/welcome-email');
        expect(options.method).toBe('POST');
        expect(options.headers.Authorization).toBe('Bearer jwt-1');
    });

    it('never throws: a non-2xx response and a thrown fetch both resolve', async () => {
        getAccessTokenMock.mockResolvedValue('jwt-1');
        await expect(sendWelcomeEmail({ fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 502 }) }))
            .resolves.toEqual({ sent: false, reason: 'http-502' });
        await expect(sendWelcomeEmail({ fetchImpl: vi.fn().mockRejectedValue(new Error('offline')) }))
            .resolves.toEqual({ sent: false, reason: 'offline' });
    });
});

describe('confirmEmailToken', () => {
    it('rejects a malformed token without calling the RPC', async () => {
        await expect(confirmEmailToken('nope')).resolves.toBe(false);
        expect(rpcMock).not.toHaveBeenCalled();
    });

    it('passes the SHA-256 hash to confirm_email_hash and returns true only on true', async () => {
        rpcMock.mockResolvedValue({ data: true, error: null });
        await expect(confirmEmailToken(HEX_64)).resolves.toBe(true);
        const [fn, args] = rpcMock.mock.calls[0];
        expect(fn).toBe('confirm_email_hash');
        expect(args.p_hash).toBe(await hashConfirmToken(HEX_64));

        rpcMock.mockResolvedValue({ data: false, error: null });
        await expect(confirmEmailToken(HEX_64)).resolves.toBe(false);
    });

    it('never throws: an RPC error or rejection resolves false', async () => {
        rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
        await expect(confirmEmailToken(HEX_64)).resolves.toBe(false);
        rpcMock.mockRejectedValue(new Error('network'));
        await expect(confirmEmailToken(HEX_64)).resolves.toBe(false);
    });
});
