import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import GuestLoginModal from '../components/modals/GuestLoginModal.web.jsx';
import Preloader from '../components/Preloader.jsx';
import { useGuestModalGuard } from '../hooks/use-guest-modal-guard.js';
import { trackEvent } from '../modules/utils/posthog.js';

export default function RootLayout() {
    useGuestModalGuard();
    const location = useLocation();

    useEffect(() => {
        trackEvent('$pageview');
    }, [location]);

    return (
        <>
            <Preloader />
            <Outlet />
            <GuestLoginModal />
        </>
    );
}
