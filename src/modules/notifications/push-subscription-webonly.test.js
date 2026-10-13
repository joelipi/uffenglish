// @vitest-environment jsdom
// modules/notifications/push-subscription-webonly.test.js
// The subscribe/deny/failure matrix for the browser-side module. Every path must
// return `{ ok:false, reason }` rather than throw, because it is called straight
// from a button handler.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    subscribeToPush,
    persistSubscription,
    syncExistingSubscription,
    readPushSupport,
    listenForAppInstalled,
    resolveClientVapidPublicKey,
    listenForPushSubscriptionChange,
} from './push-subscription-webonly.js';
import { DEFAULT_VAPID_PUBLIC_KEY } from './push-config.js';

const SUBSCRIPTION_JSON = {
    endpoint: 'https://push.example/device-1',
    expirationTime: null,
    keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
};

function makeSubscription(json = SUBSCRIPTION_JSON) {
    return { endpoint: json.endpoint, toJSON: () => json };
}

/** Minimal Supabase double: a thenable delete chain + an insert recorder. */
function makeSupabase({ insertError = null } = {}) {
    const calls = { deleted: [], inserted: [] };
    const client = {
        from(table) {
            return {
                delete() {
                    const chain = {
                        eq(column, value) {
                            calls.deleted.push({ table, column, value });
                            return chain;
                        },
                        then(resolve) { return resolve({ error: null }); },
                    };
                    return chain;
                },
                insert(row) {
                    calls.inserted.push({ table, row });
                    return Promise.resolve({ error: insertError });
                },
            };
        },
    };
    return { client, calls };
}

function installBrowser({ permission = 'default', requestResult = 'granted', existing = null, subscribeImpl = null } = {}) {
    const subscribe = vi.fn(subscribeImpl || (async () => makeSubscription()));
    const registration = {
        pushManager: {
            getSubscription: vi.fn(async () => existing),
            subscribe,
        },
    };
    const requestPermission = vi.fn(async () => requestResult);

    const NotificationStub = function NotificationStub() {};
    NotificationStub.permission = permission;
    NotificationStub.requestPermission = requestPermission;
    vi.stubGlobal('Notification', NotificationStub);

    function PushManagerStub() {}
    vi.stubGlobal('PushManager', PushManagerStub);

    Object.defineProperty(window.navigator, 'serviceWorker', {
        configurable: true,
        value: {
            ready: Promise.resolve(registration),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        },
    });

    return { subscribe, requestPermission, registration };
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    try {
        window.localStorage.clear();
    } catch { /* ignore */ }
});

