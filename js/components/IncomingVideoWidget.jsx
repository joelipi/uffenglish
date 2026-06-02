import { useEffect, useRef } from 'react';
import { useSyncExternalStore } from 'react';
import { appStore } from '../modules/store/store.js';

export default function IncomingVideoWidget() {
    const videoRef = useRef(null);

    const currentVideo = useSyncExternalStore(
        appStore.subscribe,
        () => appStore.getState().currentVideo
    );

    const show = currentVideo?.type === 'intro';
    const config = show ? currentVideo.config : null;

    const onLoadedData = () => {
        const video = videoRef.current;
        if (video) {
            video.currentTime = 0;
            video.pause();
        }
    };

    useEffect(() => {
        const video = videoRef.current;
        if (!show || !video || !currentVideo) return;

        video.src = currentVideo.url;

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
                <div className="intro-video-container ringing-animation">
                    <video ref={videoRef} className="intro-video" playsInline preload="auto" crossOrigin="anonymous" muted onLoadedData={onLoadedData} />
                    <div className="intro-notification-content">
                        <div className="intro-notification-top">
                            <div className="intro-call-title">
                                <i className="bi bi-camera-video-fill text-info"></i>
                                <span>{config?.title || 'INCOMING VIDEO'}</span>
                            </div>
                            <div className="intro-call-subtitle">
                                <span lang="es"><i>{config?.subtitle || 'VIDEO ENTRANTE'}</i></span>
                            </div>
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
