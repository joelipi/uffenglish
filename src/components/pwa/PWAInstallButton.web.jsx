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
        const element = getRegisteredInstallElement();
        const opened = openInstallDialog(element);
        // Diagnostic snapshot for install-flow reports (e.g. a platform where
        // the dialog does not appear): whether the element existed, what the
        // library thinks is available, and whether a deferred prompt was held.
        // Read-only and fail-open — a logging failure must never break the tap.
        try {
            console.log('[PWA] Install dialog requested:', {
                opened,
                hasElement: !!element,
                isInstallAvailable: element ? !!element.isInstallAvailable : null,
                isDialogHidden: element ? !!element.isDialogHidden : null,
                hasDeferredPrompt: typeof window !== 'undefined'
                    ? !!window.defferedPromptEvent
                    : null,
            });
        } catch (err) {
            console.error('[PWA] Install diagnostics failed:', err);
        }
    };

    return (
        <button type="button" data-testid="install-app" onClick={handleClick} style={style}>
            <i className="bi bi-download"></i> {label}
        </button>
    );
}
