import React from 'react';
import { Outlet } from 'react-router-dom';
import GuestLoginModal from '../js/components/modals/GuestLoginModal.web.jsx';
import { useGuestModalGuard } from '../js/hooks/use-guest-modal-guard.js';

export default function RootLayout() {
    useGuestModalGuard();

    return (
        <>
            <Outlet />
            <GuestLoginModal />
        </>
    );
}
