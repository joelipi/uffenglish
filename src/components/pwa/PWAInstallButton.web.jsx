// components/pwa/PWAInstallButton.web.jsx
// The "Install app"/"Add to Home Screen" entry point. Render-only: it asks
// the pure rules whether to offer an install at all and hands the click to the
// registered <pwa-install> element (mounted in RootLayout), which owns the whole
// install flow — its own panel, and the OS prompt / Web Install API / fallback
// it chooses from there. It deliberately does not import the `pwa-install`
// package, so the home screen's own tests stay light.
import React from 'react';
import { shouldOfferInstall, openInstallDialog } from '../../modules/pwa/install-prompt-logic.js';
import { getRegisteredInstallElement, readIsStandaloneApp } from '../../modules/pwa/install-prompt-webonly.js';

export default function PWAInstallButton({ label, style, onBeforeOpen }) {
    if (!shouldOfferInstall({ isStandalone: readIsStandaloneApp() })) return null;

    const handleClick = () => {
        if (typeof onBeforeOpen === 'function') onBeforeOpen();
        // Force (the default): the dialog must appear on click even when the
        // browser has not raised beforeinstallprompt yet.
        const opened = openInstallDialog(getRegisteredInstallElement());
        console.log('[PWA] Install dialog requested:', opened);
    };

    return (
        <button type="button" data-testid="install-app" onClick={handleClick} style={style}>
            <i className="bi bi-download"></i> {label}
        </button>
    );
}