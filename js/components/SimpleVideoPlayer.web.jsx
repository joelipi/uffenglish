import { useEffect, useRef, useState, useLayoutEffect, useCallback } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';
import { useSimpleVideo } from '../hooks/useSimpleVideo.js';

const hasNavigator = typeof navigator !== 'undefined';
const isIOS = hasNavigator && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const isAndroid = hasNavigator && /Android/.test(navigator.userAgent);

export default function SimpleVideoPlayer() {
    const { isActive, config, subtitleText, isTimedSubtitles, scrollRatio, updateProgress } = useSimpleVideo();
    const mediaVisible = useStore(appStore, (s) => s.mediaVisible);
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
    const [answerStatus, setAnswerStatus] = useState(null);

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

    // Reset the video player's state when an incorrect answer is given
    useEffect(() => {
        if (answerStatus === 'incorrect') {
            setPlaying(false);
            setLoaded(false);
            setPoster(null);
            setScrollOffset(0);
            if (videoRef.current) {
                videoRef.current.pause();
                videoRef.current.currentTime = 0;
            }
        }
    }, [answerStatus]);

    // Ensure that the video player properly handles the transition between different video states when an incorrect answer is given
    useEffect(() => {
        if (answerStatus === 'incorrect') {
            setAnswerStatus(null);
        }
    }, [answerStatus]);

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

    // Update the answer status when an incorrect answer is given
    const handleIncorrectAnswer = useCallback(() => {
        setAnswerStatus('incorrect');
    }, []);

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
