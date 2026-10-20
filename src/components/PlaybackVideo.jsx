import { useEffect, useRef } from 'react';
import { appStore } from '../modules/store/store.js';
import { usePlaybackVideo } from '../hooks/usePlaybackVideo.js';
import { useVideoSpeed } from '../hooks/useVideoSpeed.js';
import { createAudioGuard } from '../modules/video/audio-guard.js';
import VideoSpeedToggle from './VideoSpeedToggle.jsx';

// Intentional navigator sniff — guarded with typeof checks. In React Native
// navigator is undefined → isIOS is false (native video player handles iOS specifics).
const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export default function PlaybackVideo() {
    const { blob, autoplay, isMuted, visible, clearVideo, videoPlayTrigger, videoClearTrigger, mediaState } = usePlaybackVideo();

    const videoRef = useRef(null);
    const observerRef = useRef(null);
    const prevClearTrigger = useRef(videoClearTrigger);
    const prevPlayTrigger = useRef(videoPlayTrigger);
    // The audio guard watches the element while the clip plays and repairs one
    // that ends up muted — the Android-only silent start of the recorded take
    // (stories/075-fix-android-silent-video-start).
    const audioGuardRef = useRef(null);
    // True while the clip is supposed to be SILENT. Two things make it so: the
    // learner tapped the clip to mute it, and the clip already played once and
    // now loops silently (hearing yourself twice is worse than hearing yourself
    // once). The guard must not fight either of them.
    const muteIntentRef = useRef(false);
    // Speed toggle (1x -> 0.8x -> 0.6x -> 1x), reset per recording.
    const [playbackRate, handleSpeedCycle] = useVideoSpeed(videoRef, blob);

    const handleVideoEnded = () => {
        const video = videoRef.current;
        if (!video) return;
        // The clip has played once with sound; from now on it loops silently.
        // The mute is intentional, so the audio guard must stand down.
        muteIntentRef.current = true;
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
            // A fresh clip is meant to be audible — unless the learner muted it
            // or it already looped once (then the silent state is intentional).
            if (!muteIntentRef.current) {
                video.muted = false;
                appStore.getState().setPlaybackMuted(false);
            }
            video.play().catch(e => {
                if (e.name === 'NotAllowedError') {
                    // Autoplay with sound was blocked. Play muted so the clip is
                    // at least visible, then unmute AND re-issue play(): a bare
                    // flag flip does not re-open the audio output on a browser
                    // that already tore it down (stories/075).
                    video.muted = true;
                    video.play().then(() => {
                        setTimeout(() => {
                            const el = videoRef.current;
                            if (!el) return;
                            el.muted = false;
                            const p = el.play();
                            if (p && typeof p.catch === 'function') p.catch(() => {});
                        }, 100);
                    }).catch(err => console.error('[Playback] muted fallback failed:', err));
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

    // The audio guard. It samples the element while the clip plays and repairs
    // one that ends up muted, and it logs the audio state so the next field
    // report names the mechanism (stories/075-fix-android-silent-video-start).
    useEffect(() => {
        const guard = createAudioGuard({
            getElement: () => videoRef.current,
            isExpectedAudible: () => !muteIntentRef.current,
            play: () => {
                const p = videoRef.current?.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            },
        });
        audioGuardRef.current = guard;
        return () => {
            guard.stop();
            audioGuardRef.current = null;
        };
    }, []);

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

        // A new clip starts audible: the learner has not muted it yet and it
        // has not looped once.
        muteIntentRef.current = false;

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
            // The store mirrors the learner's mute intent, so the guard reads
            // the same intent from here on.
            muteIntentRef.current = appStore.getState().isPlaybackMuted === true;
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
                onPlay={() => audioGuardRef.current?.start()}
                onPause={() => audioGuardRef.current?.stop()}
                onClick={() => {
                    const video = videoRef.current;
                    if (!video) return;
                    const next = !video.muted;
                    // The learner's own choice: the guard must not undo it.
                    muteIntentRef.current = next;
                    video.muted = next;
                    appStore.getState().setPlaybackMuted(next);
                }}
                style={{ cursor: 'pointer' }} />
            <VideoSpeedToggle rate={playbackRate} onCycle={handleSpeedCycle} />
        </div>
    );
}
