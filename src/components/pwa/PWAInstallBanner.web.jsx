// components/pwa/PWAInstallBanner.web.jsx
import React, { useState } from 'react';
import Strings from '../../data/strings.js';
import {
    shouldShowInstallBanner,
    selectInstallBannerBodyKey,
    selectInstallCtaKey,
    openInstallDialog,
} from '../../modules/pwa/install-prompt-logic.js';
import {
    readIsStandaloneApp,
    readIsApplePlatform,
    getRegisteredInstallElement,
    hasNativeInstallPrompt,
    triggerNativeInstallPrompt,
} from '../../modules/pwa/install-prompt-webonly.js';

const BANNER_STYLE = {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    width: '100%',
    minHeight: '25dvh',
    padding: '20px 16px',
    borderBottom: '2px solid #00c0d8',
    background: 'linear-gradient(135deg, #7a1f1f 0%, #3a0f2a 100%)',
    color: 'white',
    fontFamily: "'Inter', 'Plus Jakarta Sans', sans-serif",
    textAlign: 'center',
};

export default function PWAInstallBanner({ lang = 'en', userId = null }) {
    const [showHelp, setShowHelp] = useState(false);
    // Cheap pure gate first: guests and installed users never pay the
    // platform read below.
    if (!shouldShowInstallBanner({ isStandalone: readIsStandaloneApp(), userId })) return null;
    const isApple = readIsApplePlatform();

    const handleTap = () => {
        const nativeAvailable = hasNativeInstallPrompt && hasNativeInstallPrompt();
        if (nativeAvailable) {
            triggerNativeInstallPrompt?.().then((choice) => {
                console.log('[PWA] Native install prompt outcome:', choice && choice.outcome);
            }).catch((err) => console.error('[PWA] Native install prompt failed:', err));
            return;
        }
        setShowHelp(true);
    };

    return (
        <div data-testid="pwa-install-banner" style={BANNER_STYLE}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '0.5px' }}>
                    {Strings.get('pwa_banner_title', lang)}
                </div>
                <div style={{ fontSize: '16px', fontWeight: 600, lineHeight: 1.5, whiteSpace: 'pre-line' }}>
                    {Strings.get(selectInstallBannerBodyKey({ isApple }), lang)}
                </div>
            </div>
            <button
                type="button"
                data-testid="pwa-install-banner-button"
                className="btn btn-primary btn-lg"
                style={{ marginTop: '12px' }}
                onClick={handleTap}
            >
                <i className="bi bi-download" aria-hidden="true" style={{ marginRight: '8px' }}></i>
                {Strings.get(selectInstallCtaKey({ isApple }), lang)}
            </button>
            {showHelp && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 2100, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.65)', padding: '16px',
                }} onClick={() => setShowHelp(false)}>
                    <div onClick={(e) => e.stopPropagation()} style={{
                        background: '#12304d', color: 'white', borderRadius: '12px',
                        padding: '24px', maxWidth: '420px', width: '100%',
                        fontFamily: "'Inter', 'Plus Jakarta Sans', sans-serif",
                    }}>
                        <h3 style={{ margin: '0 0 12px', fontSize: '18px' }}>
                            {isApple ? 'Add to Home Screen' : 'Install the UFF app'}
                        </h3>
                        <p style={{ margin: '0 0 12px', fontSize: '14px', lineHeight: 1.5, opacity: 0.9 }}>
                            {isApple
                                ? 'Tap the Share button in Safari, then choose "Add to Home Screen".'
                                : 'Chrome has not offered a one-tap install yet. Open Chrome\\u2019s menu and choose "Install app" / "Add to Home screen", or reload and retry after this page has offered it.'}
                        </p>
                        <button type="button" onClick={() => setShowHelp(false)} style={{
                            background: 'var(--uff-btn-bg, linear-gradient(135deg,#3a8fd5 0%,#00c0d8 100%))',
                            color: 'white', border: 'none', borderRadius: '8px',
                            padding: '10px 18px', fontWeight: 600, cursor: 'pointer',
                        }}>
                            OK
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
