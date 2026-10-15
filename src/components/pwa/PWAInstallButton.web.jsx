// components/pwa/PWAInstallButton.web.jsx
// The "Install app"/"Add to Home Screen" entry point. Render-only: it asks
// the pure rules whether to offer an install at all and hands the click to
// either the native OS install prompt (Android/Chromium, when available) or
// the registered <pwa-install> dialog element (mounted in RootLayout) — it
// deliberately does not import the `pwa-install` package, so the home
// screen's own tests stay light.
import React from 'react';
import Strings from '../../data/strings.js';
import {
    shouldOfferInstall,
    openInstallDialog,
    selectInstallCtaKey,
} from '../../modules/pwa/install-prompt-logic.js';
import {
    getRegisteredInstallElement,
    readIsStandaloneApp,
    readIsApplePlatform,
    hasNativeInstallPrompt,
    triggerNativeInstallPrompt,
} from '../../modules/pwa/install-prompt-webonly.js';

export default function PWAInstallButton({ label, style, onBeforeOpen }) {
    if (!shouldOfferInstall({ isStandalone: readIsStandaloneApp() })) return null;

    const handleClick = () => {
        if (typeof onBeforeOpen === 'function') onBeforeOpen();
        if (hasNativeInstallPrompt()) {
            triggerNativeInstallPrompt()
                .then((choice) => console.log('[PWA] Native install prompt outcome:', choice && choice.outcome))
                .catch((err) => console.error('[PWA] Native install prompt failed:', err));
            return;
        }
        const opened = openInstallDialog(getRegisteredInstallElement());
        console.log('[PWA] Install dialog requested:', opened);
    };

    const resolvedLabel =
        label || Strings.get(selectInstallCtaKey({ isApple: readIsApplePlatform() }), 'en');

    return (
        <button type="button" data-testid="install-app" onClick={handleClick} style={style}>
            <i className="bi bi-download"></i> {label != null ? label : resolvedLabel}
        </button>
    );
}
