import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSyncExternalStore } from 'react';
import { appStore } from '../modules/store.js';
import { simpleVideoPlayer } from './simple-video-player.js';

function portalTarget() {
    return document.getElementById('simple-video-container');
}

function setSimpleVideoContainerVisible(visible) {
    const el = document.getElementById('simple-video-container');
    if (el) el.classList.toggle('d-none', !visible);
}

export default function SimpleVideoWrapper() {
    const containerRef = useRef(null);
    const playerInstance = useRef(null);

    const currentVideo = useSyncExternalStore(
        appStore.subscribe,
        () => appStore.getState().currentVideo
    );

    useEffect(() => {
        if (!currentVideo || currentVideo.type !== 'simple') {
            setSimpleVideoContainerVisible(false);
            if (playerInstance.current) {
                playerInstance.current.destroy();
                playerInstance.current = null;
                appStore.getState().setCurrentVideoPlayer(null);
                window.currentSimpleVideoPlayer = null;
                appStore.getState().setMediaVisible(false);
            }
            return;
        }

        setSimpleVideoContainerVisible(true);
        appStore.getState().setMediaVisible(true);

        if (!containerRef.current || playerInstance.current) return;

        const uniqueId = `svp-container-${Math.random().toString(36).substr(2, 9)}`;
        containerRef.current.id = uniqueId;

        const mergedConfig = {
            ...currentVideo.config,
            videoUrl: currentVideo.url,
            containerSelector: `#${uniqueId}`
        };

        const player = new simpleVideoPlayer(mergedConfig);
        playerInstance.current = player;
        appStore.getState().setCurrentVideoPlayer(player);
        window.currentSimpleVideoPlayer = player;

        try {
            const videoEl = player.video;
            videoEl.muted = false;
            const checkAndPlay = () => {
                const preloader = document.getElementById('appLoadingImageDiv');
                if (preloader && preloader.style.display !== 'none') {
                    setTimeout(checkAndPlay, 100);
                    return;
                }
                try {
                    const playPromise = player.play();
                    if (playPromise !== undefined) playPromise.catch(() => { });
                } catch (e) { }
            };
            setTimeout(checkAndPlay, 200);
        } catch (e) { }

        return () => {
            setSimpleVideoContainerVisible(false);
            if (playerInstance.current) {
                playerInstance.current.destroy();
                playerInstance.current = null;
                appStore.getState().setCurrentVideoPlayer(null);
                window.currentSimpleVideoPlayer = null;
            }
        };
    }, [currentVideo]);

    const target = portalTarget();
    const isActive = currentVideo && currentVideo.type === 'simple';

    return target && isActive ? createPortal(
        <div ref={containerRef} className="video-wrapper" style={{ width: '100%', height: '100%' }}></div>,
        target
    ) : null;
}
