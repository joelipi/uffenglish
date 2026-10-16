// components/pwa/PWAInstallButton.web.jsx
import React, { useState } from 'react';
import Strings from '../../data/strings.js';
import {
    shouldOfferInstall,
    selectInstallCtaKey,
} from '../../modules/pwa/install-prompt-logic.js';
import {
    getRegisteredInstallElement,
    readIsStandaloneApp,
    readIsApplePlatform,
    hasNativeInstallPrompt,
    triggerNativeInstallPrompt,
    openInstallDialog,
} from '../../modules/pwa/install-prompt-webonly.js';

export default function PWAInstallButton({ label, style, onBeforeOpen }) {
    const [showHelp, setShowHelp] = useState(false);
    if (!shouldOfferInstall({ isStandalone: readIsStandaloneApp() })) return null;
    const isApple = readIsApplePlatform();

    const handleClick = () => {
        if (typeof onBeforeOpen === 'function') onBeforeOpen();
        if (hasNativeInstallPrompt()) {
            triggerNativeInstallPrompt()
                .then((choice) => console.log('[PWA] Native install prompt outcome:', choice && choice.outcome))
                .catch((err) => console.error('[PWA] Native install prompt failed:', err));
            return;
        }
        // No OS prompt is currently available (browser has not fired
        // beforeinstallprompt). Never fall back to the tiny @khmyznikov
        // bottom drawer — show a centered instructions overlay instead.
        setShowHelp(true);
    };

    const resolvedLabel =
        label || Strings.get(selectInstallCtaKey({ isApple }), 'en');

    return (
        <>
            <button type="button" data-testid="install-app" onClick={handleClick} style={style}>
                <i className="bi bi-download"></i> {label != null ? label : resolvedLabel}
            </button>
            {showHelp && (
                <div
                    role="dialog"
                    aria-modal="true"
                    style={{
                        position: 'fixed', inset: 0, zIndex: 2000,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(0,0,0,0.65)', padding: '16px',
                    }}
                    onClick={() => setShowHelp(false)}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: '#12304d', color: 'white', borderRadius: '12px',
                            padding: '24px', maxWidth: '420px', width: '100%',
                            fontFamily: "'Inter', 'Plus Jakarta Sans', sans-serif",
                        }}
                    >
                        <h3 style={{ margin: '0 0 12px', fontSize: '18px' }}>
                            {isApple ? 'Add to Home Screen' : 'Install the UFF app'}
                        </h3>
                        <p style={{ margin: '0 0 12px', fontSize: '14px', lineHeight: 1.5, opacity: 0.9 }}>
                            {isApple
                                ? 'Tap the Share button in Safari, then choose "Add to Home Screen".'
                                : 'This browser has not offered a one-tap install yet. Open Chrome\u2019s menu (\u22ee) and choose "Install app" / "Add to Home screen", or try again on a device that has offered it.'}
                        </p>
                        <button
                            type="button"
                            onClick={() => setShowHelp(false)}
                            style={{
                                background: 'var(--uff-btn-bg, linear-gradient(135deg,#3a8fd5 0%,#00c0d8 100%))',
                                color: 'white', border: 'none', borderRadius: '8px',
                                padding: '10px 18px', fontWeight: 600, cursor: 'pointer',
                            }}
                        >
                            OK
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
