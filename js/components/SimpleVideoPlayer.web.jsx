import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';
import { useSimpleVideo } from '../hooks/useSimpleVideo.js';

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(navigator.userAgent);

export default function SimpleVideoPlayer() {
    const { isActive, config, subtitleText, isTimedSubtitles, scrollRatio, updateProgress } = useSimpleVideo();
    const mediaVisible = useStore(appStore, (s) => s.mediaVisible);
    const videoRef = useRef(null);
    const subtitleContainerRef = useRef(null);
    const subtitleDisplayRef = useRef(null);
    const posterCanvasRef = useRef(null);
    const [playing, setPlaying] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [poster, setPoster] = useState(null);
    const [scrollOffset, setScrollOffset] = useState(0);

    // Store player reference for external pause/play
    useEffect(() => {
        if (!isActive) {
            appStore.getState().setCurrentVideoPlayer(null);
            return;
        }
        appStore.getState().setMediaVisible(true);
        const player = {
            pause: () => videoRef.current?.pause(),
            play: () => videoRef.current?.play(),
            get video() { return videoRef.current; },
            destroy: () => {
                console.warn('[SVP] destroy called');
                const v = videoRef.current;
                if (v) { v.pause(); }
            }
        };
        appStore.getState().setCurrentVideoPlayer(player);
        return () => {
            appStore.getState().setMediaVisible(false);
            appStore.getState().setCurrentVideoPlayer(null);
        };
    }, [isActive]);

    // Video source and poster
    useEffect(() => {
        console.warn('[SVP videoSrc] effect running', { isActive, hasRef: !!videoRef.current, hasConfig: !!config, videoUrl: config?.videoUrl });
        if (!isActive || !videoRef.current || !config) return;
        const video = videoRef.current;
        video.src = config.videoUrl;
        console.warn('[SVP videoSrc] src set to', video.src);

        // iOS: transparent poster to avoid black frame flash
        if (isIOS) {
            setPoster('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');
        }

        // Android: disable MediaSession to prevent lockscreen takeover
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
            const clearHandlers = ['play', 'playing', 'loadstart', 'canplay'].map(evt => {
                video.addEventListener(evt, clearMs);
                return { evt, fn: clearMs };
            });

            let msInterval;
            const onPlayMs = () => {
                if ('mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = 'none';
                    navigator.mediaSession.metadata = null;
                    msInterval = setInterval(() => {
                        try {
                            navigator.mediaSession.playbackState = 'none';
                            navigator.mediaSession.metadata = null;
                        } catch (e) { }
                    }, 100);
                }
            };
            const onPauseMs = () => {
                if (msInterval) clearInterval(msInterval);
                msInterval = null;
                if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
            };
            video.addEventListener('play', onPlayMs);
            video.addEventListener('pause', onPauseMs);
            video.addEventListener('ended', onPauseMs);

            // Prevent Android lockscreen from showing duration-based controls
            Object.defineProperty(video, 'duration', { get: () => NaN, configurable: true });
            video.title = '';

            video._msCleanup = () => {
                if (msInterval) clearInterval(msInterval);
                clearHandlers.forEach(h => video.removeEventListener(h.evt, h.fn));
                video.removeEventListener('play', onPlayMs);
                video.removeEventListener('pause', onPauseMs);
                video.removeEventListener('ended', onPauseMs);
            };
        }

        let foucFallback = null;

        const onLoad = () => {
            video.removeEventListener('loadeddata', onLoad);
            video.removeEventListener('canplay', onLoad);
            if (!loaded) setLoaded(true);
            if (foucFallback) clearTimeout(foucFallback);
            if (!isIOS && posterCanvasRef.current && video.videoWidth) {
                try {
                    const canvas = posterCanvasRef.current;
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    canvas.getContext('2d').drawImage(video, 0, 0);
                    setPoster(canvas.toDataURL('image/jpeg', 0.8));
                } catch (e) {
                    setPoster('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');
                }
            }
        };
        video.addEventListener('loadeddata', onLoad);
        video.addEventListener('canplay', onLoad);
        foucFallback = setTimeout(onLoad, 3000);

        return () => {
            console.warn('[SVP videoSrc] cleanup running');
            video.removeEventListener('loadeddata', onLoad);
            video.removeEventListener('canplay', onLoad);
            if (foucFallback) clearTimeout(foucFallback);
            if (video._msCleanup) { video._msCleanup(); video._msCleanup = null; }
        };
    }, [isActive, config?.videoUrl]);

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
        if (appStore.getState().reactReady) {
            tryPlay();
        } else {
            const unsub = appStore.subscribe((state) => {
                if (state.reactReady) {
                    unsub();
                    tryPlay();
                }
            });
            return unsub;
        }
    }, [isActive]);

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
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onTimeUpdate={() => {
                        const v = videoRef.current;
                        if (v) updateProgress(v.currentTime, v.duration);
                    }}
                    onSeeked={() => {
                        const v = videoRef.current;
                        if (v) updateProgress(v.currentTime, v.duration);
                    }}
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
