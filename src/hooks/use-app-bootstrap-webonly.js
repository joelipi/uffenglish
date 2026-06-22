// @web-only
// Web-only app bootstrap hook. Uses useSearchParams (React Router web),
// window.appStore (Playwright test bridge), and window.enabledLogs (debug namespace).
// React Native provides its own bootstrap via a separate entry point.

import { useState, useEffect, useRef } from 'react';
import { appStore } from '../modules/store/store.js';
import { getIsDemoMode } from '../modules/user/demo-mode-webonly.js';
import { requestPersistentStorage } from '../modules/storage/storage-persistence-webonly.js';
import { useAuthStatus, useUserProfile } from '../modules/api/api.js';
import { setupAppInfra } from './app-infra-webonly.js';
import { usePreloader } from './usePreloader.js';
import Strings from '../data/strings.js';

export function useAppBootstrap({ courseId } = {}) {
    const [bootState, setBootState] = useState('loading');
    const [error, setError] = useState(null);
    const initStarted = useRef(false);
    const { finishPreloader } = usePreloader();

    // ── Reactive queries (replaces imperative isUserLoggedIn / getUserProfile) ──
    const { data: isLoggedIn, isLoading: authLoading } = useAuthStatus();
    const { data: userData, isLoading: profileLoading } = useUserProfile();

    // ── One-time setup on mount (globals, preloader) ──
    // Intentional window.appStore — Playwright test bridge. Tests call
    // window.appStore.getState() from page.evaluate(). RN tests use different plumbing.
    // Intentional window.enabledLogs — shared debug namespace (see log-control.js).
    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.appStore = appStore;
            window.enabledLogs = window.enabledLogs || {
                whisper: false, recording: false, speech: false, api: false,
                'tanstack query': false, toggle: false, ai: false, analytics: false,
                ui: false, hesitation: false, success: false, scoring: false,
                video: false, router: false, pipeline: false, app: false,
                storage: false, gamification: false, all: false
            };
        }
        appStore.getState().setIsLoaded(false);

        requestPersistentStorage();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Demo mode from URL search params or localStorage ──
    useEffect(() => {
        appStore.getState().setDemoMode(getIsDemoMode());
    }, []);

    // ── Bootstrap once both queries resolve ──
    useEffect(() => {
        if (authLoading || profileLoading) return;
        if (initStarted.current) return;
        initStarted.current = true;

        (async () => {
            try {
                appStore.getState().setIsLoggedIn(!!isLoggedIn);
                appStore.getState().setCourseData({ userData });

                if (!isLoggedIn) {
                    console.warn('[Bootstrap] User not authenticated. Proceeding as guest.');
                }

                if (courseId) {
                    appStore.getState().setCourseId(courseId);
                    if (userData && typeof userData === 'object') {
                        const { saveCourseToUserProfile } = await import('../modules/user/user-profile.js');
                        await saveCourseToUserProfile(courseId, userData);
                    }
                }

                await setupAppInfra({ userData });

                // When loading a lesson course, keep the Preloader overlay in place
                // until the introBackgroundVideo (IncomingVideoWidget) is fully loaded
                // to avoid a Flash of Unloaded Content (FoUC).
                if (courseId) {
                    appStore.getState().setIntroVideoReady(false);
                }

                finishPreloader();

                appStore.getState().setIsLoaded(true);
                setBootState('ready');
            } catch (err) {
                console.error('[Bootstrap] Initialization error:', err);
                setError(err.message);
                appStore.getState().setIsLoaded(true);
                appStore.getState().setCriticalErrorMessage(Strings.get('lesson_load_error'));
                setBootState('error');
            }
        })();
    }, [authLoading, profileLoading]); // eslint-disable-line react-hooks/exhaustive-deps

    return { bootState, error };
}