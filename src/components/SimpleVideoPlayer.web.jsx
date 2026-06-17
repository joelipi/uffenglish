// SimpleVideoPlayer.web.jsx
// Web-only component — uses navigator.userAgent for iOS/Android detection.
// React Native replaces this with SimpleVideoPlayer.native.jsx.
import { useEffect, useRef, useState, useLayoutEffect, useCallback } from 'react';
import { useStore } from 'zustand';
import { appStore, setCurrentVideoPlayer } from '../modules/store/store.js';
import { useSimpleVideo } from '../hooks/useSimpleVideo.js';

const hasNavigator = typeof navigator !== 'undefined';
const isIOS = hasNavigator && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const isAndroid = hasNavigator && /Android/.test(navigator.userAgent);

export default function SimpleVideoPlayer() {
    const { isActive, config, subtitleText, isTimedSubtitles, scrollRatio, updateProgress } = useSimpleVideo();
    const mediaVisible = useStore(appStore, (s) => s.mediaVisible);
    const pendingVideoPlayType = useStore(appStore, (s) => s.pendingVideoPlayType);
    const videoRef = useRef(null);
    const subtitleContainerRef = useRef(null);
    const subtitleDisplayRef = useRef(null);
    const posterCanvasRef = useRef(null);
    const msIntervalRef = useRef(null);
    const foucFallbackRef = useRef(null);
    const [playing, setPlaying] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [poster, setPoster] = useState(null);
    const [scrollOffset, setScrollOffset] = useState(0);
    // Store player reference for external pause/play
    // Conforms to VideoPlayerHandle — same contract as InteractiveVideoPlayer
    // so the platform-agnostic answer pipeline can drive both uniformly.
    useEffect(() => {
        if (!isActive) {
            const currType = appStore.getState().currentVideo?.type;
            if (currType !== 'interactive') {
                setCurrentVideoPlayer(null);
            }
            return;
        }
        appStore.getState().setMediaVisible(true);
        const player = {
            pause: () => videoRef.current?.pause(),
            play: () => videoRef.current?.play(),
            get video() { return videoRef.current; },
            destroy: () => {
                const v = videoRef.current;
                if (v) { v.pause(); }
            },
            replay: () => {
                const el = videoRef.current;
                if (el) el.currentTime = 0;
                setTimeout(() => {
                    videoRef.current?.play()?.catch(() => {});
                }, 50);
            },
        };
        setCurrentVideoPlayer(player);
        return () => {
            appStore.getState().setMediaVisible(false);
            const currType = appStore.getState().currentVideo?.type;
            if (currType !== 'interactive') {
                setCurrentVideoPlayer(null);
            }
        };
    }, [isActive]);

    // iOS transparent poster, Android MediaSession cleanup, fouc fallback timeout
    useEffect(() => {
        if (!isActive) return;

        if (isIOS) {
            setPoster('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');
        }

        if (isAndroid) {
            const clearMs = () => {
                try {
                    navigator.mediaSession.metadata = null;
                    navigator.mediaSession.playbackState = 'none';
                    ['play','pause','stop','seekbackward','seekforward','seekto','previoustrack','nexttrack','skipad'].forEach(a => {
                        try { navigator.mediaSession.setActionHandler(a, null); } catch (e) { }
                    });
                } catch (e) { }
            };
            clearMs();
        }

        foucFallbackRef.current = setTimeout(() => {
            if (!loaded) setLoaded(true);
        }, 3000);

        return () => {
            if (foucFallbackRef.current) clearTimeout(foucFallbackRef.current);
            if (msIntervalRef.current) clearInterval(msIntervalRef.current);
        };
    }, [isActive]);

    const handleVideoLoaded = useCallback(() => {
        if (!loaded) setLoaded(true);
        if (foucFallbackRef.current) clearTimeout(foucFallbackRef.current);
        if (!isIOS && posterCanvasRef.current && videoRef.current?.videoWidth) {
            try {
                const canvas = posterCanvasRef.current;
                const video = videoRef.current;
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                canvas.getContext('2d').drawImage(video, 0, 0);
                setPoster(canvas.toDataURL('image/jpeg', 0.8));
            } catch (e) {
                setPoster('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');
            }
        }
        if (isAndroid) {
            try {
                navigator.mediaSession.metadata = null;
                navigator.mediaSession.playbackState = 'none';
            } catch (e) { }
        }
    }, [loaded]);

    const handlePlay = useCallback(() => {
        setPlaying(true);
        if (isAndroid) {
            try {
                navigator.mediaSession.playbackState = 'none';
                navigator.mediaSession.metadata = null;
                msIntervalRef.current = setInterval(() => {
                    try {
                        navigator.mediaSession.playbackState = 'none';
                        navigator.mediaSession.metadata = null;
                    } catch (e) { }
                }, 100);
            } catch (e) { }
        }
    }, []);

    const handlePause = useCallback(() => {
        setPlaying(false);
        if (isAndroid) {
            if (msIntervalRef.current) {
                clearInterval(msIntervalRef.current);
                msIntervalRef.current = null;
            }
            try {
                navigator.mediaSession.playbackState = 'none';
            } catch (e) { }
        }
    }, []);

    const handleEnded = useCallback(() => {
        if (isAndroid) {
            if (msIntervalRef.current) {
                clearInterval(msIntervalRef.current);
                msIntervalRef.current = null;
            }
            try {
                navigator.mediaSession.playbackState = 'none';
            } catch (e) { }
        }
    }, []);

    const handleTimeUpdate = useCallback(() => {
        const v = videoRef.current;
        if (v) updateProgress(v.currentTime, v.duration);
    }, [updateProgress]);

    const handleSeeked = useCallback(() => {
        const v = videoRef.current;
        if (v) updateProgress(v.currentTime, v.duration);
    }, [updateProgress]);

    // Delayed play after React mount
    useEffect(() => {
        if (!isActive || !videoRef.current) return;

        const tryPlay = () => {
            const video = videoRef.current;
            const p = video.play();
            if (p !== undefined) {
                p.catch(() => {
                    video.muted = true;
                    video.play().then(() => {
                        setTimeout(() => { video.muted = false; }, 100);
                    }).catch(() => {});
                });
            }
        };

        let pendingCleanup = null;

        const attemptAutoplay = () => {
            const video = videoRef.current;
            if (!video) return;
            if (video.readyState >= 2) {
                tryPlay();
                return;
            }
            // readyState < 2: use 'canplay' (fires at readyState >= 2), not 'loadedmetadata'
            // (fires at readyState >= 1). If readyState is already 1, loadedmetadata has
            // already fired and won't fire again — canplay is the correct gate event.
            const onReady = () => {
                video.removeEventListener('canplay', onReady);
                clearTimeout(timeoutId);
                tryPlay();
            };
            const timeoutId = setTimeout(() => {
                video.removeEventListener('canplay', onReady);
                console.warn('[SimpleVideo] Video did not become ready within 10s.');
            }, 10000);
            video.addEventListener('canplay', onReady);
            pendingCleanup = () => {
                video.removeEventListener('canplay', onReady);
                clearTimeout(timeoutId);
            };
        };

        if (pendingVideoPlayType === 'simple') {
            appStore.getState().setPendingVideoPlayType(null);
            attemptAutoplay();
            return () => pendingCleanup?.();
        }
        if (appStore.getState().reactReady) {
            attemptAutoplay();
            return () => pendingCleanup?.();
        } else {
            const unsub = appStore.subscribe((state) => {
                if (state.reactReady) {
                    unsub();
                    attemptAutoplay();
                }
            });
            return () => {
                unsub();
                pendingCleanup?.();
            };
        }
    }, [isActive, pendingVideoPlayType]);

    // Compute scroll offset for scrolling subtitles
    useLayoutEffect(() => {
        const container = subtitleContainerRef.current;
        const display = subtitleDisplayRef.current;
        if (!container || !display || isTimedSubtitles) {
            setScrollOffset(0);
            return;
        }
        const containerHeight = container.offsetHeight;
        const contentHeight = display.scrollHeight;
        if (contentHeight <= containerHeight) {
            setScrollOffset(0);
            return;
        }
        const maxScroll = Math.max(0, contentHeight - containerHeight);
        setScrollOffset(scrollRatio * maxScroll);
    }, [subtitleText, scrollRatio, isTimedSubtitles]);

    const handleClick = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) video.play().catch(e => console.log('Play failed:', e));
        else video.pause();
    };

    if (!isActive || !mediaVisible) return null;

    const subtitleLines = subtitleText.split('\n');

    return (
        <div className="ivp-main-wrapper position-absolute top-0 start-0 w-100 h-100" onClick={handleClick} style={{ visibility: loaded ? 'visible' : 'hidden' }}>
            <div className="ivp-video-wrapper">
                <video ref={videoRef} className="ivp-video" playsInline disableRemotePlayback preload="metadata" crossOrigin="anonymous"
                    src={config?.videoUrl}
                    poster={poster}
                    {...(isAndroid ? { 'data-ambient': 'true' } : {})}
                    onLoadedData={handleVideoLoaded}
                    onCanPlay={handleVideoLoaded}
                    onPlay={handlePlay}
                    onPause={handlePause}
                    onEnded={handleEnded}
                    onTimeUpdate={handleTimeUpdate}
                    onSeeked={handleSeeked}
                />
                <canvas ref={posterCanvasRef} style={{ display: 'none' }} />
                <div className="ivp-blur-overlay" />
                {subtitleText && (
                <div ref={subtitleContainerRef} className={`ivp-subtitle-scroll-container${isTimedSubtitles ? ' timed-subtitles-container' : ''}`}>
                    <div ref={subtitleDisplayRef} className={`ivp-subtitles${isTimedSubtitles ? ' timed-subtitles' : ''}`}
                        style={!isTimedSubtitles ? { transform: `translateY(-${scrollOffset}px)`, transition: 'transform 0.1s linear' } : {}}>
                        {subtitleLines.map((line, i) => (
                            <span key={i}>{i > 0 && <br />}{line}</span>
                        ))}
                    </div>
                </div>
                )}
                {!playing && (
                    <div className="ivp-play-overlay">
                        <div className="ivp-play-icon-container">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