describe('subscribeToPush — fail-open paths', () => {
    it('reports unsupported when the browser lacks the APIs', async () => {
        // No Notification / PushManager / serviceWorker stubs installed.
        expect(readPushSupport().supported).toBe(false);
        await expect(subscribeToPush({ supabaseClient: makeSupabase().client, userId: 'u1' }))
            .resolves.toEqual({ ok: false, reason: 'unsupported' });
    });

    it('reports not-signed-in when there is no user', async () => {
        installBrowser();
        await expect(subscribeToPush({ supabaseClient: makeSupabase().client, userId: null }))
            .resolves.toEqual({ ok: false, reason: 'not-signed-in' });
    });

    it('reports not-configured for an unusable VAPID key and never prompts', async () => {
        const { requestPermission, subscribe } = installBrowser();
        const result = await subscribeToPush({
            supabaseClient: makeSupabase().client,
            userId: 'u1',
            vapidPublicKey: 'not-a-key',
        });
        expect(result).toEqual({ ok: false, reason: 'not-configured' });
        expect(requestPermission).not.toHaveBeenCalled();
        expect(subscribe).not.toHaveBeenCalled();
    });

    it('reports denied without re-prompting when permission is already denied', async () => {
        const { requestPermission, subscribe } = installBrowser({ permission: 'denied' });
        const result = await subscribeToPush({ supabaseClient: makeSupabase().client, userId: 'u1' });
        expect(result).toEqual({ ok: false, reason: 'denied' });
        expect(requestPermission).not.toHaveBeenCalled();
        expect(subscribe).not.toHaveBeenCalled();
    });

    it('reports denied when the user declines the prompt', async () => {
        installBrowser({ permission: 'default', requestResult: 'denied' });
        await expect(subscribeToPush({ supabaseClient: makeSupabase().client, userId: 'u1' }))
            .resolves.toEqual({ ok: false, reason: 'denied' });
    });

    it('reports a dismissed prompt as dismissed, not denied', async () => {
        // Closing the OS dialog without choosing leaves permission at 'default':
        // still re-promptable, so it must not latch the blocked UI.
        installBrowser({ permission: 'default', requestResult: 'default' });
        await expect(subscribeToPush({ supabaseClient: makeSupabase().client, userId: 'u1' }))
            .resolves.toEqual({ ok: false, reason: 'dismissed' });
    });

    it('reports failed (never throws) when pushManager.subscribe rejects', async () => {
        installBrowser({ subscribeImpl: async () => { throw new Error('gcm rejected'); } });
        await expect(subscribeToPush({ supabaseClient: makeSupabase().client, userId: 'u1' }))
            .resolves.toEqual({ ok: false, reason: 'failed' });
    });

    it('reports failed when storing the subscription errors', async () => {
        installBrowser();
        const { client } = makeSupabase({ insertError: new Error('rls denied') });
        await expect(subscribeToPush({ supabaseClient: client, userId: 'u1' }))
            .resolves.toEqual({ ok: false, reason: 'failed' });
    });
});

describe('subscribeToPush — success path', () => {
    it('requests permission, subscribes with the VAPID key and persists the device', async () => {
        const { subscribe, requestPermission } = installBrowser();
        const { client, calls } = makeSupabase();

        const result = await subscribeToPush({ supabaseClient: client, userId: 'u1' });
        expect(result).toEqual({ ok: true });
        expect(requestPermission).toHaveBeenCalledTimes(1);

        expect(subscribe).toHaveBeenCalledTimes(1);
        const options = subscribe.mock.calls[0][0];
        expect(options.userVisibleOnly).toBe(true);
        expect(options.applicationServerKey).toBeInstanceOf(Uint8Array);
        expect(options.applicationServerKey.length).toBe(65);

        // delete-then-insert, keyed on this user + endpoint, exactly once.
        expect(calls.inserted).toHaveLength(1);
        expect(calls.inserted[0].row).toMatchObject({
            user_id: 'u1',
            endpoint: SUBSCRIPTION_JSON.endpoint,
            p256dh: 'p256dh-value',
            auth: 'auth-value',
        });
        expect(calls.deleted.map((d) => d.column)).toContain('endpoint');
    });

    it('skips the permission prompt but still stores when permission is already granted', async () => {
        const { requestPermission, subscribe } = installBrowser({ permission: 'granted' });
        const { client, calls } = makeSupabase();
        await expect(subscribeToPush({ supabaseClient: client, userId: 'u1' })).resolves.toEqual({ ok: true });
        expect(requestPermission).not.toHaveBeenCalled();
        expect(subscribe).toHaveBeenCalledTimes(1);
        expect(calls.inserted).toHaveLength(1);
    });

    it('reuses an existing browser subscription instead of subscribing twice', async () => {
        const { subscribe } = installBrowser({ existing: makeSubscription() });
        const { client, calls } = makeSupabase();
        await expect(subscribeToPush({ supabaseClient: client, userId: 'u1' })).resolves.toEqual({ ok: true });
        expect(subscribe).not.toHaveBeenCalled();
        expect(calls.inserted).toHaveLength(1);
    });
});

