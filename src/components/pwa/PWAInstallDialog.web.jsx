// components/pwa/PWAInstallDialog.web.jsx
// Mounts the `@khmyznikov/pwa-install` dialog exactly once, in the app layout.
// It renders nothing else and stays inert until an install entry point (the
// home menu button or the install banner) asks the registered element to open.
//
// `manual-apple` + `manual-chrome` keep the component from opening on its own:
// this app already throws the guest language/login modal at first-time
// visitors, and a second unsolicited overlay is both a UX regression and a
// source of click interception for automated tests. `use-local-storage` makes a
// dismissal stick. `manifest-url` points at the build-generated manifest so the
// component can use the Web Install API with a manifest `id`.
//
// The element listens for `beforeinstallprompt` itself (see the library's
// InstallLogic.connect) — we must not intercept it here: calling
// preventDefault from a second listener is harmless, but keeping our own copy
// of the event made the app's install flow diverge from the library's and the
// OS prompt was never reached.
import React, { useEffect, useRef } from 'react';
import '@khmyznikov/pwa-install';
import { registerInstallElement } from '../../modules/pwa/install-prompt-webonly.js';

export default function PWAInstallDialog() {
    const installRef = useRef(null);

    useEffect(() => {
        registerInstallElement(installRef.current);
        console.log('[PWA] Install dialog registered');
        return () => registerInstallElement(null);
    }, []);

    return (
        <pwa-install
            ref={installRef}
            manual-apple="true"
            manual-chrome="true"
            use-local-storage="true"
            manifest-url="/manifest.webmanifest"
        />
    );
}