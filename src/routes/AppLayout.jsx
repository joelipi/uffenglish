import React, { useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useStore } from 'zustand';
import { useQuery } from '@tanstack/react-query';
import { appStore } from '../modules/store/store.js';
import { normalizeConfig } from '../modules/bilingual/config-normalizer.js';
import { useAppBootstrap } from '../hooks/use-app-bootstrap-webonly.js';

export default function AppLayout() {
    const { courseId } = useParams();
    const configData = useStore(appStore, state => state.configData);
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
        if (fetchedConfig && !configData) {
            const userData = appStore.getState().userData;
            const courseLevel = fetchedConfig.courseLevel || 'A0';
            normalizeConfig(fetchedConfig, userData?.native_language);
            appStore.getState().setCourseData({ courseId, configData: fetchedConfig, courseLevel });
        }
    }, [fetchedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

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
