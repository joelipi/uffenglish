// components/pwa/PWAInstallButton.web.jsx
// The "Install app" entry point. Render-only: it asks the pure rules whether to
// offer an install at all and hands the click to the registered install dialog
// element (mounted in RootLayout) — it deliberately does not import the
// `pwa-install` package, so the home screen's own tests stay light.
import React from 'react';
import { shouldOfferInstall, openInstallDialog } from '../../modules/pwa/install-prompt-logic.js';
import { getRegisteredInstallElement, readIsStandaloneApp } from '../../modules/pwa/install-prompt-webonly.js';

export default function PWAInstallButton({ label, style, onBeforeOpen }) {
    if (!shouldOfferInstall({ isStandalone: readIsStandaloneApp() })) return null;

    const handleClick = () => {
        if (typeof onBeforeOpen === 'function') onBeforeOpen();
        const opened = openInstallDialog(getRegisteredInstallElement());
        console.log('[PWA] Install dialog requested:', opened);
    };

    return (
        <button type="button" data-testid="install-app" onClick={handleClick} style={style}>
            <i className="bi bi-download"></i> {label}
        </button>
    );
}
