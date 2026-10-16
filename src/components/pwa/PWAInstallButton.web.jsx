// components/pwa/PWAInstallButton.web.jsx
// The "Install app"/"Add to Home Screen" entry point. Render-only: it asks
// the pure rules whether to offer an install at all and hands the click to the
// registered <pwa-install> element (mounted in RootLayout), which owns the whole
// install flow. It deliberately does not import the `pwa-install` package, so
// the home screen's own tests stay light.
import React from 'react';
import { shouldOfferInstall, requestInstall } from '../../modules/pwa/install-prompt-logic.js';
import { getRegisteredInstallElement, readIsStandaloneApp } from '../../modules/pwa/install-prompt-webonly.js';

export default function PWAInstallButton({ label, style, onBeforeOpen }) {
    if (!shouldOfferInstall({ isStandalone: readIsStandaloneApp() })) return null;

    const handleClick = () => {
        if (typeof onBeforeOpen === 'function') onBeforeOpen();
        // Runs inside the click gesture (the browser requires transient user
        // activation to show an install prompt): installs directly where an OS
        // prompt exists, otherwise opens the library's panel.
        requestInstall(getRegisteredInstallElement()).then(({ ok, route }) => {
            console.log('[PWA] Install click handled:', route, ok);
        });
    };

    return (
        <button type="button" data-testid="install-app" onClick={handleClick} style={style}>
            <i className="bi bi-download"></i> {label}
        </button>
    );
}