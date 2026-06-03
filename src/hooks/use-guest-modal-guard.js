import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { appStore } from '../modules/store/store.js';
import { useAuthStatus } from '../modules/api/api.js';

const AUTH_ROUTES = ['/login', '/signup', '/recover-password', '/reset-password'];

export function useGuestModalGuard() {
    const { data: isLoggedIn, isLoading: authLoading } = useAuthStatus();
    const location = useLocation();
    const fired = useRef(false);

    useEffect(() => {
        if (authLoading) return;
        if (fired.current) return;
        fired.current = true;

        if (!isLoggedIn) {
            const path = location.pathname;
            const isAuthRoute = AUTH_ROUTES.some(route => path === route || path.startsWith(route + '/'));
            if (!isAuthRoute) {
                console.log('[GuestModalGuard] Anonymous visitor on non-auth route. Opening guest modal.');
                appStore.getState().setGuestModalOpen(true);
            }
        }
    }, [authLoading]); // eslint-disable-line react-hooks/exhaustive-deps
}
