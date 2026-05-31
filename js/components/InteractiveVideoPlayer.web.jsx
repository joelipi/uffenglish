// InteractiveVideoPlayer.web.jsx
// Web-only component — uses navigator.userAgent for iOS detection.
// React Native replaces this with InteractiveVideoPlayer.native.jsx.
import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../modules/store.js';
import { useInteractiveVideo } from '../hooks/useInteractiveVideo.js';

const hasNavigator = typeof navigator !== 'undefined';
const isIOS =
    hasNavigator &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export default function InteractiveVideoPlayer() {
    const ivh = useInteractiveVideo();
    const {
        isActive,
        config,
        // State (via getters — always fresh at render time)
        isLoaded,
        subtitleTokens,
        playbackRate,
        showOverlay,
        isSlowMode,
        // Callbacks
        requestPlayRef,
        setLoaded,
        handleLoop,
        handlePause,
        revealToken,
        applySpeechResult,
        pauseWithOverlayCancel,
        handleVideoPlay,
        handleWrapperTap,
    } = ivh;

    const mediaVisible = useStore(appStore, (s) => s.mediaVisible);

    const videoRef        = useRef(null);
    const posterCanvasRef = useRef(null);
    const foucFallbackRef = useRef(null);
    // Pointer position at pointerdown — used to distinguish a tap from a drag.
    const pointerDownPosRef = useRef(null);

    const [playing, setPlaying] = useState(false);
    const [poster,  setPoster]  = useState(null);

    // -------------------------------------------------------------------------
    // Register the play executor. The hook's controller subscription calls this
    // directly (not through React state) so loop-driven plays are never dropped.
    // -------------------------------------------------------------------------
    useEffect(() => {
        requestPlayRef.current = () => {
            const video = videoRef.current;
            if (!video || window.isMicActive) return;
            if (video.paused) {
                const p = video.play();
                if (p !== undefined) p.catch(() => {});
            }
        };
        return () => { requestPlayRef.current = null; };
    }, [requestPlayRef]);

    // -------------------------------------------------------------------------
    // Register player interface in the store for external pause/play callers.
    // -------------------------------------------------------------------------
    useEffect(() => {
        if (!isActive) {
            appStore.getState().setCurrentVideoPlayer(null);
            return;
        }

        appStore.getState().setMediaVisible(true);

        appStore.getState().setCurrentVideoPlayer({
            pause:  () => videoRef.current?.pause(),
            play:   () => videoRef.current?.play(),
            get video() { return videoRef.current; },
            destroy: () => videoRef.current?.pause(),
            applySpeechResult, // Exposed to the store for speech pipeline
            // Bridge: answer-pipeline's applySpeechResultToPlayer needs access
            // to the controller's token list and punctuation map to match
            // user words against cue tokens. These delegate to the hook's
            // live getters (which in turn read controllerRef.current from the
            // hook's closure, where the ref actually lives).
            get tokens() { return ivh.tokens; },
            get punctuationMap() { return ivh.punctuationMap; },
        });

        return () => {
            appStore.getState().setMediaVisible(false);
            appStore.getState().setCurrentVideoPlayer(null);
        };
    }, [isActive, applySpeechResult]);

    // -------------------------------------------------------------------------
    // FOUC fallback + iOS transparent poster.
    // -------------------------------------------------------------------------
    useEffect(() => {
        if (!isActive) return;

        if (isIOS) {
            setPoster('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');
        }

        foucFallbackRef.current = setTimeout(() => setLoaded(), 3000);

        return () => {
            if (foucFallbackRef.current) clearTimeout(foucFallbackRef.current);
        };
    }, [isActive, setLoaded]);

    // -------------------------------------------------------------------------
    // Initial autoplay gated on appStore.reactReady.
    // -------------------------------------------------------------------------
    useEffect(() => {
        if (!isActive || !videoRef.current) return;

        const tryPlay = () => {
            const video = videoRef.current;
            if (!video) return;
            const p = video.play();
            if (p !== undefined) {
                p.catch(() => {
                    // Browser blocked unmuted autoplay.
                    // Leave it paused so the user sees the play button.
                    console.log('Unmuted autoplay blocked. Waiting for user interaction.');
                });
            }
        };

        if (appStore.getState().reactReady) {
            tryPlay();
        } else {
            const unsub = appStore.subscribe((state) => {
                if (state.reactReady) { unsub(); tryPlay(); }
            });
            return unsub;
        }
    }, [isActive]);

    // -------------------------------------------------------------------------
    // Sync playbackRate to the video element.
    // -------------------------------------------------------------------------
    useEffect(() => {
        const video = videoRef.current;
        if (video && video.playbackRate !== playbackRate) {
            video.playbackRate = playbackRate;
        }
    }, [playbackRate]);

    // -------------------------------------------------------------------------
    // External pause trigger.
    // -------------------------------------------------------------------------
    useEffect(() => {
        const unsub = appStore.subscribe((state, prev) => {
            if (state.pauseAllVideosTrigger !== prev.pauseAllVideosTrigger) {
                videoRef.current?.pause();
                pauseWithOverlayCancel();
            }
        });
        return unsub;
    }, [pauseWithOverlayCancel]);

    // -------------------------------------------------------------------------
    // Video element event handlers.
    // -------------------------------------------------------------------------
    const handleVideoLoaded = useCallback(() => {
        setLoaded();
        if (foucFallbackRef.current) clearTimeout(foucFallbackRef.current);

        if (!isIOS && posterCanvasRef.current && videoRef.current?.videoWidth) {
            try {
                const canvas = posterCanvasRef.current;
                const video  = videoRef.current;
                canvas.width  = video.videoWidth;
                canvas.height = video.videoHeight;
                canvas.getContext('2d').drawImage(video, 0, 0);
                setPoster(canvas.toDataURL('image/jpeg', 0.8));
            } catch {
                setPoster('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');
            }
        }
    }, [setLoaded]);

    const onPlay = useCallback(() => {
        if (window.isMicActive) {
            videoRef.current?.pause();
            return;
        }
        setPlaying(true);
        handleVideoPlay();
    }, [handleVideoPlay]);

    const onPause = useCallback(() => {
        setPlaying(false);
        handlePause();
    }, [handlePause]);

    const onEnded = useCallback(() => {
        setPlaying(false);
        handleLoop();
    }, [handleLoop]);

    // -------------------------------------------------------------------------
    // Wrapper tap detection
    // -------------------------------------------------------------------------
    const TAP_THRESHOLD = 10;

    const handlePointerDown = useCallback((e) => {
        pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    }, []);

    const handlePointerUp = useCallback((e) => {
        const down = pointerDownPosRef.current;
        if (!down) return;
        pointerDownPosRef.current = null;

        const dx = Math.abs(e.clientX - down.x);
        const dy = Math.abs(e.clientY - down.y);
        if (dx > TAP_THRESHOLD || dy > TAP_THRESHOLD) return;

        const shouldToggle = handleWrapperTap();
        if (!shouldToggle) return;

        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            video.play().catch((err) => console.log('Play failed:', err));
        } else {
            video.pause();
        }
    }, [handleWrapperTap]);

    // -------------------------------------------------------------------------
    // Log unmount
    // -------------------------------------------------------------------------
    useEffect(() => {
        return () => console.log("💥 PLAYER COMPONENT UNMOUNTED");
    }, []);

    if (!isActive) return null;

    return (
        <div
            className="ivp-main-wrapper position-absolute top-0 start-0 w-100 h-100"
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            style={{ visibility: isLoaded ? 'visible' : 'hidden' }}
        >
            <div className="ivp-video-wrapper">
                <video
                    ref={videoRef}
                    className="ivp-video"
                    playsInline
                    disableRemotePlayback
                    preload={isIOS ? 'metadata' : 'auto'}
                    crossOrigin="anonymous"
                    src={config?.videoUrl}
                    poster={poster}
                    style={isSlowMode ? { transform: 'scale(1.5)' } : undefined}
                    onLoadedData={handleVideoLoaded}
                    onCanPlay={handleVideoLoaded}
                    onPlay={onPlay}
                    onPause={onPause}
                    onEnded={onEnded}
                />

                <canvas ref={posterCanvasRef} style={{ display: 'none' }} />

                <div className="ivp-blur-overlay" style={{ display: 'none' }} />

                {showOverlay && (
                    <div className="ivp-overlay" style={{ display: 'flex' }}>
                        <div className="ivp-overlay-content">
                            <div className="ivp-overlay-circle" />
                            <p className="ivp-overlay-text">
                                Understand<br />100%?
                            </p>
                        </div>
                        <div className="ivp-overlay-arrow ivp-overlay-arrow-up">
                            <span className="ivp-arrow-label">NO</span>
                        </div>
                        <div className="ivp-overlay-arrow ivp-overlay-arrow-down">
                            <span className="ivp-arrow-label">YES</span>
                        </div>
                    </div>
                )}

                {subtitleTokens.length > 0 && (
                    <div className="ivp-subtitles" style={config?.subtitleStyles}>
                        {subtitleTokens.map((token) => {
                            if (token.clickable) {
                                return (
                                    <button
                                        key={token.index}
                                        className="ivp-token ivp-token-hidden"
                                        aria-label="Hidden word"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onPointerUp={(e) => {
                                            e.stopPropagation();
                                            revealToken(token.index);
                                        }}
                                    >
                                        {token.text}
                                    </button>
                                );
                            }
                            return (
                                <span
                                    key={token.index}
                                    className={[
                                        'ivp-token',
                                        token.isPunctuation
                                            ? 'ivp-token-punctuation'
                                            : 'ivp-token-revealed',
                                        token.strikethrough ? 'ivp-token-strikethrough' : '',
                                    ]
                                        .filter(Boolean)
                                        .join(' ')}
                                >
                                    {token.text}
                                </span>
                            );
                        })}
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