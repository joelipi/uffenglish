// Lightweight — imported by 18 files. Does NOT pull in the posthog-js SDK.
// The heavy SDK lives in posthog-client.js, loaded dynamically after first paint.
// Until initPostHog() wires it up, trackEvent/identifyUser are safe no-ops.

let _posthog = null;

/** Called by posthog-client.js once the SDK loads. Not for external use. */
export function _setPostHog(instance) {
    _posthog = instance;
}

export function trackEvent(eventName, properties = {}) {
    if (!_posthog) return;
    _posthog.capture(eventName, properties);
    console.log('[PostHog] Tracked event:', eventName, properties);
}

export function identifyUser(uidOrTraits, traits) {
    if (!_posthog) return;
    if (typeof uidOrTraits === 'string') {
        _posthog.identify(uidOrTraits, traits || {});
        console.log('[PostHog] Identified user:', uidOrTraits, traits);
    } else {
        // Traits-only call (e.g. guest user with no ID yet).
        // PostHog identify() requires a string ID.
        // The anonymous user is already tracked from init(). Skip.
        console.log('[PostHog] identifyUser skipped (no ID, traits only):', uidOrTraits);
    }
}
