/**
 * useAppBootstrap — React hook for full app bootstrap
 *
 * Encapsulates the initializeApp() flow that was previously in js/app.js.
 * Mounts the preloader in the DOM, then bootstraps app infra so React Router
 * can render routes.
 *
 * Must be called in App.jsx (or equivalent root component).
 */
import { useState, useEffect, useRef } from 'react';
import { appStore } from '../modules/store.js';

import { requestPersistentStorage } from '../modules/lesson-init.js';
import { isUserLoggedIn, getUserProfile } from '../modules/api.js';
import { resolveCurrentCourseId, getUrlParamCaseInsensitive } from '../modules/lessonRouting.js';
import { normalizeConfig } from '../modules/config-normalizer.js';
import { saveCourseToUserProfile } from '../modules/user-profile.js';
import { setupAppInfra } from './app-infra.js';
import Strings from '../data/strings.js';

let preloadDiv = null;
let progressBar = null;
let progressInterval = null;

function ensurePreloader() {
    preloadDiv = document.getElementById('appLoadingImageDiv');
    progressBar = document.getElementById('ui-progress-bar');
}

function startProgressPulse() {
    if (!progressBar) return;
    let progress = 0;
    progressInterval = setInterval(() => {
        progress += (95 - progress) * 0.05;
        if (progressBar) progressBar.style.width = progress + '%';
    }, 100);
}

function finishPreloader() {
    if (progressInterval) clearInterval(progressInterval);
    if (progressBar) progressBar.style.width = '100%';
    setTimeout(() => {
        if (preloadDiv) {
            preloadDiv.style.opacity = '0';
            preloadDiv.style.transition = 'opacity 0.3s ease-out';
            setTimeout(() => { preloadDiv.style.display = 'none'; }, 300);
        }
    }, 250);
}

export function useAppBootstrap() {
    const [bootState, setBootState] = useState('loading');
    const [error, setError] = useState(null);
    const initStarted = useRef(false);

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

                // Resolve course ID and fetch config
                const urlParams = new URLSearchParams(window.location.search);
                const pathCourseMatch = window.location.pathname.match(/^\/course\/([^/]+)\/lesson\/([^/]+)/);
                const courseContext = {
                    urlCourseId: pathCourseMatch?.[1] || getUrlParamCaseInsensitive(urlParams, 'courseid'),
                    storedCourseId: localStorage.getItem('currentCourse'),
                    wpCourseId: userData?.current_course || null
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
