// components/pwa/PWAInstallButton.web.jsx
// The "Install app" entry point. Render-only: it asks the pure rules whether to
// offer an install at all and hands the click to the registered install dialog
// element (mounted in RootLayout) — it deliberately does not import the
// `pwa-install` package, so the home screen's own tests stay light.
import React, { useRef, useState } from 'react';
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

/** Read-only diagnostic snapshot: logging must never break the tap. */
function logInstallRequest(message, payload) {
    try {
        console.log(message, payload);
    } catch (err) {
        console.error('[PWA] Install diagnostics failed:', err);
    }
}

export default function PWAInstallButton({ label, style, onBeforeOpen }) {
    const [busy, setBusy] = useState(false);
    // Synchronous re-entry guard: state updates batch, so a `busy` flag alone
    // still lets a second tap through before the re-render lands.
    const busyRef = useRef(false);
    if (!shouldOfferInstall({ isStandalone: readIsStandaloneApp() })) return null;

    const handleClick = async () => {
        // The native flow is one-shot per captured prompt: a second tap while
        // the first is still in flight would consume nothing and fall back to
        // the dialog over the system sheet, so re-entry is ignored.
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        try {
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
                logInstallRequest('[PWA] Install requested (native fast path):', { invoked, ...snapshot });
                if (invoked) return;
            }
            const opened = openInstallDialog(element);
            logInstallRequest('[PWA] Install dialog requested:', { opened, ...snapshot });
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    return (
        <button type="button" data-testid="install-app" onClick={handleClick} disabled={busy} style={style}>
            <i className="bi bi-download"></i> {label}
        </button>
    );
}
