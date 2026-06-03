import React from 'react';
import { Outlet } from 'react-router-dom';
import GuestLoginModal from '../components/modals/GuestLoginModal.web.jsx';
import Preloader from '../components/Preloader.jsx';
import { useGuestModalGuard } from '../hooks/use-guest-modal-guard.js';

export default function RootLayout() {
    useGuestModalGuard();

    return (
        <>
            <Preloader />
            <Outlet />
            <GuestLoginModal />
        </>
    );
}
