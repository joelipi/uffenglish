import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from 'zustand';
import { appStore } from '../modules/store/store.js';
import { useAuthStatus } from '../modules/api/api.js';
import { usePreloader } from './usePreloader.js';
import { isFriendLesson } from '../modules/user/friend-lesson-detection.js';
import { resolveGuestModalPlan, resolveSilentLanguageReapply, isPublicHomeRoute, isProfileRoute } from '../modules/user/guest-modal-logic.js';

const AUTH_ROUTES = ['/login', '/signup', '/recover-password', '/reset-password'];

/**
 * Detect the user's browser/device language and return a two-letter
 * uppercase language code (e.g. 'EN', 'ES', 'HI', 'BN').
 * Works in browsers via navigator.language; falls back to 'EN'.
 * Exported for unit tests.
 */
export function detectBrowserLanguage() {
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
    // Reactive view of userData so the silent-adopt language can be re-applied
    // if a later bootstrap write replaces the object (see effect below).
    const storeUserData = useStore(appStore, (state) => state.userData);
    // Language adopted silently for a friend lesson; remembered so a later
    // bootstrap setCourseData({ userData }) cannot overwrite it.
    const silentLangRef = useRef(null);

    // ── Open modal for non-auth guest users ──
    // Logged-in users are treated as logged in: friend detection, silent
    // adoption, and friend mode are all skipped by this early return.
    useEffect(() => {
        if (isLoading || isLoggedIn) return;

        const path = location.pathname;
        const isAuthRoute = AUTH_ROUTES.some(route => path === route || path.startsWith(route + '/'));
        if (!isAuthRoute) {
            const state = appStore.getState();
            if (state.guestModalShownThisSession) return;

            if (isPublicHomeRoute(path)) {
                console.log('[GuestModalGuard] Public homepage — not opening the guest modal.');
                return;
            }

            if (isProfileRoute(path)) {
                console.log('[GuestModalGuard] Profile page — not opening the guest modal.');
                return;
            }

            const detectedCode = detectBrowserLanguage();
            const friendLesson = isFriendLesson({ search: location.search, pathname: path });
            const plan = resolveGuestModalPlan({ isFriendLesson: friendLesson, detectedLang: detectedCode });

            state.setGuestDetectedLang(detectedCode);
            state.setGuestModalShownThisSession(true);
            // The plan is the single source for friend mode — never the raw boolean.
            state.setGuestModalFriendMode(plan.friendMode);

            if (plan.action === 'adopt-silently') {
                silentLangRef.current = plan.language;
                state.setGuestLanguageSilent(plan.language);
                state.setGuestModalOpen(false);
                console.log('[GuestModalGuard] Friend lesson with non-English browser language:', plan.language, '. Skipping guest modal and adopting language silently.');
                return;
            }

            console.log('[GuestModalGuard] Anonymous visitor on non-auth route. Detected language:', detectedCode, '. Friend lesson:', friendLesson, '. Opening guest modal.');
            state.setGuestModalStep('select-language');
            state.setGuestModalOpen(true);
        }
    }, [isLoading, isLoggedIn, location.pathname, location.search]);

    // ── Re-apply the silently adopted language after a later userData write ──
    useEffect(() => {
        // The decision (logged-in users always win, forget the ref) lives in the
        // pure helper so it is unit-tested instead of only asserted as source text.
        const decision = resolveSilentLanguageReapply({
            isLoggedIn,
            silentLang: silentLangRef.current,
            currentUserLang: storeUserData?.native_language,
        });
        if (decision.action === 'forget') {
            // Known limitation (mid-session login): dropping the ref stops future
            // re-applies, but a language already adopted earlier in this SPA
            // session can persist, because useAppBootstrap (initStarted guard)
            // does not rewrite userData until a full reload. Do not add a profile
            // re-fetch here — a fresh load while logged in uses the profile.
            silentLangRef.current = null;
            return;
        }
        if (decision.action === 'apply') {
            appStore.getState().setGuestLanguageSilent(decision.language);
        }
    }, [storeUserData, isLoggedIn]);

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
