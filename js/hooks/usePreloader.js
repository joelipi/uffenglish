import { useCallback, useEffect, useRef } from 'react';
import { appStore } from '../modules/store/store.js';

export function usePreloader() {
    const progressIntervalRef = useRef(null);

    const ensurePreloader = useCallback(() => {
        appStore.getState().setPreloaderProgress(0);
        appStore.getState().setPreloaderVisible(true);
    }, []);

    const startProgressPulse = useCallback(() => {
        if (progressIntervalRef.current) return;
        progressIntervalRef.current = setInterval(() => {
            const current = appStore.getState().preloaderProgress;
            const next = current + (95 - current) * 0.05;
            appStore.getState().setPreloaderProgress(next);
        }, 100);
    }, []);

    const finishPreloader = useCallback(() => {
        if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
        }
        appStore.getState().setPreloaderProgress(100);
        setTimeout(() => {
            appStore.getState().setPreloaderVisible(false);
        }, 550);
    }, []);

    useEffect(() => {
        return () => {
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
            }
        };
    }, []);

    return { ensurePreloader, startProgressPulse, finishPreloader };
}
