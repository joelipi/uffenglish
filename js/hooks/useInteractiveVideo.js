// js/hooks/useInteractiveVideo.js

import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';
import { InteractiveVideoStateController } from '../modules/interactive-video-controller.js';

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

    const config = useMemo(() => {
        if (!isActive) return null;
        return {
            ...currentVideo.config,
            videoUrl: currentVideo.url,
            onRepetition: () => {
                appStore.getState().deductListeningScore(10);
                appStore.getState().setPointLossAmount(10);
            },
            onWordReveal: () => {
                appStore.getState().deductListeningScore(15);
                appStore.getState().setPointLossAmount(15);
            },
        };
// eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isActive, currentVideo?.url, typeof currentVideo?.config?.cue === 'object' ? currentVideo?.config?.cue?.en : currentVideo?.config?.cue]);
    useEffect(() => {
        if (!config) return;

        console.log("🛠️ CONTROLLER BUILT"); // <--- ADD THIS

        const controller = new InteractiveVideoStateController(config);
        stateSnapshotRef.current = { ...controller.state };

        const unsub = controller.subscribe((state) => {
            stateSnapshotRef.current = { ...state };

            if (state.isPlaying && requestPlayRef.current) {
                requestPlayRef.current();
            }
            forceUpdate();
        });

        controllerRef.current = controller;

        return () => {
            console.log("🗑️ CONTROLLER DESTROYED"); // <--- ADD THIS
            unsub();
            controller.destroy(); // Neutralize timers/callbacks
            controllerRef.current = null;
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

    const dismissOverlay = useCallback(() => {
        controllerRef.current?.dismissOverlay();
    }, []);

    const pauseWithOverlayCancel = useCallback(() => {
        controllerRef.current?.cancelOverlayTimer();
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
        const stepType = appStore.getState().currentVideo?.stepType ?? '';
        if (
            appStore.getState().videoPlays > 2 &&
            (stepType === 'closedResponse' || stepType === 'openResponse')
        ) {
            appStore.getState().deductListeningScore(10);
            appStore.getState().setPointLossAmount(10);
        }
    }, []);

    const handleWrapperTap = useCallback(() => {
        if (stateSnapshotRef.current.showOverlay) {
            dismissOverlay();
            return false;
        }

        appStore.getState().incrementVideoClicks();
        const stepType = appStore.getState().currentVideo?.stepType ?? '';
        if (
            appStore.getState().videoClicks % 2 === 1 &&
            (stepType === 'closedResponse' || stepType === 'openResponse')
        ) {
            clickTriggeredPlayRef.current = true;
            appStore.getState().deductListeningScore(15);
            appStore.getState().setPointLossAmount(15);
        }

        return true;
    }, [dismissOverlay]);

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
    };
}