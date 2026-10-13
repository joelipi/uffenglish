// @vitest-environment node
// Node, not jsdom: this is a server-side Function, and the Web Push library
// (buildPushPayload) does a cross-realm `instanceof ArrayBuffer` check on what
// crypto.subtle returns. Under jsdom that value comes from jsdom's realm, so the
// check fails and every send reports "Unsupported value, got `object`" — an
// environment artifact, not a production bug (workerd has a single realm).
// Unit tests for /api/push/send. `fetch` is stubbed — no real PostgREST call and
// no real push service is contacted. Pins the fail-open contract (a push problem
// must never surface to the friend who just exported a video) and the 401-only
// error surface for the database webhook.
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { createECDH, randomBytes } from 'node:crypto';
import {
    onRequestPost,
    requireWebhookSecret,
    parseNotificationRecord,
    MAX_SUBSCRIPTIONS_PER_SEND,
    PUSH_TTL_SECONDS,
} from './send.js';

const SECRET = 'webhook-secret-abc';
let vapidPrivateKey;
let vapidPublicKey;
// A real receiver keypair: buildPushPayload decodes p256dh/auth, so placeholder
// strings would fail encryption rather than exercise the send path.
let receiverP256dh;
let receiverAuth;

beforeAll(() => {
    const vapid = createECDH('prime256v1');
    vapid.generateKeys();
    vapidPublicKey = vapid.getPublicKey(null, 'uncompressed').toString('base64url');
    vapidPrivateKey = vapid.getPrivateKey().toString('base64url');

    const receiver = createECDH('prime256v1');
    receiver.generateKeys();
    receiverP256dh = receiver.getPublicKey(null, 'uncompressed').toString('base64url');
    receiverAuth = randomBytes(16).toString('base64url');
});

function makeRequest({ secret = SECRET, body = null, rawBody = undefined } = {}) {
    const headers = new Map();
    if (secret !== null) headers.set('x-push-webhook-secret', secret);
    return {
        headers: { get: (name) => headers.get(name) ?? null },
        json: async () => {
            if (rawBody !== undefined) return JSON.parse(rawBody);
            return body;
        },
    };
}

function makeEnv(overrides = {}) {
    return {
        PUSH_WEBHOOK_SECRET: SECRET,
        SUPABASE_URL: 'https://db.example',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
        VAPID_PRIVATE_KEY: vapidPrivateKey,
        VAPID_PUBLIC_KEY: vapidPublicKey,
        VAPID_SUBJECT: 'mailto:test@example.com',
        ...overrides,
    };
}

const NOTIFICATION = {
    recipient_id: 'recipient-1',
    actor_id: 'actor-1',
    type: 'friend_response',
    payload: { actorName: 'Ada', actorShareCode: 'ab12' },
};

function webhookBody(record = NOTIFICATION) {
    return { type: 'INSERT', table: 'user_notifications', schema: 'public', record };
}

function subs() {
    return [
        { id: 'sub-1', endpoint: 'https://push.example/one', p256dh: receiverP256dh, auth: receiverAuth },
        { id: 'sub-2', endpoint: 'https://push.example/two', p256dh: receiverP256dh, auth: receiverAuth },
    ];
}

/**
 * Stub fetch. Routes PostgREST reads/writes and the push endpoints; `pushStatus`
 * maps an endpoint to the status the push service returns (default 201).
 */
function installFetch({ subscriptions = subs(), language = 'en', pushStatus = {}, pushThrows = [] } = {}) {
    const calls = [];
    const fetchStub = vi.fn(async (url, options = {}) => {
        calls.push({ url, options });
        if (url.includes('/rest/v1/push_subscriptions') && options.method === 'DELETE') {
            return { ok: true, status: 204, json: async () => ({}) };
        }
        if (url.includes('/rest/v1/push_subscriptions')) {
            return { ok: true, status: 200, json: async () => subscriptions };
        }
        if (url.includes('/rest/v1/user_profiles')) {
            return { ok: true, status: 200, json: async () => [{ native_language: language }] };
        }
        if (url.startsWith('https://push.example/')) {
            if (pushThrows.includes(url)) throw new Error('socket hang up');
            const status = pushStatus[url] ?? 201;
            return { ok: status < 300, status, json: async () => ({}) };
        }
        throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchStub);
    return { calls, fetchStub };
}

function pushCalls(calls) {
    return calls.filter((c) => c.url.startsWith('https://push.example/'));
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('requireWebhookSecret', () => {
    it('401s without the secret and 500s when the secret is unconfigured', async () => {
        expect((await requireWebhookSecret(makeRequest({ secret: null }), makeEnv())).status).toBe(401);
        expect((await requireWebhookSecret(makeRequest({ secret: 'wrong' }), makeEnv())).status).toBe(401);
        expect(await requireWebhookSecret(makeRequest(), makeEnv())).toBeNull();
        expect((await requireWebhookSecret(makeRequest(), makeEnv({ PUSH_WEBHOOK_SECRET: undefined }))).status).toBe(500);
    });
});

describe('onRequestPost — request validation', () => {
    it('rejects an unauthenticated caller and sends nothing', async () => {
        const { calls } = installFetch();
        const res = await onRequestPost({ request: makeRequest({ secret: 'nope' }), env: makeEnv() });
        expect(res.status).toBe(401);
        expect(pushCalls(calls).length).toBe(0);
    });

    it('is fail-open for a malformed body and for a record with no recipient', async () => {
        const { calls } = installFetch();
        const bad = await onRequestPost({ request: makeRequest({ rawBody: 'not json' }), env: makeEnv() });
        expect(bad.status).toBe(200);
        expect(await bad.json()).toEqual({ sent: 0, reason: 'bad-json' });

        const noRecipient = await onRequestPost({
            request: makeRequest({ body: { type: 'INSERT', record: { type: 'friend_response' } } }),
            env: makeEnv(),
        });
        expect(noRecipient.status).toBe(200);
        expect(await noRecipient.json()).toEqual({ sent: 0, reason: 'no-recipient' });
        expect(pushCalls(calls).length).toBe(0);
    });

    it('is fail-open when the store or the VAPID key is unconfigured', async () => {
        installFetch();
        const noStore = await onRequestPost({
            request: makeRequest({ body: webhookBody() }),
            env: makeEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined }),
        });
        expect(await noStore.json()).toEqual({ sent: 0, reason: 'store-not-configured' });

        const noKey = await onRequestPost({
            request: makeRequest({ body: webhookBody() }),
            env: makeEnv({ VAPID_PRIVATE_KEY: undefined }),
        });
        expect(await noKey.json()).toEqual({ sent: 0, reason: 'push-not-configured' });
    });

    it('reports no-subscriptions and unsupported-type without sending', async () => {
        installFetch({ subscriptions: [] });
        const none = await onRequestPost({ request: makeRequest({ body: webhookBody() }), env: makeEnv() });
        expect(await none.json()).toEqual({ sent: 0, pruned: 0, failed: 0, reason: 'no-subscriptions' });

        const { calls } = installFetch();
        const other = await onRequestPost({
            request: makeRequest({ body: webhookBody({ ...NOTIFICATION, type: 'unknown_type' }) }),
            env: makeEnv(),
        });
        expect(await other.json()).toEqual({ sent: 0, pruned: 0, failed: 0, reason: 'unsupported-type' });
        expect(pushCalls(calls).length).toBe(0);
    });
});

