import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import GuestLoginModal from '../components/modals/GuestLoginModal.web.jsx';
import SaveClipsModal from '../components/modals/SaveClipsModal.web.jsx';
import Preloader from '../components/Preloader.jsx';
import { useGuestModalGuard } from '../hooks/use-guest-modal-guard.js';
import { getShareCodeFromSearch } from '../modules/user/friend-lesson-detection.js';
import { appStore } from '../modules/store/store.js';
import { trackEvent } from '../modules/utils/posthog.js';

export default function RootLayout() {
    useGuestModalGuard();
    const location = useLocation();

    useEffect(() => {
        trackEvent('$pageview');
    }, [location]);

    // The URL is the source of truth for the friend share code: mirror it into
    // the store on every query change (mount, route change, auth round-trip,
    // in-SPA navigation) so a previous friend's code can never go stale.
    useEffect(() => {
        const code = getShareCodeFromSearch(location.search);
        if (appStore.getState().friendCode !== code) {
            appStore.getState().setFriendCode(code);
            console.log('[FriendCode] synced from URL:', code);
        }
    }, [location.search]);

    return (
        <>
            <Preloader />
            <Outlet />
            <GuestLoginModal />
            <SaveClipsModal />
        </>
    );
}
