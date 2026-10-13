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
    urlBase64ToUint8Array,
    isUsableVapidKey,
} from './push-logic.js';
import {
    DEFAULT_VAPID_PUBLIC_KEY,
    resolveVapidValue,
} from './push-config.js';

/**
 * The VAPID public key: a build-time `VITE_VAPID_PUBLIC_KEY` wins, the committed
 * default is the fallback. This module is SPA-only, so `import.meta.env` is
 * available here (push-config.js cannot read it — the Pages Function imports
 * that module too).
 */
export function resolveClientVapidPublicKey(envValue) {
    const fromEnv = typeof import.meta !== 'undefined' && import.meta.env
        ? import.meta.env.VITE_VAPID_PUBLIC_KEY
        : undefined;
    return resolveVapidValue(envValue, resolveVapidValue(fromEnv, DEFAULT_VAPID_PUBLIC_KEY));
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

/**
 * Fires when the browser reports this site was installed (`appinstalled`, which
 * Chromium raises in the *installing* tab). That tab is still a browser tab —
 * `display-mode` does not flip to standalone until the app is launched from the
 * icon — so this is the only way to offer the notification opt-in right after an
 * install, while the user is looking at it.
 *
 * iOS never fires it, which is why the standalone display mode is checked too.
 * Returns an unsubscribe function.
 */
export function listenForAppInstalled(handler) {
    if (typeof window === 'undefined' || typeof handler !== 'function') return () => {};
    const listener = () => handler();
    try {
        window.addEventListener('appinstalled', listener);
        return () => window.removeEventListener('appinstalled', listener);
    } catch {
        return () => {};
    }
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
    if (granted !== 'granted') {
        // Dismissing the prompt leaves the permission at `default` — still
        // re-promptable — which is NOT the same as choosing Block ('denied').
        // Reporting a dismissal as `denied` would latch the UI into the
        // "unblock in browser settings" state with no way to try again.
        return { ok: false, reason: granted === 'denied' ? 'denied' : 'dismissed' };
    }

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
