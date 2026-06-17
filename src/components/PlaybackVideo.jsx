import { useEffect, useRef } from 'react';
import { appStore } from '../modules/store/store.js';
import { usePlaybackVideo } from '../hooks/usePlaybackVideo.js';

// Intentional navigator sniff — guarded with typeof checks. In React Native
// navigator is undefined → isIOS is false (native video player handles iOS specifics).
const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export default function PlaybackVideo() {
    const { blob, autoplay, isMuted, visible, clearVideo, videoPlayTrigger, videoClearTrigger, mediaState } = usePlaybackVideo();

    const videoRef = useRef(null);
    const observerRef = useRef(null);
    const prevClearTrigger = useRef(videoClearTrigger);
    const prevPlayTrigger = useRef(videoPlayTrigger);

    const handleVideoEnded = () => {
        const video = videoRef.current;
        if (!video) return;
        video.muted = true;
        video.loop = true;
        appStore.getState().setPlaybackMuted(true);
        video.play().catch(e => console.warn('[playback] replay after mute failed:', e));
    };

    const handleVideoError = () => {
        const video = videoRef.current;
        if (!video) return;
        try {
            const alternativeBlob = new Blob([blob], { type: 'video/mp4' });
            video.src = URL.createObjectURL(alternativeBlob);
        } catch (e) { }
    };

    const handleLoadedMetadata = () => {
        const video = videoRef.current;
        if (!video) return;
        if (mediaState !== 'chat' && autoplay) {
            video.muted = false;
            appStore.getState().setPlaybackMuted(false);
            video.play().catch(e => {
                if (e.name === 'NotAllowedError') {
                    appStore.getState().setPlaybackMuted(true);
                    video.muted = true;
                    video.play().catch(err => console.error('[Playback] muted fallback failed:', err));
                }
            });
        }
        if (observerRef.current) observerRef.current.disconnect();
        observerRef.current = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting && !video.paused) {
                    video.pause();
                }
            });
        }, { threshold: 0.1 });
        requestAnimationFrame(() => {
            if (observerRef.current && video) {
                observerRef.current.observe(video);
            }
        });
    };

    // Blob URL management
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        if (!blob) {
            video.pause();
            if (video.src && video.src.startsWith('blob:')) {
                URL.revokeObjectURL(video.src);
            }
            video.src = '';
            video.load();
            return;
        }

        if (video.src && video.src.startsWith('blob:')) {
            URL.revokeObjectURL(video.src);
        }

        video.src = URL.createObjectURL(blob);

        return () => {
            if (video.src && video.src.startsWith('blob:')) {
                URL.revokeObjectURL(video.src);
            }
        };
    }, [blob]);

    // Clear trigger
    useEffect(() => {
        if (videoClearTrigger === prevClearTrigger.current) return;
        prevClearTrigger.current = videoClearTrigger;
        clearVideo();
    }, [videoClearTrigger]);

    // Play trigger
    useEffect(() => {
        if (videoPlayTrigger === prevPlayTrigger.current) return;
        prevPlayTrigger.current = videoPlayTrigger;
        const video = videoRef.current;
        if (video) {
            video.muted = isMuted;
            video.play().catch(e => console.warn('[playback] Playback resume failed:', e));
        }
    }, [videoPlayTrigger]);

    // Pause when triggerPauseAllVideos fires
    useEffect(() => {
        const unsub = appStore.subscribe((state, prev) => {
            if (state.pauseAllVideosTrigger !== prev.pauseAllVideosTrigger) {
                videoRef.current?.pause();
            }
        });
        return unsub;
    }, []);

    if (!blob) return null;

    return (
        <div id="playback-video-wrapper"
            className={`playback-video-container position-absolute top-0 start-0 w-100 h-100 ${visible ? '' : 'd-none'}`}
            style={{ zIndex: 10 }}>
            <video ref={videoRef} id="playback-video" playsInline preload="auto" controls={isIOS} muted={isMuted} onEnded={handleVideoEnded} onError={handleVideoError} onLoadedData={() => {}} onLoadedMetadata={handleLoadedMetadata}
                onClick={() => {
                    const video = videoRef.current;
                    if (!video) return;
                    const next = !video.muted;
                    video.muted = next;
                    appStore.getState().setPlaybackMuted(next);
                }}
                style={{ cursor: 'pointer' }} />
        </div>
    );
}
