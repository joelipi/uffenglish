// modules/pwa/use-standalone-app.js
// Re-reads "is the app already installed?" as a value that can change while
// the page is open, so install affordances disappear the moment the user acts
// on them instead of lingering until a reload.
//
// Reading it once at render is not enough: a user can install from this very
// screen (the banner's own button), and Android/iOS keep the already-open tab
// alive across the install — the flag flips, but nothing re-rendered. We also
// refresh on `visibilitychange`/`focus`, which covers coming back to a tab
// that was left open while the app was installed.
//
// The browser reads themselves stay in install-prompt-webonly.js; this hook is
// only the subscription.
import { useEffect, useState } from 'react';
import { readIsStandaloneApp } from './install-prompt-webonly.js';

/**
 * @returns {boolean} whether the app is currently running as an installed PWA
 */
export function useStandaloneApp() {
    const [isStandalone, setIsStandalone] = useState(readIsStandaloneApp);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const refresh = () => setIsStandalone(readIsStandaloneApp());
        // Chromium only; iOS has no equivalent, but visibilitychange still helps.
        window.addEventListener('appinstalled', refresh);
        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('focus', refresh);
        window.addEventListener('pageshow', refresh);
        return () => {
            window.removeEventListener('appinstalled', refresh);
            document.removeEventListener('visibilitychange', refresh);
            window.removeEventListener('focus', refresh);
            window.removeEventListener('pageshow', refresh);
        };
    }, []);

    return isStandalone;
}