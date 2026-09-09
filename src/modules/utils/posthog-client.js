// Heavy — imports the full posthog-js SDK (~30 KB gzipped).
// Loaded dynamically after first paint so it never blocks FCP.
import posthog from 'posthog-js';
import { _setPostHog } from './posthog.js';

let _initialized = false;

export function initPostHog() {
    if (_initialized) return;
    // Skip in local dev — avoids polluting pilot replay with localhost noise.
    try {
        if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
            console.log('[PostHog] Skipped on localhost');
            return;
        }
    } catch {}
    posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_KEY, {
        api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
        person_profiles: 'identified_only',
        capture_pageview: false,
        capture_pageleave: true,
        autocapture: true,
        capture_exceptions: true,
        session_recording: {
            maskAllInputs: false,
            maskInputOptions: { password: true, email: true },
        },
    });
    _initialized = true;
    // Wire the instance into the lightweight posthog.js proxy so
    // trackEvent / identifyUser calls start flowing to the real SDK.
    _setPostHog(posthog);
    console.log('[PostHog] Initialized');
}

export { posthog };
