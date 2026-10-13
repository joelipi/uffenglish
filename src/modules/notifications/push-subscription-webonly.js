// @web-only
// modules/notifications/push-subscription-webonly.js
// Browser-side Web Push plumbing: capability/permission reads, the subscribe
// call, and persisting the subscription so the sender can reach this device.
//
// Intentional window/navigator access, guarded by `typeof window`. Every entry
// point is fail-open: it returns a `{ ok:false, reason }` result instead of
// throwing, so a browser that cannot do push (or a denied permission) never
// breaks the screen it was called from.
import {
    PUSH_PROMPT_DISMISSED_KEY,
    urlBase64ToUint8Array,
    isUsableVapidKey,
    hasJustInstalled,
} from './push-logic.js';
import {
    DEFAULT_VAPID_PUBLIC_KEY,
    resolveVapidValue,
} from './push-config.js';

/** The VAPID public key: build-time override first, committed default after. */
export function resolveClientVapidPublicKey(envValue) {
    return resolveVapidValue(envValue, DEFAULT_VAPID_PUBLIC_KEY);
}

/** Capability + permission snapshot. `supported` mirrors the real requirements. */
export function readPushSupport() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        return { supported: false, permission: 'unsupported' };
    }
    try {
        const supported = 'serviceWorker' in navigator
            && 'PushManager' in window
            && 'Notification' in window;
        const permission = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
        return { supported, permission };
    } catch (err) {
        console.error('[push] capability read failed:', err);
        return { supported: false, permission: 'unsupported' };
    }
}

/** True when the app is running as an installed PWA (mirrors story 062's check). */
export function readIsStandalone() {
    if (typeof window === 'undefined') return false;
    try {
        if (typeof window.matchMedia === 'function'
            && window.matchMedia('(display-mode: standalone)').matches) {
            return true;
        }
        return window.navigator?.standalone === true;
    } catch {
        return false;
    }
}

export function readPromptDismissed() {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage?.getItem(PUSH_PROMPT_DISMISSED_KEY) === '1';
    } catch {
        return false;
    }
}

export function markPromptDismissed() {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage?.setItem(PUSH_PROMPT_DISMISSED_KEY, '1');
    } catch (err) {
        console.error('[push] could not persist the dismissal:', err);
    }
}

const WAS_STANDALONE_KEY = 'uff-push-was-standalone';

/**
 * Did the app just become an installed PWA? Detected once per call by comparing
 * the launch display mode with the previous launch's, then recording the current
 * value — iOS never fires `appinstalled`, so this transition is the portable
 * signal. The decision itself stays in the pure `hasJustInstalled`.
 */
export function consumeJustInstalled() {
    if (typeof window === 'undefined') return false;
    let wasStandalone = false;
    try {
        wasStandalone = window.localStorage?.getItem(WAS_STANDALONE_KEY) === '1';
    } catch {
        wasStandalone = false;
    }
    const isStandalone = readIsStandalone();
    try {
        window.localStorage?.setItem(WAS_STANDALONE_KEY, isStandalone ? '1' : '0');
    } catch (err) {
        console.error('[push] could not persist the standalone flag:', err);
    }
    return hasJustInstalled({ wasStandalone, isStandalone });
}

/** The registration this device's subscription lives on, or null. */
export async function getReadyRegistration() {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return null;
    try {
        return await navigator.serviceWorker.ready;
    } catch (err) {
        console.error('[push] service worker not ready:', err);
        return null;
    }
}

/** The existing subscription for this device, or null. */
export async function readExistingSubscription() {
    const registration = await getReadyRegistration();
    if (!registration || !registration.pushManager) return null;
    try {
        return await registration.pushManager.getSubscription();
    } catch (err) {
        console.error('[push] could not read the existing subscription:', err);
        return null;
    }
}

/**
 * Replace the owner's row for this endpoint. Delete-then-insert (rather than an
 * upsert) keeps the table's grant surface to select/insert/delete — the client
 * never needs UPDATE — and it naturally covers the push service rotating the
 * encryption keys for the same endpoint.
 */
export async function persistSubscription({ supabaseClient, userId, subscription }) {
    if (!subscription) return false;
    const json = typeof subscription.toJSON === 'function' ? subscription.toJSON() : subscription;
    if (!json) return false;
    const keys = json && json.keys ? json.keys : {};
    if (!json || !json.endpoint || !keys.p256dh || !keys.auth) return false;

    try {
        await supabaseClient
            .from('push_subscriptions')
            .delete()
            .eq('user_id', userId)
            .eq('endpoint', json.endpoint);

        const { error } = await supabaseClient.from('push_subscriptions').insert({
            user_id: userId,
            endpoint: json.endpoint,
            p256dh: keys.p256dh,
            auth: keys.auth,
            user_agent: typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '',
        });
        if (error) {
            console.error('[push] storing the subscription failed:', error.message);
            return false;
        }
        return true;
    } catch (err) {
        console.error('[push] storing the subscription threw:', err);
        return false;
    }
}

/**
 * Ask permission (MUST be called from a user gesture — iOS rejects a
 * non-gesture prompt) and subscribe this device, then persist it.
 *
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 */
export async function subscribeToPush({ supabaseClient, userId, vapidPublicKey } = {}) {
    const { supported, permission } = readPushSupport();
    if (!supported) return { ok: false, reason: 'unsupported' };
    if (!userId) return { ok: false, reason: 'not-signed-in' };

    const key = resolveClientVapidPublicKey(vapidPublicKey);
    if (!isUsableVapidKey(key)) return { ok: false, reason: 'not-configured' };
    if (permission === 'denied') return { ok: false, reason: 'denied' };

    const registration = await getReadyRegistration();
    if (!registration || !registration.pushManager) return { ok: false, reason: 'unsupported' };

    let granted = permission;
    if (granted !== 'granted') {
        try {
            granted = await Notification.requestPermission();
        } catch (err) {
            console.error('[push] permission request failed:', err);
            return { ok: false, reason: 'failed' };
        }
    }
    if (granted !== 'granted') return { ok: false, reason: 'denied' };

    try {
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(key),
            });
        }
        const stored = await persistSubscription({ supabaseClient, userId, subscription });
        return stored ? { ok: true } : { ok: false, reason: 'failed' };
    } catch (err) {
        console.error('[push] subscribe failed:', err);
        return { ok: false, reason: 'failed' };
    }
}

/**
 * Reconcile this device on launch: if the browser already holds a subscription
 * (including one it rotated while the app was closed) make sure the server has
 * it. No permission prompt and no subscribe call — a no-op when there is none.
 */
export async function syncExistingSubscription({ supabaseClient, userId } = {}) {
    if (!userId) return { ok: false, reason: 'not-signed-in' };
    const subscription = await readExistingSubscription();
    if (!subscription) return { ok: false, reason: 'none' };
    const stored = await persistSubscription({ supabaseClient, userId, subscription });
    return stored ? { ok: true } : { ok: false, reason: 'failed' };
}

/** Listen for the service worker's "subscription changed" message. */
export function listenForPushSubscriptionChange(handler) {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker || typeof handler !== 'function') {
        return () => {};
    }
    const listener = (event) => {
        if (event && event.data && event.data.type === 'push-subscription-changed') handler();
    };
    try {
        navigator.serviceWorker.addEventListener('message', listener);
        return () => navigator.serviceWorker.removeEventListener('message', listener);
    } catch {
        return () => {};
    }
}
