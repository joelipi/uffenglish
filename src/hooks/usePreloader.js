import { useCallback } from 'react';
import { appStore } from '../modules/store/store.js';

// Module-level interval reference so Preloader and routes share the same pulse
let _progressInterval = null;
let _introVideoPollInterval = null;
const INTRO_VIDEO_SAFETY_TIMEOUT_MS = 15_000; // safety timeout — hide Preloader even if intro video never loads

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
        // Helper: actually fade out and remove the Preloader.
        const doFadeOut = () => {
            if (_progressInterval) {
                clearInterval(_progressInterval);
                _progressInterval = null;
            }
            appStore.getState().setPreloaderProgress(100);
            setTimeout(() => {
                appStore.getState().setPreloaderVisible(false);
            }, 550);
        };

        // Gate on poster (LQIP + jpg) for zero-ms rectangle. Video warms behind poster.
        const needsPoster = !appStore.getState().introPosterReady;
        if (!needsPoster) {
            // No intro poster to wait for — fade out immediately (also covers non-intro steps).
            doFadeOut();
            return;
        }

        // introPosterReady is false — keep the Preloader fully visible (progress bar
        // still pulsing) until the intro poster is decoded/painted, then fade out.
        // This guarantees the rectangle is never empty (LQIP/gradient already painted).
        console.log('[Preloader] Waiting for introPosterReady before fading out…');
        const startedAt = Date.now();
        _introVideoPollInterval = setInterval(() => {
            if (appStore.getState().introPosterReady) {
                clearInterval(_introVideoPollInterval);
                _introVideoPollInterval = null;
                console.log('[Preloader] introPosterReady=true — fading out now');
                doFadeOut();
            } else if (Date.now() - startedAt >= INTRO_VIDEO_SAFETY_TIMEOUT_MS) {
                clearInterval(_introVideoPollInterval);
                _introVideoPollInterval = null;
                console.warn('[Preloader] introPosterReady safety timeout reached — hiding Preloader');
                doFadeOut();
            }
        }, 100);
    }, []);

    return { ensurePreloader, startProgressPulse, finishPreloader };
}
