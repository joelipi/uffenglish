import React, { useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useStore } from 'zustand';
import { useQuery } from '@tanstack/react-query';
import { appStore } from '../modules/store/store.js';
import { normalizeConfig, resolveConfigLanguage } from '../modules/bilingual/config-normalizer.js';
import { useAppBootstrap } from '../hooks/use-app-bootstrap-webonly.js';

export default function AppLayout() {
    const { courseId } = useParams();
    const configData = useStore(appStore, state => state.configData);
    const userData = useStore(appStore, state => state.userData);
    const guestLang = useStore(appStore, state => state.guestNativeLanguage);
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

    // Side effect: normalize and store config when fetched
    useEffect(() => {
        if (fetchedConfig && !configData && userData) {
            const courseLevel = fetchedConfig.courseLevel || 'A0';
            // Guest language wins over the profile language, matching the rest of
            // the app (guestNativeLanguage || userData.native_language || 'en').
            // A friend lesson adopts the browser language silently in
            // useGuestModalGuard, which can land after this effect first runs; the
            // guestLang dependency re-normalizes when that happens.
            normalizeConfig(fetchedConfig, resolveConfigLanguage(guestLang, userData?.native_language));
            appStore.getState().setCourseData({ courseId, configData: fetchedConfig, courseLevel });
        }
    }, [fetchedConfig, userData, guestLang]); // eslint-disable-line react-hooks/exhaustive-deps

    // Side effect: handle config fetch error
    useEffect(() => {
        if (isError) {
            console.error('[AppLayout] Config fetch error');
            appStore.getState().setCriticalErrorMessage('Failed to load course configuration.');
        }
    }, [isError]);

    const isReady = bootState === 'ready' && (!!configData || !!fetchedConfig || isError);

    return (
        <>
            {isReady ? <Outlet /> : null}
        </>
    );
}
