// components/pwa/PWAInstallBanner.web.jsx
// The non-dismissible install banner pinned to the top of /home, /profile and
// /courses for signed-in users who are NOT running the installed PWA (guests
// never see install affordances; installed users get the notification prompt
// instead). Render-only: every gate lives in install-prompt-logic.js, the
// browser is read through install-prompt-webonly.js, and tapping the banner
// opens the same <pwa-install> dialog as the menu entry point.
import React from 'react';
import Strings from '../../data/strings.js';
import {
    shouldShowInstallBanner,
    selectInstallBannerBodyKey,
    openInstallDialog,
} from '../../modules/pwa/install-prompt-logic.js';
import {
    readIsStandaloneApp,
    readIsApplePlatform,
    getRegisteredInstallElement,
} from '../../modules/pwa/install-prompt-webonly.js';

const BANNER_STYLE = {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%',
    minHeight: '25dvh',
    padding: '20px 16px',
    border: 'none',
    borderBottom: '2px solid #00c0d8',
    background: 'linear-gradient(135deg, #7a1f1f 0%, #3a0f2a 100%)',
    color: 'white',
    fontFamily: "'Inter', 'Plus Jakarta Sans', sans-serif",
    textAlign: 'center',
    cursor: 'pointer',
};

export default function PWAInstallBanner({ lang = 'en', userId = null }) {
    const isApple = readIsApplePlatform();
    if (!shouldShowInstallBanner({ isStandalone: readIsStandaloneApp(), userId })) return null;

    const handleTap = () => {
        const opened = openInstallDialog(getRegisteredInstallElement());
        console.log('[PWA] Install dialog requested from banner:', opened);
    };

    return (
        <button type="button" data-testid="pwa-install-banner" onClick={handleTap} style={BANNER_STYLE}>
            <span style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '0.5px' }}>
                <i className="bi bi-exclamation-triangle-fill" aria-hidden="true" style={{ marginRight: '8px' }}></i>
                {Strings.get('pwa_banner_title', lang)}
            </span>
            <span style={{ fontSize: '16px', fontWeight: 600, lineHeight: 1.5 }}>
                {Strings.get(selectInstallBannerBodyKey({ isApple }), lang)}
            </span>
        </button>
    );
}
