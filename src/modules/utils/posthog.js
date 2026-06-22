import posthog from 'posthog-js';

let _initialized = false;

export function initPostHog() {
    if (_initialized) return;
    posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_KEY, {
        api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
        person_profiles: 'identified_only',
        capture_pageview: false,
        capture_pageleave: true,
    });
    _initialized = true;
    console.log('[PostHog] Initialized');
}

export function trackEvent(eventName, properties = {}) {
    if (!_initialized) {
        console.warn('[PostHog] trackEvent called before init:', eventName);
    }
    posthog.capture(eventName, properties);
    console.log('[PostHog] Tracked event:', eventName, properties);
}

export function identifyUser(uidOrTraits, traits) {
    if (!_initialized) {
        console.warn('[PostHog] identifyUser called before init');
        return;
    }
    if (typeof uidOrTraits === 'string') {
        posthog.identify(uidOrTraits, traits || {});
        console.log('[PostHog] Identified user:', uidOrTraits, traits);
    } else {
        posthog.identify(uidOrTraits || {});
        console.log('[PostHog] Identified user (traits only):', uidOrTraits);
    }
}

export { posthog };
