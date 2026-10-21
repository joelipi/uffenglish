import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import GuestLoginModal from '../components/modals/GuestLoginModal.web.jsx';
import SaveClipsModal from '../components/modals/SaveClipsModal.web.jsx';
import Preloader from '../components/Preloader.jsx';
import PWAInstallDialog from '../components/pwa/PWAInstallDialog.web.jsx';
import { useGuestModalGuard } from '../hooks/use-guest-modal-guard.js';
import { useShareCodeFromLocation } from '../hooks/use-share-code.js';
import { trackEvent } from '../modules/utils/posthog.js';

export default function RootLayout() {
    useGuestModalGuard();
    // The friend's share code has to be captured on every location change: the
    // profile's lesson link is a client-side navigation, so the app is already
    // mounted when the visitor clicks it.
    useShareCodeFromLocation();
    const location = useLocation();

    useEffect(() => {
        trackEvent('$pageview');
    }, [location]);

    return (
        <>
            <Preloader />
            <Outlet />
            <GuestLoginModal />
            <SaveClipsModal />
            <PWAInstallDialog />
        </>
    );
}
