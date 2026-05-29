import React, { useEffect, useRef } from 'react';
import { useSyncExternalStore } from 'react';
import { appStore } from '../modules/store.js';
import { InteractiveVideoPlayer } from './interactive-video-player.js';

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
            if (playerInstance.current) {
                playerInstance.current.destroy();
                playerInstance.current = null;
                appStore.getState().setCurrentVideoPlayer(null);
                appStore.getState().setMediaVisible(false);
            }
            return;
        }

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
                appStore.getState().setPointLossAmount(10);
            },
            onWordReveal: (index) => {
                appStore.getState().deductListeningScore(15);
                appStore.getState().setPointLossAmount(15);
            }
        };

        const player = new InteractiveVideoPlayer(mergedConfig);
        playerInstance.current = player;
        appStore.getState().setCurrentVideoPlayer(player);

        try {
            const videoEl = player.video;
            videoEl.muted = false;
            videoEl.setAttribute('playsinline', '');

            const attemptPlay = () => {
                const p = player.play();
                if (p !== undefined) {
                    p.catch(() => {
                        videoEl.muted = true;
                        player.play().then(() => {
                            setTimeout(() => { videoEl.muted = false; }, 100);
                        }).catch(() => {});
                    });
                }
            };

            if (appStore.getState().reactReady) {
                attemptPlay();
            } else {
                const unsubReactReady = appStore.subscribe((state) => {
                    if (state.reactReady) {
                        unsubReactReady();
                        attemptPlay();
                    }
                });
            }
        } catch (e) { }

        player.video.addEventListener('playing', () => player.video.controls = false);

        clickTriggeredPlayRef.current = false;
        const playHandler = () => {
            if (appStore.getState().isMicActive) {
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
                appStore.getState().setPointLossAmount(10);
            }
        };
        player.video.addEventListener('play', playHandler);

        const clickHandler = () => {
            appStore.getState().incrementVideoClicks();
            const stepType = currentVideo.stepType || '';
            if (appStore.getState().videoClicks % 2 === 1 && (stepType === 'closedResponse' || stepType === 'openResponse')) {
                clickTriggeredPlayRef.current = true;
                appStore.getState().deductListeningScore(15);
                appStore.getState().setPointLossAmount(15);
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

    // Pause when triggerPauseAllVideos fires
    useEffect(() => {
        const unsub = appStore.subscribe((state, prev) => {
            if (state.pauseAllVideosTrigger !== prev.pauseAllVideosTrigger) {
                playerInstance.current?.pause?.();
            }
        });
        return unsub;
    }, []);

    const isActive = currentVideo && currentVideo.type === 'interactive';

    return isActive ? (
        <div ref={containerRef} className="video-wrapper"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
        </div>
    ) : null;
}
