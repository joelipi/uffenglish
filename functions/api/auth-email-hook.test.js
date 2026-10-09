// Unit tests for the Supabase Send Email Hook endpoint. The webhook signature
// is produced with node:crypto and `fetch` is stubbed — no real GoTrue/Resend
// call is made.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { onRequestPost } from './auth-email-hook.js';

const SECRET_B64 = 'dGVzdC1zZWNyZXQ=';
const SECRET = `v1,whsec_${SECRET_B64}`;

function makeEnv(overrides = {}) {
    return {
        SEND_EMAIL_HOOK_SECRET: SECRET,
        RESEND_API_KEY: 're_test',
        EMAIL_FROM: 'UFF <welcome@uff.example>',
        SUPABASE_URL: 'https://proj.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
        ...overrides,
    };
}

function signBody(body, timestamp, id = 'msg_1') {
    return `v1,${createHmac('sha256', Buffer.from(SECRET_B64, 'base64'))
        .update(`${id}.${timestamp}.${body}`)
        .digest('base64')}`;
}

function makeRequest(body, { signature, timestamp = Math.floor(Date.now() / 1000), id = 'msg_1' } = {}) {
    const headers = new Map();
    headers.set('webhook-id', id);
    headers.set('webhook-timestamp', String(timestamp));
    headers.set('webhook-signature', signature ?? signBody(body, timestamp, id));
    return {
        headers: { get: (name) => headers.get(name) ?? null },
        text: async () => body,
    };
}

const RECOVERY_PAYLOAD = JSON.stringify({
    user: { id: 'u1', email: 'a@b.com', user_metadata: { native_language: 'ES' } },
    email_data: {
        email_action_type: 'recovery',
        token_hash: 'th-123',
        token: '654321',
        redirect_to: 'https://app.example/reset-password',
    },
});

function installFetch({ profileLanguage = null, resendOk = true } = {}) {
    const calls = [];
    const fetchStub = vi.fn(async (url, options = {}) => {
        calls.push({ url, options });
        if (url.includes('/rest/v1/user_profiles')) {
            return { ok: true, status: 200, json: async () => [{ native_language: profileLanguage }] };
        }
        if (url.includes('api.resend.com/emails')) {
            return { ok: resendOk, status: resendOk ? 200 : 422, json: async () => ({ id: 'e1' }) };
        }
        throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchStub);
    return { calls, fetchStub };
}

const sentEmail = (calls) =>
    JSON.parse(calls.find((c) => c.url.includes('api.resend.com/emails')).options.body);

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('onRequestPost — auth email hook', () => {
    it('rejects a bad signature with 401 and sends nothing', async () => {
        const { fetchStub } = installFetch();
        const res = await onRequestPost({
            request: makeRequest(RECOVERY_PAYLOAD, { signature: 'v1,bm90LWEtc2ln' }),
            env: makeEnv(),
        });
        expect(res.status).toBe(401);
        expect(fetchStub).not.toHaveBeenCalled();
    });

    it('sends a localized password-reset email through Resend', async () => {
        const { calls } = installFetch();
        const res = await onRequestPost({ request: makeRequest(RECOVERY_PAYLOAD), env: makeEnv() });

        expect(res.status).toBe(200);
        const payload = sentEmail(calls);
        expect(payload.to).toEqual(['a@b.com']);
        expect(payload.subject).toBe('Restablece tu contraseña');
        expect(payload.html).toContain('https://proj.supabase.co/auth/v1/verify?token=th-123&amp;type=recovery');
        expect(payload.html).toContain('redirect_to=');
        // The hook never calls GoTrue's user endpoint or leaks the token.
        expect(calls.some((c) => c.url.includes('/auth/v1/user'))).toBe(false);
    });

    it('falls back to the profile language when user_metadata has none', async () => {
        const { calls } = installFetch({ profileLanguage: 'DE' });
        const body = JSON.stringify({
            user: { id: 'u1', email: 'a@b.com', user_metadata: {} },
            email_data: { email_action_type: 'email_change', token_hash: 'th', redirect_to: 'https://app.example/' },
        });
        const res = await onRequestPost({ request: makeRequest(body), env: makeEnv() });

        expect(res.status).toBe(200);
        expect(calls.some((c) => c.url.includes('/rest/v1/user_profiles'))).toBe(true);
        expect(sentEmail(calls).subject).toBe('Bestätige deine neue E-Mail-Adresse');
    });

    it('sends an email-change confirmation to the NEW address', async () => {
        const { calls } = installFetch();
        const body = JSON.stringify({
            user: { id: 'u1', email: 'old@b.com', new_email: 'new@b.com', user_metadata: { native_language: 'EN' } },
            email_data: { email_action_type: 'email_change', token_hash: 'th', redirect_to: 'https://app.example/' },
        });
        const res = await onRequestPost({ request: makeRequest(body), env: makeEnv() });
        expect(res.status).toBe(200);
        expect(sentEmail(calls).to).toEqual(['new@b.com']);
    });

    it('sends two emails for a secure email change (both token pairs)', async () => {
        const { calls } = installFetch();
        const body = JSON.stringify({
            user: { id: 'u1', email: 'old@b.com', new_email: 'new@b.com', user_metadata: { native_language: 'EN' } },
            email_data: {
                email_action_type: 'email_change',
                token_hash: 'hash-new', token: 'code-new',
                token_hash_new: 'hash-cur', token_new: 'code-cur',
                redirect_to: 'https://app.example/',
            },
        });
        const res = await onRequestPost({ request: makeRequest(body), env: makeEnv() });
        expect(res.status).toBe(200);

        const resend = calls.filter((c) => c.url.includes('api.resend.com/emails'));
        expect(resend).toHaveLength(2);
        expect(resend.map((c) => JSON.parse(c.options.body).to)).toEqual([['old@b.com'], ['new@b.com']]);
        // Current address uses token_hash_new; new address uses token_hash.
        expect(JSON.parse(resend[0].options.body).html).toContain('token=hash-cur');
        expect(JSON.parse(resend[1].options.body).html).toContain('token=hash-new');
    });

    it('fails loud (500) when the email provider is not configured', async () => {
        const { fetchStub } = installFetch();
        const res = await onRequestPost({
            request: makeRequest(RECOVERY_PAYLOAD),
            env: makeEnv({ RESEND_API_KEY: undefined }),
        });
        expect(res.status).toBe(500);
        expect(fetchStub).not.toHaveBeenCalled();
    });

    it('returns 502 when Resend rejects the send', async () => {
        installFetch({ resendOk: false });
        const res = await onRequestPost({ request: makeRequest(RECOVERY_PAYLOAD), env: makeEnv() });
        expect(res.status).toBe(502);
    });

    it('rejects a signed but non-JSON or incomplete payload with 400', async () => {
        installFetch();
        const notJson = 'not json';
        const bad1 = await onRequestPost({ request: makeRequest(notJson), env: makeEnv() });
        expect(bad1.status).toBe(400);

        const incomplete = JSON.stringify({ user: { email: 'a@b.com' } });
        const bad2 = await onRequestPost({ request: makeRequest(incomplete), env: makeEnv() });
        expect(bad2.status).toBe(400);
    });
});
