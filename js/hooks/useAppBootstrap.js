import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { appStore } from '../modules/store.js';
import { requestPersistentStorage } from '../modules/lesson-init.js';
import { useAuthStatus, useUserProfile } from '../modules/api.js';
import { setupAppInfra } from './app-infra.js';
import { usePreloader } from './usePreloader.js';
import Strings from '../data/strings.js';

export function useAppBootstrap({ courseId } = {}) {
    const [bootState, setBootState] = useState('loading');
    const [error, setError] = useState(null);
    const initStarted = useRef(false);
    const { ensurePreloader, startProgressPulse, finishPreloader } = usePreloader();
    const [searchParams] = useSearchParams();

    // ── Reactive queries (replaces imperative isUserLoggedIn / getUserProfile) ──
    const { data: isLoggedIn, isLoading: authLoading } = useAuthStatus();
    const { data: userData, isLoading: profileLoading } = useUserProfile();

    // ── One-time setup on mount (globals, preloader) ──
    // Intentional window.appStore — Playwright test bridge. Tests call
    // window.appStore.getState() from page.evaluate(). RN tests use different plumbing.
    // Intentional window.enabledLogs — shared debug namespace (see log-control.js).
    useEffect(() => {
        window.appStore = appStore;
        window.enabledLogs = window.enabledLogs || {
            whisper: false, recording: false, speech: false, api: false,
            'tanstack query': false, toggle: false, ai: false, analytics: false,
            ui: false, hesitation: false, success: false, scoring: false,
            video: false, router: false, pipeline: false, app: false,
            storage: false, gamification: false, all: false
        };
        appStore.getState().setIsLoaded(false);

        ensurePreloader();
        startProgressPulse();

        requestPersistentStorage();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Demo mode from React Router search params ──
    useEffect(() => {
        const isDemoMode = searchParams.has('demo');
        appStore.getState().setDemoMode(isDemoMode);
    }, [searchParams]);

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
                    appStore.getState().setGuestModalOpen(true);
                }

                if (courseId) {
                    appStore.getState().setCourseId(courseId);
                    if (userData && typeof userData === 'object') {
                        const { saveCourseToUserProfile } = await import('../modules/user-profile.js');
                        await saveCourseToUserProfile(courseId, userData);
                    }
                }

                await setupAppInfra({ userData });

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
