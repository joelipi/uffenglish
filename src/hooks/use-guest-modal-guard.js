import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { appStore } from '../modules/store/store.js';
import { checkAuth } from '../modules/api/auth-check.js';

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
    const location = useLocation();
    const initialCheckFired = useRef(false);

    // ── Open modal on first guest visit to a non-auth route ──
    useEffect(() => {
        if (initialCheckFired.current) return;

        (async () => {
            const { isLoggedIn } = await checkAuth();
            if (!isLoggedIn) {
                const path = location.pathname;
                const isAuthRoute = AUTH_ROUTES.some(route => path === route || path.startsWith(route + '/'));
                if (!isAuthRoute) {
                    const detectedCode = detectBrowserLanguage();
                    console.log('[GuestModalGuard] Anonymous visitor on non-auth route. Detected language:', detectedCode, '. Opening guest modal.');
                    const state = appStore.getState();
                    state.setGuestDetectedLang(detectedCode);
                    state.setGuestModalStep('select-language');
                    state.setGuestModalOpen(true);
                }
            }
        })();
        initialCheckFired.current = true;
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Close modal + unblock preloader when navigating to an auth route ──
    useEffect(() => {
        const path = location.pathname;
        const isAuthRoute = AUTH_ROUTES.some(route => path === route || path.startsWith(route + '/'));
        if (isAuthRoute) {
            appStore.getState().setGuestModalOpen(false);
            // Unblock the preloader: the previous bootstrap may have called
            // setIntroVideoReady(false) before finishPreloader(). On auth pages
            // there's no intro video, so signal ready immediately to let the
            // preloader fade out.
            appStore.getState().setIntroVideoReady(true);
        }
    }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
}
