import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSyncExternalStore } from 'react';
import { appStore } from '../modules/store.js';
import { InteractiveVideoPlayer } from './interactive-video-player.js';
import { pointLoss } from './point-loss-animation.js';

function portalTarget() {
    return document.getElementById('ivp-container');
}

function setIvpContainerVisible(visible) {
    const el = document.getElementById('ivp-container');
    if (el) el.classList.toggle('d-none', !visible);
}

export default function InteractiveVideoWrapper() {
    const containerRef = useRef(null);
    const playerInstance = useRef(null);
    const clickTriggeredPlayRef = useRef(false);

    const currentVideo = useSyncExternalStore(
        appStore.subscribe,
        () => appStore.getState().currentVideo
    );

    useEffect(() => {
        if (!currentVideo || currentVideo.type !== 'interactive') {
            setIvpContainerVisible(false);
            if (playerInstance.current) {
                playerInstance.current.destroy();
                playerInstance.current = null;
                appStore.getState().setCurrentVideoPlayer(null);
                appStore.getState().setMediaVisible(false);
            }
            return;
        }

        setIvpContainerVisible(true);
        appStore.getState().setMediaVisible(true);

        if (!containerRef.current || playerInstance.current) return;

        const uniqueId = `ivp-container-${Math.random().toString(36).substr(2, 9)}`;
        containerRef.current.id = uniqueId;

        const mergedConfig = {
            ...currentVideo.config,
            videoUrl: currentVideo.url,
            containerSelector: `#${uniqueId}`,
            onRepetition: () => {
                appStore.getState().deductListeningScore(10);
                const scoreEl = document.getElementById('listeningScore');
                if (scoreEl) pointLoss.show(scoreEl, 10);
            },
            onWordReveal: (index) => {
                appStore.getState().deductListeningScore(15);
                const scoreEl = document.getElementById('listeningScore');
                if (scoreEl) pointLoss.show(scoreEl, 15);
            }
        };

        const player = new InteractiveVideoPlayer(mergedConfig);
        playerInstance.current = player;
        appStore.getState().setCurrentVideoPlayer(player);

        try {
            const videoEl = player.video;
            videoEl.muted = false;
            videoEl.setAttribute('playsinline', '');

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

        player.video.addEventListener('playing', () => player.video.controls = false);

        clickTriggeredPlayRef.current = false;
        const playHandler = () => {
            if (window.isMicActive) {
                player.video.pause();
                return;
            }
            if (clickTriggeredPlayRef.current) {
                clickTriggeredPlayRef.current = false;
                return;
            }
            appStore.getState().incrementVideoPlays();
            const stepType = currentVideo.stepType || '';
            if (appStore.getState().videoPlays > 2 && (stepType === 'closedResponse' || stepType === 'openResponse')) {
                appStore.getState().deductListeningScore(10);
                pointLoss.show(player.video, 10);
            }
        };
        player.video.addEventListener('play', playHandler);

        const clickHandler = () => {
            appStore.getState().incrementVideoClicks();
            const stepType = currentVideo.stepType || '';
            if (appStore.getState().videoClicks % 2 === 1 && (stepType === 'closedResponse' || stepType === 'openResponse')) {
                clickTriggeredPlayRef.current = true;
                appStore.getState().deductListeningScore(15);
                pointLoss.show(player.video, 15);
            }
        };
        player.video.addEventListener('click', clickHandler);

        return () => {
            if (player.video) {
                player.video.removeEventListener('play', playHandler);
                player.video.removeEventListener('click', clickHandler);
            }
            if (playerInstance.current) {
                playerInstance.current.destroy();
                playerInstance.current = null;
                appStore.getState().setCurrentVideoPlayer(null);
            }
        };
    }, [currentVideo]);

    const target = portalTarget();
    const isActive = currentVideo && currentVideo.type === 'interactive';

    return target && isActive ? createPortal(
        <div ref={containerRef} className="video-wrapper" style={{ width: '100%', height: '100%' }}></div>,
        target
    ) : null;
}
