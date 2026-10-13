// modules/notifications/push-logic.js
// Pure rules for the Web Push opt-in. No React, no DOM, no window — the browser
// reads live in push-subscription-webonly.js, so these decisions stay
// unit-testable without a browser and portable to React Native (which has no
// Web Push; `shouldOfferPushNotifications` is simply never true there).

/** A VAPID application-server key is an uncompressed P-256 point (65 bytes). */
const VAPID_KEY_BYTES = 65;

/**
 * Decode a base64url VAPID key into the `Uint8Array` `pushManager.subscribe`
 * wants. Returns null (never throws) for a malformed value so a bad config
 * degrades to "no opt-in" instead of an exception in an effect.
 */
export function urlBase64ToUint8Array(base64UrlString) {
    if (typeof base64UrlString !== 'string' || !base64UrlString) return null;
    const padding = '='.repeat((4 - (base64UrlString.length % 4)) % 4);
    const base64 = (base64UrlString + padding).replace(/-/g, '+').replace(/_/g, '/');
    if (typeof atob !== 'function') return null;
    try {
        const raw = atob(base64);
        const output = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
        return output;
    } catch (err) {
        return null;
    }
}

/** A usable VAPID key decodes to exactly one uncompressed P-256 point. */
export function isUsableVapidKey(base64UrlString) {
    const bytes = urlBase64ToUint8Array(base64UrlString);
    return !!bytes && bytes.length === VAPID_KEY_BYTES && bytes[0] === 0x04;
}

/**
 * Should the app offer to turn notifications on?
 *
 * Every gate must hold: the browser supports push, the user is signed in (in-app
 * notifications are a signed-in feature — the inbox query is disabled for
 * guests), a VAPID key is configured, and this device is not already subscribed.
 *
 * There is deliberately no "dismissed" input: the requirement is to keep offering
 * until notifications are actually enabled. The only state that removes the
 * offer is being subscribed (i.e. done). `permission === 'denied'` is expressed as
 * `canPrompt: false` rather than hiding the offer, because the user can still
 * unblock it in browser settings — see `resolvePushPromptState`.
 */
export function shouldOfferPushNotifications({
    supported = false,
    isLoggedIn = false,
    hasVapidKey = false,
    isSubscribed = false,
} = {}) {
    return !!(supported && isLoggedIn && hasVapidKey && !isSubscribed);
}

/**
 * What the opt-in should render.
 *
 * - `hidden`   — nothing to offer (unsupported, signed out, unconfigured, or done).
 * - `ready`    — offer it; the button can request permission and subscribe.
 * - `blocked`  — offer it, but the OS has already denied permission: the button
 *                cannot re-prompt, so show the "unblock in browser settings"
 *                hint instead of a dead button. Still surfaced, because a denied
 *                user is exactly who "keep asking until it's enabled" is for.
 */
export function resolvePushPromptState(input = {}) {
    if (!shouldOfferPushNotifications(input)) return 'hidden';
    return input.permission === 'denied' ? 'blocked' : 'ready';
}

/** The user-visible outcome of a subscribe attempt, for rendering. */
export function describeSubscribeResult(result) {
    if (result && result.ok) return 'subscribed';
    const reason = result && result.reason;
    if (reason === 'denied') return 'denied';
    if (reason === 'unsupported') return 'unsupported';
    if (reason === 'not-configured') return 'not-configured';
    if (reason === 'not-signed-in') return 'not-signed-in';
    return 'failed';
}
