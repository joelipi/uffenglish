// Unit tests for the standardwebhooks signature verifier. Signatures are
// produced with node:crypto (independent of the WebCrypto verifier) so the test
// cannot pass by sharing the implementation under test.
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyStandardWebhook, parseWebhookSecret } from './standard-webhook.js';

const SECRET_B64 = 'dGVzdC1zZWNyZXQ='; // "test-secret"
const SECRET = `v1,whsec_${SECRET_B64}`;
const ID = 'msg_2abc';
const TIMESTAMP = 1700000000;
const BODY = JSON.stringify({ user: { id: 'u1' }, email_data: { email_action_type: 'recovery' } });
const NOW = TIMESTAMP;

function sign({ id = ID, timestamp = TIMESTAMP, body = BODY, secretB64 = SECRET_B64 } = {}) {
    return createHmac('sha256', Buffer.from(secretB64, 'base64'))
        .update(`${id}.${timestamp}.${body}`)
        .digest('base64');
}

describe('parseWebhookSecret', () => {
    it('strips the v1, and whsec_ prefixes (in either combination)', () => {
        expect(parseWebhookSecret('v1,whsec_abc')).toBe('abc');
        expect(parseWebhookSecret('whsec_abc')).toBe('abc');
        expect(parseWebhookSecret('abc')).toBe('abc');
    });
});

describe('verifyStandardWebhook', () => {
    it('accepts a correctly signed, fresh payload', async () => {
        const signature = `v1,${sign()}`;
        await expect(
            verifyStandardWebhook({ secret: SECRET, id: ID, timestamp: TIMESTAMP, signature, body: BODY, now: NOW })
        ).resolves.toBe(true);
    });

    it('accepts a good signature listed after a bad one', async () => {
        const signature = `v1,bm90LWEtc2ln v1,${sign()}`;
        await expect(
            verifyStandardWebhook({ secret: SECRET, id: ID, timestamp: TIMESTAMP, signature, body: BODY, now: NOW })
        ).resolves.toBe(true);
    });

    it('rejects a tampered body, wrong secret, or bad version', async () => {
        const good = sign();
        await expect(
            verifyStandardWebhook({ secret: SECRET, id: ID, timestamp: TIMESTAMP, signature: `v1,${good}`, body: BODY + 'x', now: NOW })
        ).resolves.toBe(false);
        await expect(
            verifyStandardWebhook({ secret: 'v1,whsec_' + Buffer.from('other').toString('base64'), id: ID, timestamp: TIMESTAMP, signature: `v1,${good}`, body: BODY, now: NOW })
        ).resolves.toBe(false);
        await expect(
            verifyStandardWebhook({ secret: SECRET, id: ID, timestamp: TIMESTAMP, signature: `v2,${good}`, body: BODY, now: NOW })
        ).resolves.toBe(false);
    });

    it('rejects a stale timestamp (replay)', async () => {
        const signature = `v1,${sign()}`;
        await expect(
            verifyStandardWebhook({ secret: SECRET, id: ID, timestamp: TIMESTAMP, signature, body: BODY, now: TIMESTAMP + 3600 })
        ).resolves.toBe(false);
    });

    it('rejects missing fields and malformed input without throwing', async () => {
        for (const args of [
            {},
            { secret: SECRET },
            { secret: SECRET, id: ID, timestamp: TIMESTAMP, signature: `v1,${sign()}`, body: null },
            { secret: SECRET, id: ID, timestamp: 'nope', signature: `v1,${sign()}`, body: BODY, now: NOW },
            { secret: 'v1,whsec_!!!notbase64', id: ID, timestamp: TIMESTAMP, signature: 'v1,x', body: BODY, now: NOW },
        ]) {
            await expect(verifyStandardWebhook(args)).resolves.toBe(false);
        }
    });
});
