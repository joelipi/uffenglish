// InteractiveVideoPlayer.web.jsx
// Web-only component — uses navigator.userAgent for iOS detection.
// React Native replaces this with InteractiveVideoPlayer.native.jsx.
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useStore } from 'zustand';
import { appStore, setCurrentVideoPlayer } from '../modules/store/store.js';
import { useInteractiveVideo } from '../hooks/useInteractiveVideo.js';
import { getBilingual } from '../data/strings.js';

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------
const TAP_THRESHOLD = 10;

// Wrapped in a function so navigator is never touched in SSR / test envs.
function detectIOS() {
    if (typeof navigator === 'undefined') return false;
    return (
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
}

const TRANSPARENT_GIF =
    'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

export default function InteractiveVideoPlayer() {
    const ivh = useInteractiveVideo();
    const {
        isActive,
        config,
        isLoaded,
        subtitleTokens,
        playbackRate,
        showOverlay,
        isSlowMode,
        requestPlayRef,
        setLoaded,
        handleLoop,
        handlePause,
        revealToken,
        applySpeechResult,
        pauseWithOverlayCancel,
        handleVideoPlay,
        handleWrapperTap,
        dismissOverlay,
    } = ivh;

    const mediaVisible = useStore(appStore, (s) => s.mediaVisible);
    // isMicActive lives in the store — not on window — so React's data flow
    // stays traceable and the value is always fresh in derived state.
    const isMicActive = useStore(appStore, (s) => s.isMicActive);
    const textInputVisible = useStore(appStore, (s) => s.textInputVisible);
    const userData = useStore(appStore, (s) => s.userData);
    const overlayLang = userData?.native_language || 'en';

    const overlayBilingual = useMemo(
        () => getBilingual('video_did_understand', overlayLang),
        [overlayLang]
    );

    const videoRef          = useRef(null);
    const posterCanvasRef   = useRef(null);
    const pointerDownPosRef = useRef(null);
    // Ref mirrors so async callbacks always read the latest values without
    // needing to be recreated on every render.
    const isMicActiveRef    = useRef(isMicActive);
    const ivhRef            = useRef(ivh);
    // Guards against handleVideoLoaded running twice (onLoadedData + onCanPlay
    // both fire on a normal load).
    const loadHandledRef    = useRef(false);

    const [playing, setPlaying] = useState(false);
    const [poster,  setPoster]  = useState(null);

    // Keep refs in sync after each render.
    useEffect(() => { isMicActiveRef.current = isMicActive; }, [isMicActive]);
    useEffect(() => { ivhRef.current = ivh; }, [ivh]);

    // Evaluate once at mount; never touches navigator during SSR or tests.
    const isIOS = useMemo(detectIOS, []);

    // -------------------------------------------------------------------------
    // Register the play executor.
    // -------------------------------------------------------------------------
    useEffect(() => {
        requestPlayRef.current = () => {
            const video = videoRef.current;
            if (!video || isMicActiveRef.current) return;
            if (video.ended) {
                video.currentTime = 0;
            }
            if (video.paused) video.play().catch(() => {});
        };
        return () => { requestPlayRef.current = null; };
    }, [requestPlayRef]);

    // -------------------------------------------------------------------------
    // Register player interface in the store for external callers.
    // -------------------------------------------------------------------------
    useEffect(() => {
        if (!isActive) {
            setCurrentVideoPlayer(null);
            return;
        }

        appStore.getState().setMediaVisible(true);

        // VideoPlayerHandle — the contract shared between web, native, and the
        // platform-agnostic answer pipeline. Every platform registers an object
        // conforming to this shape on appStore.currentVideoPlayer.
        //
        // @typedef {Object} VideoPlayerHandle
        // @property {() => void}                 pause
        // @property {() => Promise<void>}        play
        // @property {() => void}                 destroy
        // @property {() => void}                 dismissOverlay  — dismiss "Understand 100%?" overlay
        // @property {() => void}                 replay          — seek to 0 then play
        // @property {(c:number[],w:number[],e:Array) => void} applySpeechResult
        // @property {string[]}                   tokens          — cue tokens (live)
        // @property {Map<number,boolean>}        punctuationMap  — punctuation mask (live)
        // @property {HTMLVideoElement|undefined} video           — raw element (web only)
        setCurrentVideoPlayer({
            pause:   () => videoRef.current?.pause(),
            play:    () => videoRef.current?.play(),
            destroy: () => videoRef.current?.pause(),
            get video() { return videoRef.current; },
            replay() {
                const el = videoRef.current;
                if (!el) return;
                // Listen for 'seeked' rather than using a fixed-delay timeout,
                // so play is triggered exactly when the seek completes.
                const onSeeked = () => {
                    el.removeEventListener('seeked', onSeeked);
                    el.play().catch(() => {});
                };
                el.addEventListener('seeked', onSeeked);
                el.currentTime = 0;
            },
            // All three delegate through ivhRef so they always reflect the
            // latest hook state regardless of when this effect last ran,
            // without needing ivh in the dependency array.
            get applySpeechResult() { return ivhRef.current.applySpeechResult; },
            get dismissOverlay()    { return ivhRef.current.dismissOverlay; },
            get tokens()            { return ivhRef.current.tokens; },
            get punctuationMap()    { return ivhRef.current.punctuationMap; },
        });

        return () => {
            appStore.getState().setMediaVisible(false);
            setCurrentVideoPlayer(null);
        };
    }, [isActive]);

    // -------------------------------------------------------------------------
    // FOUC fallback + iOS transparent poster.
    // -------------------------------------------------------------------------
    useEffect(() => {
        if (!isActive) return;

        if (isIOS) setPoster(TRANSPARENT_GIF);
    }, [isActive, isIOS]);

    // -------------------------------------------------------------------------
    // Initial autoplay gated on appStore.reactReady.
    // -------------------------------------------------------------------------
    useEffect(() => {
        if (!isActive || !videoRef.current) return;

        const tryPlay = () => {
            videoRef.current?.play().catch(() => {
                console.log('Unmuted autoplay blocked. Waiting for user interaction.');
            });
        };

        if (appStore.getState().reactReady) {
            tryPlay();
            return;
        }

        const unsub = appStore.subscribe((state) => {
            if (state.reactReady) { unsub(); tryPlay(); }
        });
        return unsub;
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
        return appStore.subscribe((state, prev) => {
            if (state.pauseAllVideosTrigger !== prev.pauseAllVideosTrigger) {
                videoRef.current?.pause();
                pauseWithOverlayCancel();
            }
        });
    }, [pauseWithOverlayCancel]);

    // -------------------------------------------------------------------------
    // Video element event handlers.
    // -------------------------------------------------------------------------

    // Reset the dedup guard whenever the video source changes.
    useEffect(() => { loadHandledRef.current = false; }, [config?.videoUrl]);

    const handleVideoLoaded = useCallback(() => {
        // Both onLoadedData and onCanPlay fire on a normal load; only run once.
        if (loadHandledRef.current) return;
        loadHandledRef.current = true;

        setLoaded();

        if (!isIOS && posterCanvasRef.current && videoRef.current?.videoWidth) {
            try {
                const canvas  = posterCanvasRef.current;
                const video   = videoRef.current;
                canvas.width  = video.videoWidth;
                canvas.height = video.videoHeight;
                canvas.getContext('2d').drawImage(video, 0, 0);
                setPoster(canvas.toDataURL('image/jpeg', 0.8));
            } catch {
                setPoster(TRANSPARENT_GIF);
            }
        }
    }, [isIOS, setLoaded]);

    const onPlay = useCallback(() => {
        // Read from ref so this callback is never recreated when isMicActive
        // changes; the ref is always current.
        if (isMicActiveRef.current) {
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
    const handlePointerDown = useCallback((e) => {
        pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
        // If the video hasn't loaded yet, reveal the player on first touch
        // rather than waiting for a timer.
        setLoaded();
    }, [setLoaded]);

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
                    style={{ ...(isSlowMode ? { transform: 'scale(1.5)' } : {}), ...(showOverlay ? { filter: 'grayscale(100%)' } : {}) }}
                    onLoadedData={handleVideoLoaded}
                    onCanPlay={handleVideoLoaded}
                    onPlay={onPlay}
                    onPause={onPause}
                    onEnded={onEnded}
                />

                <canvas ref={posterCanvasRef} style={{ display: 'none' }} />

                <div className="ivp-blur-overlay" style={{ display: 'none' }} />

                {(showOverlay || isMicActive || textInputVisible) && <div className="ivp-click-block" />}

                {showOverlay && (
                    <div className="ivp-overlay" style={{ display: 'flex' }}>
                        <div className="ivp-overlay-content">
                            <p className="ivp-overlay-text">
                                {overlayBilingual.localized ? (
                                    <>{overlayBilingual.english}<br /><span lang={overlayBilingual.lang}><i>{overlayBilingual.localized}</i></span></>
                                ) : overlayBilingual.english}
                            </p>
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

                {!playing && !showOverlay && !isMicActive && !textInputVisible && !videoRef.current?.ended && (
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
