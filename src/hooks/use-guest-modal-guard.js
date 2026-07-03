import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { appStore } from '../modules/store/store.js';
import { useAuthStatus } from '../modules/api/api.js';
import { usePreloader } from './usePreloader.js';

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
    const { finishPreloader } = usePreloader();
    const { data: isLoggedIn, isLoading } = useAuthStatus();

    // ── Open modal for non-auth guest users ──
    useEffect(() => {
        if (isLoading || isLoggedIn) return;

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
    }, [isLoading, isLoggedIn, location.pathname]);

    // ── Close modal + dismiss preloader when navigating to an auth route ──
    useEffect(() => {
        const path = location.pathname;
        const isAuthRoute = AUTH_ROUTES.some(route => path === route || path.startsWith(route + '/'));
        if (isAuthRoute) {
            appStore.getState().setGuestModalOpen(false);
            appStore.getState().setIntroVideoReady(true);
            finishPreloader();
        }
    }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Reactively close modal when auth state becomes logged in ──
    useEffect(() => {
        if (isLoggedIn) {
            appStore.getState().setGuestModalOpen(false);
        }
        const unsub = appStore.subscribe((state, prev) => {
            if (state.isLoggedIn && !prev.isLoggedIn && state.isGuestModalOpen) {
                appStore.getState().setGuestModalOpen(false);
            }
        });
        return unsub;
    }, [isLoggedIn]);
}
