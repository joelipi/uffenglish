import React, { useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useStore } from 'zustand';
import { useQuery } from '@tanstack/react-query';
import { appStore } from '../modules/store/store.js';
import { normalizeConfig, getAppLanguage, isConfigLanguageSettled } from '../modules/bilingual/config-normalizer.js';
import { applySuccessSteps } from '../modules/lesson/success-step.web.js';
import { setKnownShareCodes } from '../modules/video/video-source.js';
import { useAppBootstrap } from '../hooks/use-app-bootstrap-webonly.js';
import { useNativeLanguage } from '../hooks/use-native-language.js';
import NotFoundPage from '../components/NotFoundPage.jsx';
import {
    COURSE_CONFIG_OUTCOME,
    classifyCourseConfigResponse,
    isNotFoundError,
    markNotFoundError,
} from '../modules/lesson/lesson-not-found-logic.js';

export default function AppLayout() {
    const { courseId } = useParams();
    const configData = useStore(appStore, state => state.configData);
    const userData = useStore(appStore, state => state.userData);
    const guestLang = useStore(appStore, state => state.guestNativeLanguage);
    const isLoggedIn = useStore(appStore, state => state.isLoggedIn);
    const lang = useNativeLanguage();
    const { bootState } = useAppBootstrap({ courseId });

    const { data: fetchedConfig, isError, error } = useQuery({
        queryKey: ['config', courseId],
        queryFn: async () => {
            const res = await fetch(`/src/config/${courseId}.json`);
            const contentType = res.headers.get('content-type') || '';
            const body = await res.text();
            // A course that is gone answers with the SPA shell (Pages rewrites
            // every path to index.html), not with a config. That is a dead
            // link, not a broken connection: it is tagged so the route can
            // answer with the not-found page instead of the critical-error
            // screen that tells the visitor to check their internet.
            if (classifyCourseConfigResponse({ ok: res.ok, contentType, body }) !== COURSE_CONFIG_OUTCOME.ready) {
                throw markNotFoundError(new Error(`Course config not found: ${courseId}`));
            }
            try {
                return JSON.parse(body);
            } catch (parseError) {
                throw markNotFoundError(new Error(`Course config is not JSON: ${courseId}`));
            }
        },
        staleTime: Infinity,
        enabled: !!courseId && !configData,
        // A missing config never appears on a retry, so fail fast: retrying
        // would only delay the not-found page.
        retry: (failureCount, failureError) => !isNotFoundError(failureError) && failureCount < 3,
    });
    const friendCode = useStore(appStore, state => state.friendCode);

    // Side effect: keep the UGC classifier's code registry current. The
    // classifier matches the share codes in play (never the slug's shape), so
    // the registry must track link changes even when the config is already
    // loaded (a second friend link in one session must not leave stale codes).
    useEffect(() => {
        setKnownShareCodes([friendCode, userData?.shareCode]);
    }, [friendCode, userData?.shareCode]);

    // Side effect: normalize and store config once the language is settled.
    // The guest modal opens AFTER the fetch resolves, so normalizing on fetch
    // would flatten subtitles to English before the guest picks a language.
    // Waiting for the language to settle normalizes exactly once, with the right
    // language, and never re-normalizes (which would restart the lesson).
    // Guest language wins over the profile language, matching the rest of the
    // app (see getAppLanguage).
    useEffect(() => {
        if (!fetchedConfig || !userData || configData) return;
        if (!isConfigLanguageSettled({ isLoggedIn, guestLang })) return;
        const courseLevel = fetchedConfig.courseLevel || 'A0';
        const configLang = getAppLanguage();
        // normalizeConfig must run first: it migrates legacy `questions` to
        // `steps`, which the success injection below needs to exist.
        normalizeConfig(fetchedConfig, configLang);
        // The success step is code-owned (not authored per course): give every
        // lesson the canonical video + captions for its type.
        applySuccessSteps(fetchedConfig, configLang);
        appStore.getState().setCourseData({ courseId, configData: fetchedConfig, courseLevel });
    }, [fetchedConfig, userData, guestLang, isLoggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

    // Side effect: handle config fetch error
    useEffect(() => {
        if (!isError) return;
        if (isNotFoundError(error)) {
            // The link is dead, the connection is fine. Drop any stale critical
            // message so the not-found page is the only thing on screen.
            appStore.getState().clearCriticalError();
            console.warn('[AppLayout] Course config not found:', courseId);
            return;
        }
        console.error('[AppLayout] Config fetch error');
        appStore.getState().setCriticalErrorMessage('Failed to load course configuration.');
    }, [isError, error, courseId]);

    // Hold the lesson until the language is settled so it initializes with the
    // right language. The guest modal lives in RootLayout, so it still renders
    // while this Outlet is withheld.
    const languageSettled = isConfigLanguageSettled({ isLoggedIn, guestLang });
    const isReady = bootState === 'ready' && (!!configData || (!!fetchedConfig && languageSettled) || isError);

    // A retired (or renamed) course is a 404, not a technical error: the
    // visitor gets the app's real not-found page — the copy says the link may
    // no longer be active and the buttons lead to the course list and home.
    if (isError && isNotFoundError(error)) {
        return <NotFoundPage lang={lang} />;
    }

    return (
        <>
            {isReady ? <Outlet /> : null}
        </>
    );
}
