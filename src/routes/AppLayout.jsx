import React, { useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useStore } from 'zustand';
import { useQuery } from '@tanstack/react-query';
import { appStore } from '../modules/store/store.js';
import { normalizeConfig, resolveConfigLanguage, isConfigLanguageSettled } from '../modules/bilingual/config-normalizer.js';
import { useAppBootstrap } from '../hooks/use-app-bootstrap-webonly.js';

export default function AppLayout() {
    const { courseId } = useParams();
    const configData = useStore(appStore, state => state.configData);
    const userData = useStore(appStore, state => state.userData);
    const guestLang = useStore(appStore, state => state.guestNativeLanguage);
    const isLoggedIn = useStore(appStore, state => state.isLoggedIn);
    const { bootState } = useAppBootstrap({ courseId });

    const { data: fetchedConfig, isError } = useQuery({
        queryKey: ['config', courseId],
        queryFn: async () => {
            const res = await fetch(`/src/config/${courseId}.json`);
            if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
            return res.json();
        },
        staleTime: Infinity,
        enabled: !!courseId && !configData,
    });

    // Side effect: normalize and store config once the language is settled.
    // The guest modal opens AFTER the fetch resolves, so normalizing on fetch
    // would flatten subtitles to English before the guest picks a language.
    // Waiting for the language to settle normalizes exactly once, with the right
    // language, and never re-normalizes (which would restart the lesson).
    // Guest language wins over the profile language, matching the rest of the
    // app (guestNativeLanguage || userData.native_language || 'en').
    useEffect(() => {
        if (!fetchedConfig || !userData || configData) return;
        if (!isConfigLanguageSettled({ isLoggedIn, guestLang })) return;
        const courseLevel = fetchedConfig.courseLevel || 'A0';
        normalizeConfig(fetchedConfig, resolveConfigLanguage(guestLang, userData?.native_language));
        appStore.getState().setCourseData({ courseId, configData: fetchedConfig, courseLevel });
    }, [fetchedConfig, userData, guestLang, isLoggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

    // Side effect: handle config fetch error
    useEffect(() => {
        if (isError) {
            console.error('[AppLayout] Config fetch error');
            appStore.getState().setCriticalErrorMessage('Failed to load course configuration.');
        }
    }, [isError]);

    // Hold the lesson until the language is settled so it initializes with the
    // right language. The guest modal lives in RootLayout, so it still renders
    // while this Outlet is withheld.
    const languageSettled = isConfigLanguageSettled({ isLoggedIn, guestLang });
    const isReady = bootState === 'ready' && (!!configData || (!!fetchedConfig && languageSettled) || isError);

    return (
        <>
            {isReady ? <Outlet /> : null}
        </>
    );
}
