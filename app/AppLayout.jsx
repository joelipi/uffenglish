import React, { useEffect, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useStore } from 'zustand';
import { appStore } from '../js/modules/store.js';
import { queryClient } from '../js/modules/api.js';
import { normalizeConfig } from '../js/modules/config-normalizer.js';
import { useAppBootstrap } from '../js/hooks/useAppBootstrap.js';
import Preloader from '../js/components/Preloader.jsx';

export default function AppLayout() {
    const { courseId } = useParams();
    const configData = useStore(appStore, state => state.configData);
    const { bootState } = useAppBootstrap({ courseId });
    const [configReady, setConfigReady] = useState(false);

    useEffect(() => {
        if (!courseId || configData || configReady) return;

        const fetchConfig = async () => {
            try {
                const data = await queryClient.fetchQuery({
                    queryKey: ['config', courseId],
                    queryFn: async () => {
                        const res = await fetch(`/js/config/${courseId}.json`);
                        if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
                        return res.json();
                    },
                    staleTime: Infinity,
                });
                const userData = appStore.getState().userData;
                const englishLevel = data.languageLevel || 'A0';
                normalizeConfig(data, userData?.native_language);
                appStore.getState().setCourseData({ courseId, configData: data, englishLevel });
                setConfigReady(true);
            } catch (err) {
                console.error('[AppLayout] Config fetch error:', err);
                appStore.getState().setCriticalErrorMessage('Failed to load course configuration.');
                setConfigReady(true);
            }
        };
        fetchConfig();
    }, [courseId, configData, configReady]);

    const isReady = bootState === 'ready' && (configReady || configData);

    return (
        <>
            <Preloader />
            {isReady ? <Outlet /> : null}
        </>
    );
}