describe('onRequestPost — sending', () => {
    it('sends one push per subscription with the app TTL and a VAPID authorization', async () => {
        const { calls } = installFetch();
        const res = await onRequestPost({ request: makeRequest({ body: webhookBody() }), env: makeEnv() });
        expect(await res.json()).toEqual({ sent: 2, pruned: 0, failed: 0 });

        const pushes = pushCalls(calls);
        expect(pushes.map((c) => c.url).sort()).toEqual([
            'https://push.example/one',
            'https://push.example/two',
        ]);
        for (const call of pushes) {
            expect(String(call.options.method).toLowerCase()).toBe('post');
            expect(call.options.headers.ttl).toBe(String(PUSH_TTL_SECONDS));
            expect(call.options.headers.authorization).toMatch(/^vapid /i);
            expect(call.options.headers['content-encoding']).toBe('aes128gcm');
            // The body is encrypted: it must not leak the plaintext copy.
            expect(call.options.body).toBeInstanceOf(Uint8Array);
            expect(Buffer.from(call.options.body).toString('utf8')).not.toContain('Ada');
        }
    });

    it('looks up the recipient language and caps the subscription query', async () => {
        const { calls } = installFetch({ language: 'es' });
        await onRequestPost({ request: makeRequest({ body: webhookBody() }), env: makeEnv() });

        const languages = calls.filter((c) => c.url.includes('/rest/v1/user_profiles'));
        expect(languages.length).toBe(1);
        expect(languages[0].url).toContain('native_language');

        const subs = calls.find((c) => c.url.includes('/rest/v1/push_subscriptions'));
        expect(subs.url).toContain(`limit=${MAX_SUBSCRIPTIONS_PER_SEND}`);
        expect(subs.url).toContain('recipient-1');
    });

    it('prunes a subscription the push service reports as gone', async () => {
        const { calls } = installFetch({
            pushStatus: { 'https://push.example/two': 410 },
        });
        const res = await onRequestPost({ request: makeRequest({ body: webhookBody() }), env: makeEnv() });
        expect(await res.json()).toEqual({ sent: 1, pruned: 1, failed: 0 });

        const deletes = calls.filter((c) => c.options.method === 'DELETE');
        expect(deletes.length).toBe(1);
        expect(deletes[0].url).toContain('id=eq.sub-2');
    });

    it('counts a 404 as gone too', async () => {
        installFetch({ pushStatus: { 'https://push.example/one': 404 } });
        const res = await onRequestPost({ request: makeRequest({ body: webhookBody() }), env: makeEnv() });
        expect(await res.json()).toEqual({ sent: 1, pruned: 1, failed: 0 });
    });

    it('isolates failures: one bad endpoint does not stop the others', async () => {
        const { calls } = installFetch({
            pushStatus: { 'https://push.example/one': 500 },
            pushThrows: [],
        });
        const res = await onRequestPost({ request: makeRequest({ body: webhookBody() }), env: makeEnv() });
        expect(await res.json()).toEqual({ sent: 1, pruned: 0, failed: 1 });
        expect(pushCalls(calls).length).toBe(2);
    });

    it('treats a thrown send as failed and still returns 200', async () => {
        const { calls } = installFetch({ pushThrows: ['https://push.example/one'] });
        const res = await onRequestPost({ request: makeRequest({ body: webhookBody() }), env: makeEnv() });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ sent: 1, pruned: 0, failed: 1 });
        expect(pushCalls(calls).length).toBe(2);
    });
});

describe('parseNotificationRecord', () => {
    it('accepts a webhook payload with a recipient and rejects everything else', () => {
        expect(parseNotificationRecord(webhookBody())).toEqual(NOTIFICATION);
        expect(parseNotificationRecord({ record: { type: 'x' } })).toBeNull();
        expect(parseNotificationRecord({ record: { recipient_id: '' } })).toBeNull();
        expect(parseNotificationRecord({})).toBeNull();
        expect(parseNotificationRecord(null)).toBeNull();
        expect(parseNotificationRecord('nope')).toBeNull();
    });
});
