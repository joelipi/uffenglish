import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';
import { clearPlaybackVideo } from './playback.js';

export default function PlaybackManager() {
    const videoPlayTrigger = useStore(appStore, (state) => state.videoPlayTrigger);
    const videoPlayMuted = useStore(appStore, (state) => state.videoPlayMuted);
    const videoClearTrigger = useStore(appStore, (state) => state.videoClearTrigger);
    const prevVideoPlayTrigger = useRef(videoPlayTrigger);
    const prevVideoClearTrigger = useRef(videoClearTrigger);

    useEffect(() => {
        if (videoPlayTrigger === prevVideoPlayTrigger.current) return;
        prevVideoPlayTrigger.current = videoPlayTrigger;

        const video = document.getElementById('playback-video');
        if (video) {
            video.muted = videoPlayMuted;
            video.play().catch(e => console.warn('[playback] Playback resume failed:', e));
        }
    }, [videoPlayTrigger, videoPlayMuted]);

    useEffect(() => {
        if (videoClearTrigger === prevVideoClearTrigger.current) return;
        prevVideoClearTrigger.current = videoClearTrigger;
        clearPlaybackVideo();
    }, [videoClearTrigger]);

    return null;
}
