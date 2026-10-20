// src/components/layout/AppHeader.web.jsx
// The app's shared header: the brand bar (menu button, UFF logo, notification
// bell) plus the slide-out navigation drawer.
//
// It is mounted ONCE by the app shell (src/routes/AppShellLayout.jsx), so every
// inside page of the app shows the very same header. The public landing page
// (/), the lesson player and the public share-code profile sit OUTSIDE the
// shell and keep their own chrome.
//
// Web-only: the drawer closes on Escape (a DOM key listener) and it pulls in
// the web install / push affordances. The React Native port adds an
// `AppHeader.native.jsx` with the same props/testids.
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStatus, useUserProfile, signOut } from '../../modules/api/api.js';
import Strings from '../../data/strings.js';
import { useNativeLanguage } from '../../hooks/use-native-language.js';
import { trackEvent } from '../../modules/utils/posthog.js';
import {
    APP_MENU_ITEMS,
    isRegisteredViewer,
    resolveMenuAuthAction,
} from '../../modules/navigation/app-menu-logic.js';
import { selectInstallCtaKey } from '../../modules/pwa/install-prompt-logic.js';
import { readIsApplePlatform } from '../../modules/pwa/install-prompt-webonly.js';
import NotificationsBell from '../homescreen/NotificationsBell.web.jsx';
import PWAInstallButton from '../pwa/PWAInstallButton.web.jsx';
import PushNotificationsOptIn from '../notifications/PushNotificationsOptIn.web.jsx';
import headerLogo from '../../assets/img/uff-logo.png';

const BRAND_GRADIENT = 'linear-gradient(135deg, #3a8fd5 0%, #00c0d8 100%)';

const topBarStyle = {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px',
    background: BRAND_GRADIENT,
};

const iconBtnStyle = {
    background: 'none',
    border: 'none',
    color: 'white',
    fontSize: '28px',
    cursor: 'pointer',
    padding: '8px',
};

const linkStyle = {
    color: 'white',
    textDecoration: 'none',
    padding: '12px',
    borderRadius: '8px',
    fontSize: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
};

// The menu's Install entry is a <button>, not a <Link>, so it needs the link
// styling plus button resets (no default chrome, full-width hit area).
const installBtnStyle = {
    ...linkStyle,
    width: '100%',
    background: 'none',
    border: 'none',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
};

const drawerStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    bottom: 0,
    width: '280px',
    backgroundColor: '#0b1a2a',
    borderRight: '1px solid #1a3a5a',
    padding: '24px',
    zIndex: 1001,
    display: 'flex',
    flexDirection: 'column',
};

const signOutBtnStyle = {
    background: 'none',
    border: '1px solid #dc3545',
    color: '#dc3545',
    padding: '12px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '16px',
};

const signInLinkStyle = {
    background: 'var(--uff-btn-bg)',
    color: 'var(--uff-btn-fg)',
    border: 'var(--uff-btn-border)',
    textDecoration: 'none',
    padding: '12px',
    borderRadius: '8px',
    textAlign: 'center',
    fontSize: '16px',
    fontWeight: 600,
    display: 'block',
    boxShadow: 'var(--uff-btn-shadow)',
};

export default function AppHeader() {
    const navigate = useNavigate();
    const [menuOpen, setMenuOpen] = useState(false);
    const lang = useNativeLanguage();
    const { data: isLoggedIn } = useAuthStatus();
    const { data: profile } = useUserProfile();
    const viewerId = profile?.$id;
    // A guest stub is not an account: no bell, no install/push entries.
    const registered = isRegisteredViewer(viewerId);

    function closeMenu() { setMenuOpen(false); }

    async function handleSignOut() {
        closeMenu();
        trackEvent('sign_out');
        await signOut();
        navigate('/');
    }

    useEffect(() => {
        if (!menuOpen) return;
        function onKeyDown(e) {
            if (e.key === 'Escape') closeMenu();
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [menuOpen]);

    return (
        <>
            <div data-testid="app-header" style={topBarStyle}>
                <button
                    type="button"
                    onClick={() => setMenuOpen(true)}
                    style={iconBtnStyle}
                    aria-label={Strings.get('home_menu', lang)}
                >
                    <i className="bi bi-list"></i>
                </button>
                <img
                    src={headerLogo}
                    alt={Strings.get('home_title', lang)}
                    data-testid="home-logo"
                    // The logo is a ~5.3:1 wordmark. Pinning `height` and capping only
                    // `maxWidth` would squeeze it out of proportion, so BOTH
                    // dimensions are `auto` with a max on each: per CSS 2.1
                    // §10.4 a replaced element's width/height auto box is sized
                    // to the intrinsic ratio and then clamped by max-width /
                    // max-height together, which keeps the wordmark undistorted.
                    // It is the only elastic child of the row, so on a narrow
                    // frame (short window -> frame width is 9/16 of the viewport
                    // height) it gives way instead of pushing the bell past the
                    // frame's right edge, where #root.video-frame clips it away.
                    style={{ width: 'auto', height: 'auto', maxWidth: '50%', maxHeight: '40px', minWidth: 0, display: 'block', filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))' }}
                />
                <div style={{ flexShrink: 0 }}>
                    {isLoggedIn && registered
                        ? <NotificationsBell userId={viewerId} lang={lang} />
                        : <div style={{ width: '44px' }} />}
                </div>
            </div>

            {menuOpen && (
                <div onClick={closeMenu} style={{ position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div onClick={e => e.stopPropagation()} style={drawerStyle}>
                        <div style={{ background: BRAND_GRADIENT, margin: '-24px -24px 24px -24px', padding: '24px', borderBottom: 'none' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '20px', fontWeight: 600 }}>{Strings.get('home_menu', lang)}</span>
                                <button type="button" onClick={closeMenu} style={{ background: 'none', border: 'none', color: 'white', fontSize: '24px', cursor: 'pointer' }}>
                                    <i className="bi bi-x-lg"></i>
                                </button>
                            </div>
                        </div>
                        <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {APP_MENU_ITEMS.map(item => (
                                <Link
                                    key={item.path}
                                    to={item.path}
                                    onClick={closeMenu}
                                    className="uff-menu-link"
                                    style={linkStyle}
                                >
                                    <i className={item.icon}></i> {Strings.get(item.labelKey, lang)}
                                </Link>
                            ))}
                            {registered && (
                                <>
                                    <PWAInstallButton
                                        label={Strings.get(selectInstallCtaKey({ isApple: readIsApplePlatform() }), lang)}
                                        style={installBtnStyle}
                                        onBeforeOpen={closeMenu}
                                    />
                                    <PushNotificationsOptIn
                                        lang={lang}
                                        variant="menu-item"
                                        userId={viewerId}
                                        style={installBtnStyle}
                                        onBeforeOpen={closeMenu}
                                    />
                                </>
                            )}
                        </nav>
                        <div style={{ flex: 1 }} />
                        {resolveMenuAuthAction({ isLoggedIn }) === 'sign-out' ? (
                            <button type="button" onClick={handleSignOut} style={signOutBtnStyle}>
                                <i className="bi bi-box-arrow-right" style={{ marginRight: '8px' }}></i> {Strings.get('sign_out', lang)}
                            </button>
                        ) : (
                            <Link to="/login" onClick={closeMenu} style={signInLinkStyle}>
                                {Strings.get('sign_in', lang)}
                            </Link>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
