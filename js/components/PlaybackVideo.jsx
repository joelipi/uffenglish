import { useEffect, useRef } from 'react';
import { appStore } from '../modules/store.js';
import { usePlaybackVideo } from '../hooks/usePlaybackVideo.js';

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export default function PlaybackVideo() {
    const { blob, autoplay, isMuted, visible, clearVideo, videoPlayTrigger, videoClearTrigger, chatModeActive } = usePlaybackVideo();

    const videoRef = useRef(null);
    const observerRef = useRef(null);
    const prevClearTrigger = useRef(videoClearTrigger);
    const prevPlayTrigger = useRef(videoPlayTrigger);

    // Blob URL management
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !blob) return;

        if (video.src && video.src.startsWith('blob:')) {
            URL.revokeObjectURL(video.src);
        }

        if (isIOS) {
            video.controls = true;
            video.loop = true;
            const url = URL.createObjectURL(blob);
            video.onerror = () => {
                try {
                    const alternativeBlob = new Blob([blob], { type: 'video/mp4' });
                    video.src = URL.createObjectURL(alternativeBlob);
                } catch (e) { }
            };
            video.src = url;
            video.onloadeddata = () => { };
        } else {
            video.src = URL.createObjectURL(blob);
            video.onerror = null;
        }

        video.controls = false;
        video.loop = true;
        video.autoplay = false;
        video.preload = 'auto';
        video.muted = isMuted;

        // Toggle mute on click (matches VideoBubble behavior)
        const onToggleMute = () => {
            const next = !video.muted;
            video.muted = next;
            appStore.getState().setPlaybackMuted(next);
        };
        video.addEventListener('click', onToggleMute);

        video.onloadedmetadata = () => {
            if (!chatModeActive && autoplay) {
                video.play().catch(e => {
                    if (e.name === 'NotAllowedError') {
                        appStore.getState().setPlaybackMuted(true);
                        video.muted = true;
                        video.play().catch(err => console.error('[Playback] muted fallback failed:', err));
                    }
                });
            }

            // Restart IntersectionObserver
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

        return () => {
            video.removeEventListener('click', onToggleMute);
            video.onloadedmetadata = null;
            video.onerror = null;
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
            className={`playback-video-container ${visible ? '' : 'd-none'}`}
            style={{ position: 'absolute', top: '15%', left: 0, right: 0, zIndex: 10 }}>
            <video ref={videoRef} id="playback-video" playsInline preload="auto" loop
                style={{ cursor: 'pointer' }} />
        </div>
    );
}