describe('persistSubscription', () => {
    it('accepts a plain subscription object as well as a PushSubscription', async () => {
        const { client, calls } = makeSupabase();
        await expect(persistSubscription({
            supabaseClient: client,
            userId: 'u1',
            subscription: SUBSCRIPTION_JSON,
        })).resolves.toBe(true);
        expect(calls.inserted).toHaveLength(1);
    });

    it('refuses a malformed subscription without touching the database', async () => {
        const { client, calls } = makeSupabase();
        for (const bad of [
            null,
            { endpoint: 'https://push.example/x' },
            { endpoint: 'https://push.example/x', keys: { p256dh: 'p' } },
            { keys: { p256dh: 'p', auth: 'a' } },
        ]) {
            await expect(persistSubscription({
                supabaseClient: client,
                userId: 'u1',
                subscription: bad,
            })).resolves.toBe(false);
        }
        expect(calls.inserted).toHaveLength(0);
    });
});

describe('syncExistingSubscription', () => {
    it('is a no-op when this device has no subscription', async () => {
        installBrowser({ existing: null });
        await expect(syncExistingSubscription({ supabaseClient: makeSupabase().client, userId: 'u1' }))
            .resolves.toEqual({ ok: false, reason: 'none' });
    });

    it('re-registers a subscription the browser rotated while the app was closed', async () => {
        installBrowser({ existing: makeSubscription() });
        const { client, calls } = makeSupabase();
        await expect(syncExistingSubscription({ supabaseClient: client, userId: 'u1' }))
            .resolves.toEqual({ ok: true });
        expect(calls.inserted).toHaveLength(1);
    });

    it('needs a signed-in user', async () => {
        await expect(syncExistingSubscription({ supabaseClient: makeSupabase().client, userId: null }))
            .resolves.toEqual({ ok: false, reason: 'not-signed-in' });
    });
});

describe('listenForAppInstalled', () => {
    it('reports an appinstalled event and unsubscribes cleanly', () => {
        const listeners = [];
        vi.stubGlobal('addEventListener', (type, fn) => listeners.push({ type, fn }));
        const removeEventListener = vi.fn();
        vi.stubGlobal('removeEventListener', removeEventListener);

        const handler = vi.fn();
        const stop = listenForAppInstalled(handler);
        expect(listeners.map((l) => l.type)).toEqual(['appinstalled']);

        listeners[0].fn();
        expect(handler).toHaveBeenCalledTimes(1);

        stop();
        expect(removeEventListener).toHaveBeenCalledWith('appinstalled', listeners[0].fn);
    });

    it('is a no-op without a handler', () => {
        expect(typeof listenForAppInstalled()).toBe('function');
    });
});

describe('resolveClientVapidPublicKey', () => {
    it('prefers an explicit override and falls back to the committed key', () => {
        expect(resolveClientVapidPublicKey('override-key')).toBe('override-key');
        expect(resolveClientVapidPublicKey('   ')).toBe(DEFAULT_VAPID_PUBLIC_KEY);
    });

    it('honours the documented build-time VITE_VAPID_PUBLIC_KEY override', () => {
        vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'from-env');
        expect(resolveClientVapidPublicKey()).toBe('from-env');

        vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');
        expect(resolveClientVapidPublicKey()).toBe(DEFAULT_VAPID_PUBLIC_KEY);
        vi.unstubAllEnvs();
    });
});

describe('listenForPushSubscriptionChange', () => {
    it('only reacts to the subscription-changed message and unsubscribes cleanly', () => {
        const listeners = [];
        Object.defineProperty(window.navigator, 'serviceWorker', {
            configurable: true,
            value: {
                addEventListener: (type, fn) => listeners.push({ type, fn }),
                removeEventListener: vi.fn(),
            },
        });
        const handler = vi.fn();
        const stop = listenForPushSubscriptionChange(handler);
        expect(listeners).toHaveLength(1);

        listeners[0].fn({ data: { type: 'something-else' } });
        expect(handler).not.toHaveBeenCalled();
        listeners[0].fn({ data: { type: 'push-subscription-changed' } });
        expect(handler).toHaveBeenCalledTimes(1);

        expect(() => stop()).not.toThrow();
    });
});
