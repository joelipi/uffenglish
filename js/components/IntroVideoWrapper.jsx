import React, { useEffect, useRef } from 'react';
import { useSyncExternalStore } from 'react';
import { appStore } from '../modules/store.js';
import { introBackgroundVideo } from './intro-background-video.js';

function setIntroCallWidgetVisible(visible) {
    const el = document.getElementById('intro-call-widget');
    if (el) el.classList.toggle('d-none', !visible);
}

export default function IntroVideoWrapper() {
    const playerInstance = useRef(null);

    const currentVideo = useSyncExternalStore(
        appStore.subscribe,
        () => appStore.getState().currentVideo
    );

    useEffect(() => {
        if (!currentVideo || currentVideo.type !== 'intro') {
            setIntroCallWidgetVisible(false);
            if (playerInstance.current) {
                playerInstance.current.destroy();
                playerInstance.current = null;
                appStore.getState().setCurrentVideoPlayer(null);
                window.currentIntroVideoPlayer = null;
                appStore.getState().setMediaVisible(false);
            }
            return;
        }

        setIntroCallWidgetVisible(true);
        appStore.getState().setMediaVisible(true);

        if (playerInstance.current) return;

        const mergedConfig = {
            ...currentVideo.config,
            videoUrl: currentVideo.url
        };

        const player = new introBackgroundVideo(mergedConfig);
        playerInstance.current = player;
        appStore.getState().setCurrentVideoPlayer(player);
        window.currentIntroVideoPlayer = player;

        return () => {
            setIntroCallWidgetVisible(false);
            if (playerInstance.current) {
                playerInstance.current.destroy();
                playerInstance.current = null;
                appStore.getState().setCurrentVideoPlayer(null);
                window.currentIntroVideoPlayer = null;
            }
        };
    }, [currentVideo]);

    return null;
}
