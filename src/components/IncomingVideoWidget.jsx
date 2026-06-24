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
    const [isReady, setIsReady] = useState(false);
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
        if (!video) {
            // No video element mounted — reveal immediately so the Preloader
            // can go away (onError / safety-timeout paths).
            setIsReady(true);
            appStore.getState().setIntroVideoReady(true);
            return;
        }

        // Helper: reveal after a double rAF so the composited frame is painted.
        const reveal = () => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setIsReady(true);
                    appStore.getState().setIntroVideoReady(true);
                });
            });
        };

        // Pause at the first frame so playback doesn't drift past it.
        video.pause();
        video.currentTime = 0;

        // Wait for the browser to actually present the first video frame
        // before revealing.  loadeddata / canplay only guarantee that the
        // *data* for the first frame is available — the browser may not
        // have decoded or composited it yet.  A visible <video> element
        // without a painted frame renders as a black rectangle regardless
        // of CSS background, causing the "empty rectangle" flash.

        // requestVideoFrameCallback fires when a new frame is presented
        // to the compositor — the most reliable signal that the first
        // frame is actually visible to the user.
        const presentFrame = (fn) => {
            if (video.requestVideoFrameCallback) {
                video.requestVideoFrameCallback(fn);
            } else {
                // Fallback for Firefox and other browsers without rvfc:
                // poll video dimensions via rAF.  videoWidth/videoHeight
                // become nonzero once the first frame is decoded, and the
                // rAF loop keeps us aligned with the paint cycle.
                const poll = () => {
                    if (video.videoWidth > 0 && video.videoHeight > 0) {
                        fn();
                    } else {
                        requestAnimationFrame(poll);
                    }
                };
                requestAnimationFrame(poll);
            }
        };

        // Safety timeout: if the frame never presents (broken video, etc.)
        // reveal after 1 s so the Preloader doesn't hang.
        let frameTimeout = setTimeout(reveal, 1000);

        presentFrame(() => {
            clearTimeout(frameTimeout);
            reveal();
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

        // Android: call play() to coax the browser into actually fetching the
        // video (preload="auto" is routinely ignored).  The promise will reject
        // with NotAllowedError (no user gesture) but the load is kicked off.
        if (isAndroid) {
            video.play().catch(() => {
                // Expected — play() without gesture is blocked.
                // The video element is now loading though.
            });
        }

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
                    <video ref={videoRef} className="intro-video" playsInline preload={isIOS ? 'metadata' : 'auto'} crossOrigin="anonymous" muted onLoadedData={onLoadedData} onCanPlay={onCanPlay} onError={onError} style={{ opacity: isReady ? 1 : 0, transition: 'opacity 0.15s ease-in' }} />
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

                    </div>
                </div>
            </div>
        </div>
    );
}
