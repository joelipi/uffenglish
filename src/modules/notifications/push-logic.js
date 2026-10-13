// modules/notifications/push-logic.js
// Pure rules for the Web Push opt-in. No React, no DOM, no window — the browser
// reads live in push-subscription-webonly.js, so these decisions stay
// unit-testable without a browser and portable to React Native (which has no
// Web Push; `shouldOfferPushNotifications` is simply never true there).

/** Storage key remembering that the user dismissed the post-install prompt. */
export const PUSH_PROMPT_DISMISSED_KEY = 'uff-push-prompt-dismissed';

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
 * guests), a VAPID key is configured, permission is not `denied` (asking again
 * is pointless and some browsers refuse), this device is not already subscribed,
 * and the user has not dismissed the prompt.
 */
export function shouldOfferPushNotifications({
    supported = false,
    isLoggedIn = false,
    hasVapidKey = false,
    permission = 'default',
    isSubscribed = false,
    dismissed = false,
} = {}) {
    if (!supported || !isLoggedIn || !hasVapidKey) return false;
    if (permission === 'denied') return false;
    if (isSubscribed || dismissed) return false;
    return true;
}

/**
 * Did the app *just* become an installed PWA? True only on the false→true
 * transition, which is what the post-install prompt hangs off (iOS has no
 * `appinstalled` event, so the same transition is detected from the display
 * mode on the next launch).
 */
export function hasJustInstalled({ wasStandalone = false, isStandalone = false } = {}) {
    return !wasStandalone && isStandalone;
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
