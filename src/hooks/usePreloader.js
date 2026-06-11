import { useCallback } from 'react';
import { appStore } from '../modules/store/store.js';

// Module-level interval reference so Preloader and routes share the same pulse
let _progressInterval = null;

export function usePreloader() {
    const ensurePreloader = useCallback(() => {
        appStore.getState().setPreloaderProgress(0);
        appStore.getState().setPreloaderVisible(true);
    }, []);

    const startProgressPulse = useCallback(() => {
        if (_progressInterval) return;
        _progressInterval = setInterval(() => {
            const current = appStore.getState().preloaderProgress;
            const next = current + (95 - current) * 0.05;
            appStore.getState().setPreloaderProgress(next);
        }, 100);
    }, []);

    const finishPreloader = useCallback(() => {
        if (_progressInterval) {
            clearInterval(_progressInterval);
            _progressInterval = null;
        }
        appStore.getState().setPreloaderProgress(100);
        setTimeout(() => {
            appStore.getState().setPreloaderVisible(false);
        }, 550);
    }, []);

    return { ensurePreloader, startProgressPulse, finishPreloader };
}
