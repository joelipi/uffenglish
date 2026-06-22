import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { appStore } from '../modules/store/store.js';
import { useAuthStatus } from '../modules/api/api.js';

const AUTH_ROUTES = ['/login', '/signup', '/recover-password', '/reset-password'];

/**
 * Detect the user's browser/device language and return a two-letter
 * uppercase language code (e.g. 'EN', 'ES', 'KO').
 * Works in browsers via navigator.language; falls back to 'EN'.
 */
function detectBrowserLanguage() {
    try {
        const raw = (typeof navigator !== 'undefined' && navigator.language) || 'en';
        const code = raw.split('-')[0].toUpperCase();
        return code || 'EN';
    } catch {
        return 'EN';
    }
}

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
                // Detect browser/device language for the language-selection step
                const detectedCode = detectBrowserLanguage();
                console.log('[GuestModalGuard] Anonymous visitor on non-auth route. Detected language:', detectedCode, '. Opening guest modal.');
                const state = appStore.getState();
                state.setGuestDetectedLang(detectedCode);
                state.setGuestModalStep('select-language');
                state.setGuestModalOpen(true);
            }
        }
    }, [authLoading]); // eslint-disable-line react-hooks/exhaustive-deps
}
