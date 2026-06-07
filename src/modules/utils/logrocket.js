import LogRocket from 'logrocket';

const APP_ID = '0nykle/app';

let initialized = false;

export function initLogRocket() {
    if (initialized) return;
    LogRocket.init(APP_ID);
    initialized = true;
    console.log('[LogRocket] Initialized with app ID:', APP_ID);
}

export function identifyUser(uidOrTraits, traits) {
    if (!initialized) {
        console.warn('[LogRocket] identifyUser called before init');
        return;
    }
    if (typeof uidOrTraits === 'string') {
        LogRocket.identify(uidOrTraits, traits || {});
        console.log('[LogRocket] Identified user:', uidOrTraits, traits);
    } else {
        LogRocket.identify(uidOrTraits || {});
        console.log('[LogRocket] Identified user (traits only):', uidOrTraits);
    }
}

export function trackEvent(eventName, properties = {}) {
    if (!initialized) {
        console.warn('[LogRocket] trackEvent called before init');
        return;
    }
    LogRocket.track(eventName, properties);
    console.log('[LogRocket] Tracked event:', eventName, properties);
}

export function captureException(error, context = {}) {
    if (!initialized) {
        console.warn('[LogRocket] captureException called before init');
        return;
    }
    LogRocket.captureException(error, { extra: context });
    console.log('[LogRocket] Captured exception:', error.message, context);
}
