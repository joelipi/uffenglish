import React, { useEffect, useRef } from 'react';
import { appStore } from '../modules/store/store.js';
import { usePreloader } from '../hooks/usePreloader.js';
import HomeScreen from '../components/homescreen/HomeScreen.jsx';

export default function HomeRoute() {
    const { finishPreloader } = usePreloader();
    const finishedRef = useRef(false);

    useEffect(() => {
        if (appStore.getState().isWhisperReady || appStore.getState().isWhisperEngineFailed) {
            finishPreloader();
            return;
        }
        const unsubscribe = appStore.subscribe((state) => {
            if ((state.isWhisperReady || state.isWhisperEngineFailed) && !finishedRef.current) {
                finishedRef.current = true;
                finishPreloader();
            }
        });
        return unsubscribe;
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return <HomeScreen />;
}
