// components/pwa/PWAInstallDialog.web.jsx
// Mounts the `@khmyznikov/pwa-install` dialog exactly once per app language, in
// the app layout. It renders nothing else and stays inert until the home menu's
// Install entry (`PWAInstallButton`) asks the registered element to open.
//
// The element is created imperatively (not as JSX) so its `connectedCallback` —
// where the component reads `navigator.language` once, synchronously — runs
// inside `mountInstallElement`'s spoof window, and the dialog speaks the app's
// UI language instead of the browser's. Re-created when the app language
// changes (`lang` dep), so switching language re-localizes the dialog.
import React, { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import '@khmyznikov/pwa-install';
import { appStore } from '../../modules/store/store.js';
import { mountInstallElement, unmountInstallElement } from '../../modules/pwa/install-prompt-webonly.js';

export default function PWAInstallDialog() {
    const hostRef = useRef(null);
    const guestLang = useStore(appStore, (state) => state.guestNativeLanguage);
    const userDataLang = useStore(appStore, (state) => state.userData?.native_language);
    const lang = guestLang || userDataLang || 'en';

    useEffect(() => {
        const element = mountInstallElement(hostRef.current, { lang });
        return () => unmountInstallElement(element);
    }, [lang]);

    return <span ref={hostRef} data-testid="pwa-install-host" style={{ display: 'contents' }} />;
}
