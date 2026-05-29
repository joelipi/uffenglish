import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';
import { SimpleVideoStateController } from '../modules/simple-video-controller.js';

export function useSimpleVideo() {
    const currentVideo = useStore(appStore, (s) => s.currentVideo);
    const isActive = currentVideo?.type === 'simple';

    // Track previous config values to avoid recreating controller on every render
    const prevConfigRef = useRef(null);
    const controllerRef = useRef(null);
    const [subtitleText, setSubtitleText] = useState('');
    const [isTimedSubtitles, setIsTimedSubtitles] = useState(false);
    const [scrollRatio, setScrollRatio] = useState(0);

    const config = isActive ? { ...currentVideo.config, videoUrl: currentVideo.url } : null;
    const prevConfig = prevConfigRef.current;
    const configChanged = config?.videoUrl !== prevConfig?.videoUrl || config?.subtitles !== prevConfig?.subtitles;

    useEffect(() => {
        if (!config || !configChanged) return;

        if (controllerRef.current) {
            controllerRef.current = null;
        }

        const controller = new SimpleVideoStateController(config);
        controller.initSubtitles(config.subtitles);
        setSubtitleText(controller.state.activeSubtitleText);
        setIsTimedSubtitles(controller.state.isTimedSubtitles);
        setScrollRatio(controller.state.scrollRatio);
        prevConfigRef.current = config;

        const unsub = controller.subscribe((state) => {
            setSubtitleText(state.activeSubtitleText);
            setIsTimedSubtitles(state.isTimedSubtitles);
            setScrollRatio(state.scrollRatio);
        });
        controllerRef.current = controller;

        return () => {
            unsub();
            controllerRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config?.videoUrl, config?.subtitles]);

    const updateProgress = useCallback((currentTime, duration) => {
        if (controllerRef.current) {
            controllerRef.current.updateProgress(currentTime, duration);
        }
    }, []);

    return { isActive, config, subtitleText, isTimedSubtitles, scrollRatio, updateProgress };
}
