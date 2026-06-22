// js/hooks/useInteractiveVideo.js

import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store/store.js';
import { InteractiveVideoStateController } from '../modules/video/interactive-video-controller.js';
import { trackEvent } from '../modules/utils/posthog.js';

export function useInteractiveVideo() {
    const currentVideo = useStore(appStore, (s) => s.currentVideo);
    const isActive = currentVideo?.type === 'interactive';

    const controllerRef = useRef(null);
    const requestPlayRef = useRef(null);
    const clickTriggeredPlayRef = useRef(false);

    const [, setRenderCount] = useState(0);
    const forceUpdate = useCallback(() => setRenderCount(n => n + 1), []);

    const stateSnapshotRef = useRef({
        isLoaded:       false,
        subtitleTokens: [],
        playbackRate:   1,
        showOverlay:    false,
        isSlowMode:     false,
        isPlaying:      false,
    });
    const prevShowOverlayRef = useRef(false);

    const config = useMemo(() => {
        if (!isActive) return null;
        return {
            ...currentVideo.config,
            interactiveVideoUrl: currentVideo.url,
            onWordReveal: () => {
                appStore.getState().deductListeningScore(15);
                appStore.getState().setPointLossAmount(15);
            },
        };
// eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isActive, currentVideo?.url, typeof currentVideo?.config?.cue === 'object' ? currentVideo?.config?.cue?.en : currentVideo?.config?.cue]);
    useEffect(() => {
        if (!config) return;

        const controller = new InteractiveVideoStateController(config);
        stateSnapshotRef.current = { ...controller.state };

        const unsub = controller.subscribe((state) => {
            stateSnapshotRef.current = { ...state };
            appStore.getState().setOverlayVisible(state.showOverlay);

            if (state.showOverlay && !prevShowOverlayRef.current) {
                const responseType = currentVideo?.responseType;
                const phase = responseType === 'closedResponse'
                    ? 'interactiveVideo-decisionTime-closedResponse'
                    : 'interactiveVideo-decisionTime-openResponse';
                appStore.getState().transitionTo(phase);
            }
            prevShowOverlayRef.current = state.showOverlay;

            if (state.isPlaying && requestPlayRef.current) {
                requestPlayRef.current();
            }
            forceUpdate();
        });

        controllerRef.current = controller;

        return () => {
            unsub();
            controller.destroy(); // Neutralize timers/callbacks
            controllerRef.current = null;
            prevShowOverlayRef.current = false;
        };
    }, [config, forceUpdate]);

    const setLoaded = useCallback(() => {
        controllerRef.current?.setLoaded();
    }, []);

    const handleLoop = useCallback(() => {
        controllerRef.current?.handleLoop();
    }, []);

    const handlePause = useCallback(() => {
        controllerRef.current?.pause();
    }, []);

    const revealToken = useCallback((index) => {
        controllerRef.current?.revealToken(index);
    }, []);

    const applySpeechResult = useCallback((correctIndices, wrongIndices, extraWrongWords) => {
        controllerRef.current?.applySpeechResult(correctIndices, wrongIndices, extraWrongWords);
    }, []);

    const dismissOverlay = useCallback((options) => {
        controllerRef.current?.dismissOverlay(options);
    }, []);

    const pauseWithOverlayCancel = useCallback(() => {
        controllerRef.current?.pause();
    }, []);

    const handleVideoPlay = useCallback(() => {
        if (clickTriggeredPlayRef.current) {
            clickTriggeredPlayRef.current = false;
            controllerRef.current?.play();
            return;
        }

        controllerRef.current?.play();

        appStore.getState().incrementVideoPlays();
        const responseType = appStore.getState().currentVideo?.responseType ?? '';
        if (
            appStore.getState().videoPlays > 1 &&
            (responseType === 'closedResponse' || responseType === 'openResponse')
        ) {
            appStore.getState().deductListeningScore(10);
            appStore.getState().setPointLossAmount(10);
        }
    }, []);

    const handleWrapperTap = useCallback(() => {
        if (stateSnapshotRef.current.showOverlay) {
            return false;
        }
        if (appStore.getState().isMicActive || appStore.getState().textInputVisible) {
            return false;
        }

        appStore.getState().incrementVideoClicks();
        const responseType = appStore.getState().currentVideo?.responseType ?? '';
        if (
            appStore.getState().videoClicks % 2 === 1 &&
            (responseType === 'closedResponse' || responseType === 'openResponse')
        ) {
            clickTriggeredPlayRef.current = true;
            appStore.getState().deductListeningScore(15);
            appStore.getState().setPointLossAmount(15);
        }

        return true;
    }, []);

    return {
        isActive,
        config,
        get isLoaded()       { return stateSnapshotRef.current.isLoaded; },
        get subtitleTokens() { return stateSnapshotRef.current.subtitleTokens; },
        get playbackRate()   { return stateSnapshotRef.current.playbackRate; },
        get showOverlay()    { return stateSnapshotRef.current.showOverlay; },
        get isSlowMode()     { return stateSnapshotRef.current.isSlowMode; },
        // Bridge: answer-pipeline's applySpeechResultToPlayer needs access
        // to the controller's token list and punctuation map.
        get tokens()         { return controllerRef.current?.tokens || []; },
        get punctuationMap() { return controllerRef.current?.punctuationMap || new Map(); },
        requestPlayRef,
        setLoaded,
        handleLoop,
        handlePause,
        revealToken,
        applySpeechResult,
        pauseWithOverlayCancel,
        handleVideoPlay,
        handleWrapperTap,
        dismissOverlay,
    };
}