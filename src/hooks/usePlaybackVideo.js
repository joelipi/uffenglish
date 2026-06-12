import { useStore } from 'zustand';
import { appStore } from '../modules/store/store.js';

export function usePlaybackVideo() {
    const blob = useStore(appStore, (s) => s.playbackBlob);
    const autoplay = useStore(appStore, (s) => s.playbackAutoplay);
    const isMuted = useStore(appStore, (s) => s.isPlaybackMuted);
    const videoPlayTrigger = useStore(appStore, (s) => s.videoPlayTrigger);
    const videoClearTrigger = useStore(appStore, (s) => s.videoClearTrigger);
    const mediaState = useStore(appStore, (s) => s.mediaState);
    const visible = !!blob && mediaState !== 'chat';

    const toggleMute = () => appStore.getState().setPlaybackMuted(!isMuted);
    const clearVideo = () => appStore.getState().clearPlaybackBlob();

    return { blob, autoplay, isMuted, visible, toggleMute, clearVideo, videoPlayTrigger, videoClearTrigger, mediaState };
}
