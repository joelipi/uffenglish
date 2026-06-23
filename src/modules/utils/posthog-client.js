// Heavy — imports the full posthog-js SDK (~30 KB gzipped).
// Loaded dynamically after first paint so it never blocks FCP.
import posthog from 'posthog-js';
import { _setPostHog } from './posthog.js';

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
    // Wire the instance into the lightweight posthog.js proxy so
    // trackEvent / identifyUser calls start flowing to the real SDK.
    _setPostHog(posthog);
    console.log('[PostHog] Initialized');
}

export { posthog };
