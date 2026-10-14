// components/pwa/PWAInstallButton.web.jsx
// The "Install app" entry point. Render-only: it asks the pure rules whether to
// offer an install at all and hands the click to the registered install dialog
// element (mounted in RootLayout) — it deliberately does not import the
// `pwa-install` package, so the home screen's own tests stay light.
import React from 'react';
import {
    shouldOfferInstall,
    shouldUseNativeInstall,
    openInstallDialog,
} from '../../modules/pwa/install-prompt-logic.js';
import {
    getRegisteredInstallElement,
    readIsStandaloneApp,
    readNativeInstallAvailability,
    installDirectly,
} from '../../modules/pwa/install-prompt-webonly.js';

export default function PWAInstallButton({ label, style, onBeforeOpen }) {
    if (!shouldOfferInstall({ isStandalone: readIsStandaloneApp() })) return null;

    const handleClick = async () => {
        if (typeof onBeforeOpen === 'function') onBeforeOpen();
        const element = getRegisteredInstallElement();
        const availability = readNativeInstallAvailability();
        const snapshot = {
            hasElement: !!element,
            ...availability,
        };
        // Android with a live native path skips the library sheet and opens
        // the system install UI straight away — the user already tapped
        // Install, and the two sheets look near identical there.
        if (element && shouldUseNativeInstall(availability)) {
            const invoked = await installDirectly(element);
            console.log('[PWA] Install requested (native fast path):', { invoked, ...snapshot });
            if (invoked) return;
        }
        const opened = openInstallDialog(element);
        console.log('[PWA] Install dialog requested:', { opened, ...snapshot });
    };

    return (
        <button type="button" data-testid="install-app" onClick={handleClick} style={style}>
            <i className="bi bi-download"></i> {label}
        </button>
    );
}
