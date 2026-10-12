// components/pwa/PWAInstallDialog.web.jsx
// Mounts the `@khmyznikov/pwa-install` dialog exactly once, in the app layout.
// It renders nothing else and stays inert until the home menu's Install entry
// (`PWAInstallButton`) asks the registered element to open.
//
// `manual-apple` + `manual-chrome` keep the component from opening on its own:
// this app already throws the guest language/login modal at first-time
// visitors, and a second unsolicited overlay is both a UX regression and a
// source of click interception for automated tests. `use-local-storage` makes a
// dismissal stick. `manifest-url` points at the build-generated manifest so the
// component can use the Web Install API with a manifest `id`.
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
