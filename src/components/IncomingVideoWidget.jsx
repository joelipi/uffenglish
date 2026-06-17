import { useEffect, useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { appStore } from '../modules/store/store.js';

const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export default function IncomingVideoWidget() {
    const videoRef = useRef(null);
    const [isReady, setIsReady] = useState(false);

    const currentVideo = useSyncExternalStore(
        appStore.subscribe,
        () => appStore.getState().currentVideo
    );

    const show = currentVideo?.type === 'intro';
    const config = show ? currentVideo.config : null;
    const subtitle = config?.subtitle;

    const onLoadedData = () => {
        const video = videoRef.current;
        if (video) {
            video.currentTime = 0;
            video.pause();
        }
        setIsReady(true);
    };

    useEffect(() => {
        const video = videoRef.current;
        if (!show || !video || !currentVideo) return;

        video.src = currentVideo.url;
        video.load();

        if (video.readyState >= 2) {
            onLoadedData();
        }

        return () => {

            video.pause();
            video.src = '';
        };
    }, [show, currentVideo]);

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
        appStore.getState().triggerMicBounce();
    };

    if (!show) return null;

    return (
        <div id="intro-call-widget" className="intro-video-wrapper" onClick={handleClick}>
            <div className="pulse-ring-wrapper">
                <div className="pulse-ring"></div>
                <div className="intro-video-container">
                    <video ref={videoRef} className="intro-video" playsInline preload={isIOS ? 'metadata' : 'auto'} crossOrigin="anonymous" muted onLoadedData={onLoadedData} style={{ visibility: isReady ? 'visible' : 'hidden' }} />
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
