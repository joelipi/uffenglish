import { useEffect, useRef, useState, useCallback } from 'react';
import { useSyncExternalStore } from 'react';
import { appStore } from '../modules/store/store.js';
import { getIntroContinueHandler } from '../modules/answer/answer-pipeline.js';

const hasNavigator = typeof navigator !== 'undefined';
const isIOS = hasNavigator && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const isAndroid = hasNavigator && /Android/.test(navigator.userAgent);

// Android Chrome frequently ignores preload="auto" (data saver, mobile
// optimisations) and may never fire onLoadedData.  We cap the wait at
// the same 3 s used by SimpleVideoPlayer's foucFallbackRef.
const ANDROID_VIDEO_LOAD_TIMEOUT_MS = 3000;

export default function IncomingVideoWidget() {
    const videoRef = useRef(null);
    const posterCanvasRef = useRef(null);
    const [isReady, setIsReady] = useState(false);
    const [poster, setPoster] = useState(null);
    // Guard so we only signal introVideoReady once (onLoadedData, onCanPlay,
    // and the safety timeout may all race).
    const readySignalledRef = useRef(false);
    const safetyTimeoutRef = useRef(null);

    const currentVideo = useSyncExternalStore(
        appStore.subscribe,
        () => appStore.getState().currentVideo
    );

    const show = currentVideo?.type === 'intro';
    const config = show ? currentVideo.config : null;
    const subtitle = config?.subtitle;

    const signalReady = useCallback(() => {
        if (readySignalledRef.current) return;
        readySignalledRef.current = true;
        if (safetyTimeoutRef.current) {
            clearTimeout(safetyTimeoutRef.current);
            safetyTimeoutRef.current = null;
        }
        const video = videoRef.current;
        if (video) {
            video.currentTime = 0;
            video.pause();

            // Capture the first frame as a poster so the browser displays a
            // static frame immediately when the video element becomes visible,
            // even before the decoder has composited the first painted frame.
            // Skip on iOS where canvas drawImage from video is unreliable.
            if (!isIOS && posterCanvasRef.current && video.videoWidth > 0) {
                try {
                    const canvas = posterCanvasRef.current;
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    canvas.getContext('2d').drawImage(video, 0, 0);
                    setPoster(canvas.toDataURL('image/jpeg', 0.8));
                } catch (e) {
                    console.warn('[IncomingVideoWidget] Poster capture failed', e);
                }
            }
        }
        // Double rAF to ensure the first frame is painted before revealing.
        // Without this, the video element becomes visible (via opacity transition)
        // before the decoded frame has been composited, causing a blank-frame flash.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setIsReady(true);
                // Signal that the intro background video is fully loaded and painted.
                // This unblocks the Preloader overlay removal, avoiding FoUC.
                appStore.getState().setIntroVideoReady(true);
            });
        });
    }, []);

    // Primary trigger: loadeddata (enough data for the first frame).
    const onLoadedData = useCallback(() => {
        signalReady();
    }, [signalReady]);

    // Secondary trigger: canplay fires with less buffered data — more likely
    // to fire on Android where the browser is stingy about preloading.
    const onCanPlay = useCallback(() => {
        signalReady();
    }, [signalReady]);

    // If the video load fails entirely, don't leave the user stuck —
    // signal ready so the preloader can go away.
    const onError = useCallback(() => {
        console.warn('[IncomingVideoWidget] Video load error — signalling ready to unblock preloader');
        signalReady();
    }, [signalReady]);

    useEffect(() => {
        const video = videoRef.current;
        if (!show || !video || !currentVideo) {
            readySignalledRef.current = false;
            return;
        }

        // Reset per-mount guards.
        readySignalledRef.current = false;

        video.src = currentVideo.url;
        video.load();

        // Already loaded (e.g. browser cache).
        if (video.readyState >= 2) {
            signalReady();
            return () => {
                video.pause();
                video.src = '';
            };
        }

        // Call play() (it will reject without a user gesture) to coax the
        // browser into actually fetching video data.  With preload="metadata"
        // on iOS, or with Android Chrome ignoring preload="auto" (data saver),
        // the browser won't load actual frames without this kick.
        video.play().catch(() => {
            // Expected — play() without gesture is blocked.
            // The video element is now loading though.
        });

        // Safety timeout — if neither loadeddata nor canplay fire within the
        // window (Android data-saver, flaky CDN, etc.), signal ready anyway.
        // A missing intro background is better than a 15 s preloader hang.
        safetyTimeoutRef.current = setTimeout(() => {
            if (!readySignalledRef.current) {
                console.warn('[IncomingVideoWidget] Safety timeout — signalling ready to unblock preloader');
                signalReady();
            }
        }, isAndroid ? ANDROID_VIDEO_LOAD_TIMEOUT_MS : 10000);

        return () => {
            if (safetyTimeoutRef.current) {
                clearTimeout(safetyTimeoutRef.current);
                safetyTimeoutRef.current = null;
            }
            video.pause();
            video.src = '';
            setPoster(null);
        };
    }, [show, currentVideo, signalReady]);

    useEffect(() => {
        if (show) {
            appStore.getState().setMediaVisible(true);
        }
    }, [show]);

    useEffect(() => {
        const unsub = appStore.subscribe((state, prev) => {
            if (state.pauseAllVideosTrigger !== prev.pauseAllVideosTrigger) {
                videoRef.current?.pause();
            }
        });
        return unsub;
    }, []);

    const handleClick = () => {
        const cb = getIntroContinueHandler();
        if (cb) cb();
    };

    if (!show) return null;

    return (
        <div id="intro-call-widget" className="intro-video-wrapper" onClick={handleClick}>
            <div className="pulse-ring-wrapper">
                <div className="pulse-ring"></div>
                <div className="intro-video-container">
                    <video ref={videoRef} className="intro-video" playsInline preload={isIOS ? 'metadata' : 'auto'} crossOrigin="anonymous" muted poster={poster} onLoadedData={onLoadedData} onCanPlay={onCanPlay} onError={onError} style={{ opacity: isReady ? 1 : 0, transition: 'opacity 0.15s ease-in' }} />
                    <canvas ref={posterCanvasRef} style={{ display: 'none' }} />
                    <div className="intro-notification-content">
                        <div className="intro-notification-top">
                            <div className="intro-call-title">
                                <i className="bi bi-camera-video-fill text-info"></i>
                                <span lang="en">{config?.title || 'INCOMING VIDEO'}</span>
                            </div>
                            {subtitle?.localized && (
                            <div className="intro-call-subtitle">
                                <span lang={subtitle.lang}><i>{subtitle.localized}</i></span>
                            </div>
                            )}
                        </div>
                        <div className="intro-notification-bottom">
                            <div className="intro-caller-name">{config?.name || 'Joe Walsh'}</div>
                            <div className="intro-caller-title">{config?.role || 'English Coach, UFF'}</div>
                        </div>
                        <div className="intro-tap-hint">
                            <span className="intro-tap-hint-text">Tap to answer</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
