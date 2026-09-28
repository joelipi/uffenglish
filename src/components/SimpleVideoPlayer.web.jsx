// SimpleVideoPlayer.web.jsx
// Web-only component — uses navigator.userAgent for iOS/Android detection.
// React Native replaces this with SimpleVideoPlayer.native.jsx.
import { useEffect, useRef, useState, useLayoutEffect, useCallback, useMemo } from 'react';
import { useStore } from 'zustand';
import { appStore, setCurrentVideoPlayer } from '../modules/store/store.js';
import { useSimpleVideo } from '../hooks/useSimpleVideo.js';
import { getBilingual } from '../data/strings.js';
import { useNativeLanguage } from '../hooks/use-native-language.js';

const hasNavigator = typeof navigator !== 'undefined';
const isIOS = hasNavigator && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const isAndroid = hasNavigator && /Android/.test(navigator.userAgent);

export default function SimpleVideoPlayer() {
    const { isActive, config, subtitleText, isTimedSubtitles, scrollRatio, updateProgress } = useSimpleVideo();
    const mediaVisible = useStore(appStore, (s) => s.mediaVisible);
    const mediaState = useStore(appStore, (s) => s.mediaState);
    const pendingVideoPlayType = useStore(appStore, (s) => s.pendingVideoPlayType);
    const videoRef = useRef(null);
    const subtitleContainerRef = useRef(null);
    const subtitleDisplayRef = useRef(null);
    const posterCanvasRef = useRef(null);
    const msIntervalRef = useRef(null);
    const foucFallbackRef = useRef(null);
    const [playing, setPlaying] = useState(false);
    // True while an autoplay attempt is in flight. The play icon is suppressed
    // during this window so it never flashes in the async gap between the video
    // becoming ready (loaded=true) and the play() promise resolving (onPlay
    // fires, playing=true). Cleared on success (handlePlay) and on definitive
    // failure (so the user can tap to play when autoplay is blocked).
    const [autoplayPending, setAutoplayPending] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [poster, setPoster] = useState(null);
    const [scrollOffset, setScrollOffset] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const appPhase = useStore(appStore, (s) => s.appPhase);
    const overlayLang = useNativeLanguage();

    const overlayBilingual = useMemo(
        () => getBilingual(
            appPhase === 'lessonSuccess-decisionTime' ? 'video_continue_create' : 'video_continue',
            overlayLang
        ),
        [appPhase, overlayLang]
    );
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
        setAutoplayPending(false);
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
        const cv = appStore.getState().currentVideo;
        if (cv?.responseType === 'viewAndContinue') {
            appStore.getState().transitionTo('simpleVideo-decisionTime-viewAndContinue', {}, { fromStepLoad: true });
        } else if (cv?.responseType === 'success') {
            // Success video finished: reveal the concat button and the
            // "create and share your video" overlay, same pattern as earlier steps.
            console.log('[SimpleVideo] Success video ended → revealing concat button');
            appStore.getState().transitionTo('lessonSuccess-decisionTime', {}, { fromStepLoad: true });
        }
    }, []);

    const handleError = useCallback(() => {
        // A broken/undecodable success clip must not strand the learner: reveal
        // the concat button even though `ended` never fired.
        const cv = appStore.getState().currentVideo;
        if (cv?.responseType === 'success') {
            console.warn('[SimpleVideo] Success video failed to load → revealing concat button');
            appStore.getState().transitionTo('lessonSuccess-decisionTime', {}, { fromStepLoad: true });
        }
    }, []);

    const handleTimeUpdate = useCallback(() => {
        const v = videoRef.current;
        if (v) {
            updateProgress(v.currentTime, v.duration);
            setCurrentTime(v.currentTime);
        }
    }, [updateProgress]);

    const handleSeeked = useCallback(() => {
        const v = videoRef.current;
        if (v) {
            updateProgress(v.currentTime, v.duration);
            setCurrentTime(v.currentTime);
        }
    }, [updateProgress]);

    const handleLoadedMetadata = useCallback(() => {
        const v = videoRef.current;
        if (v && v.duration) setDuration(v.duration);
    }, []);

    const onScrub = useCallback((e) => {
        const t = Number(e.target.value);
        setCurrentTime(t);
        if (videoRef.current) videoRef.current.currentTime = t;
    }, []);

    const formatTime = useCallback((s) => {
        if (!s || isNaN(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, '0')}`;
    }, []);

    // Delayed play after React mount
    // useLayoutEffect fires synchronously during the React commit phase,
    // preserving iOS transient activation from the continue-button click.
    useLayoutEffect(() => {
        console.log('[SimpleVideo] autoplay effect running. isActive:', isActive, 'hasVideoRef:', !!videoRef.current, 'mediaVisible:', mediaVisible, 'reactReady:', appStore.getState().reactReady, 'pendingVideoPlayType:', pendingVideoPlayType);
        if (!isActive || !videoRef.current) {
            console.log('[SimpleVideo] autoplay blocked — isActive:', isActive, 'videoRef:', !!videoRef.current);
            return;
        }

        const tryPlay = () => {
            const video = videoRef.current;
            console.log('[SimpleVideo] tryPlay called. readyState:', video.readyState, 'paused:', video.paused, 'src:', video.src?.slice(-40));
            const p = video.play();
            if (p !== undefined) {
                p.then(() => {
                    // Success — onPlay will fire and set playing=true; clear the
                    // pending flag in case onPlay is delayed.
                    setAutoplayPending(false);
                }).catch(() => {
                    console.log('[SimpleVideo] Unmuted autoplay blocked — retrying muted.');
                    video.muted = true;
                    video.play().then(() => {
                        console.log('[SimpleVideo] Muted autoplay succeeded — unmuting in 100ms.');
                        setAutoplayPending(false);
                        setTimeout(() => { video.muted = false; }, 100);
                    }).catch((e) => {
                        console.log('[SimpleVideo] Muted autoplay also blocked:', e.message);
                        // Autoplay definitively blocked — allow the play icon
                        // so the user can tap to start playback.
                        setAutoplayPending(false);
                    });
                });
            } else {
                setAutoplayPending(false);
            }
        };

        let pendingCleanup = null;

        const attemptAutoplay = () => {
            const video = videoRef.current;
            if (!video) return;
            console.log('[SimpleVideo] attemptAutoplay. readyState:', video.readyState);
            // Mark an autoplay attempt as in-flight for the entire window from
            // now through the play() promise settling. This suppresses the play
            // icon during the async gap where loaded=true but playing is still
            // false (e.g. waiting for canplay after video.load()).
            setAutoplayPending(true);
            if (video.readyState >= 2) {
                tryPlay();
                return;
            }
            // readyState < 2: call video.load() to resume buffering past metadata.
            // With preload='metadata', the browser stops after readyState=1 and
            // never fires canplay without an explicit load().
            video.load();
            const onReady = () => {
                video.removeEventListener('canplay', onReady);
                clearTimeout(timeoutId);
                tryPlay();
            };
            const timeoutId = setTimeout(() => {
                video.removeEventListener('canplay', onReady);
                console.warn('[SimpleVideo] Video did not become ready within 10s — trying to play anyway.');
                tryPlay();
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
    }, [isActive, pendingVideoPlayType, mediaVisible]);

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
                    onLoadedMetadata={handleLoadedMetadata}
                    onPlay={handlePlay}
                    onPause={handlePause}
                    onEnded={handleEnded}
                    onError={handleError}
                    onTimeUpdate={handleTimeUpdate}
                    onSeeked={handleSeeked}
                />
                <canvas ref={posterCanvasRef} style={{ display: 'none' }} />
                <div className="ivp-blur-overlay" />
                {(appPhase === 'simpleVideo-decisionTime-viewAndContinue' || appPhase === 'lessonSuccess-decisionTime') && (
                    <>
                        <div className="ivp-click-block" onClick={(e) => e.stopPropagation()} />
                        <div className="ivp-overlay water-surface" style={{ display: 'flex' }}>
                            <div className="ivp-overlay-content">
                                <p className="ivp-overlay-text">
                                    {overlayBilingual.localized ? (
                                        <>{overlayBilingual.english}<br /><span lang={overlayBilingual.lang}>{overlayBilingual.localized}</span></>
                                    ) : overlayBilingual.english}
                                </p>
                            </div>
                        </div>
                    </>
                )}
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
                {duration > 0 && (
                    <div
                        className="ivp-scrubber"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <span className="ivp-scrubber-time">{formatTime(currentTime)}</span>
                        <input
                            type="range"
                            className="ivp-scrubber-range"
                            min={0}
                            max={duration || 0}
                            step="any"
                            value={currentTime}
                            onChange={onScrub}
                            aria-label="Scrub video"
                        />
                        <span className="ivp-scrubber-time">{formatTime(duration)}</span>
                    </div>
                )}
                {!playing && !autoplayPending && mediaState === 'simpleVideo' && (
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
