import { useState, useEffect, useRef } from 'react';
import { appStore } from '../modules/store.js';
import { requestPersistentStorage } from '../modules/lesson-init.js';
import { isUserLoggedIn, getUserProfile } from '../modules/api.js';
import { resolveCurrentCourseId, getUrlParamCaseInsensitive } from '../modules/lessonRouting.js';
import { normalizeConfig } from '../modules/config-normalizer.js';
import { saveCourseToUserProfile } from '../modules/user-profile.js';
import { setupAppInfra } from './app-infra.js';
import { usePreloader } from './usePreloader.js';
import Strings from '../data/strings.js';

export function useAppBootstrap() {
    const [bootState, setBootState] = useState('loading');
    const [error, setError] = useState(null);
    const initStarted = useRef(false);
    const { ensurePreloader, startProgressPulse, finishPreloader } = usePreloader();

    useEffect(() => {
        if (initStarted.current) return;
        initStarted.current = true;

        (async () => {
            try {
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

                const isDemoMode = new URLSearchParams(window.location.search).has('demo');
                appStore.getState().setDemoMode(isDemoMode);

                requestPersistentStorage();

                const loggedIn = await isUserLoggedIn();
                appStore.getState().setIsLoggedIn(loggedIn);

                const userData = await getUserProfile();
                appStore.getState().setCourseData({ userData });

                if (!loggedIn) {
                    console.warn('[Bootstrap] User not authenticated. Proceeding as guest.');
                    appStore.getState().setGuestModalOpen(true);
                }

                const urlParams = new URLSearchParams(window.location.search);
                const pathCourseMatch = window.location.pathname.match(/^\/course\/([^/]+)\/lesson\/([^/]+)/);
                const courseContext = {
                    urlCourseId: pathCourseMatch?.[1] || getUrlParamCaseInsensitive(urlParams, 'courseid'),
                    storedCourseId: localStorage.getItem('currentCourse'),
                    profileCourseId: userData?.current_course || null
                };
                const courseId = resolveCurrentCourseId(userData, courseContext);
                localStorage.setItem('currentCourse', courseId);
                if (userData && typeof userData === 'object') {
                    await saveCourseToUserProfile(courseId, userData);
                }

                const configResponse = await fetch(`/js/config/${courseId}.json`);
                const configData = await configResponse.json();
                const englishLevel = configData.languageLevel || 'A0';
                normalizeConfig(configData, userData?.native_language);
                appStore.getState().setCourseData({ courseId, configData, englishLevel });

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
    }, []);

    return { bootState, error };
}
