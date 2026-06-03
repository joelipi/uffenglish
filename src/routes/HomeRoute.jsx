import React, { useEffect, useRef } from 'react';
import { appStore } from '../modules/store/store.js';
import { usePreloader } from '../hooks/usePreloader.js';
import HomeScreen from '../components/homescreen/HomeScreen.jsx';

export default function HomeRoute() {
    const { ensurePreloader, startProgressPulse, finishPreloader } = usePreloader();
    const finishedRef = useRef(false);
    const bootedRef = useRef(false);

    useEffect(() => {
        if (bootedRef.current) return;
        bootedRef.current = true;

        if (appStore.getState().isWhisperReady) return;

        ensurePreloader();
        startProgressPulse();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const unsubscribe = appStore.subscribe((state) => {
            if (state.isWhisperReady && !finishedRef.current) {
                finishedRef.current = true;
                finishPreloader();
            }
        });
        return unsubscribe;
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return <HomeScreen />;
}
