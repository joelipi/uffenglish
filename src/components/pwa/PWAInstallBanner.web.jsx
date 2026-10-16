// components/pwa/PWAInstallBanner.web.jsx
// The non-dismissible install banner pinned to the top of /home, /profile and
// /courses for signed-in users who are NOT running the installed PWA (guests
// never see install affordances; installed users get the notification prompt
// instead). Render-only: every gate lives in install-prompt-logic.js, the
// browser is read through install-prompt-webonly.js, and the button hands the
// click to the same registered <pwa-install> element as the home menu entry —
// that element owns the install panel and the OS prompt it leads to.
import React from 'react';
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
    // Cheap pure gate first: guests and installed users never pay the
    // platform read below.
    if (!shouldShowInstallBanner({ isStandalone: readIsStandaloneApp(), userId })) return null;
    const isApple = readIsApplePlatform();

    const handleClick = () => {
        // Force (the default): the dialog must appear on click even when the
        // browser has not raised beforeinstallprompt yet.
        const opened = openInstallDialog(getRegisteredInstallElement());
        console.log('[PWA] Install dialog requested from banner:', opened);
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
                onClick={handleClick}
            >
                <i className="bi bi-download" aria-hidden="true" style={{ marginRight: '8px' }}></i>
                {Strings.get(selectInstallCtaKey({ isApple }), lang)}
            </button>
        </div>
    );
}