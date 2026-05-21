import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSyncExternalStore } from 'react';
import { appStore } from '../modules/store.js';
import { State } from '../modules/state.js';
import { introBackgroundVideo } from './intro-background-video.js';

function portalTarget() {
    return document.getElementById('intro-call-widget');
}

export default function IntroVideoWrapper() {
    const containerRef = useRef(null);
    const playerInstance = useRef(null);

    const currentVideo = useSyncExternalStore(
        appStore.subscribe,
        () => appStore.getState().currentVideo
    );

    useEffect(() => {
        if (!currentVideo || currentVideo.type !== 'intro') {
            if (playerInstance.current) {
                playerInstance.current.destroy();
                playerInstance.current = null;
                if (State.player) State.player = null;
                window.currentIntroVideoPlayer = null;
            }
            return;
        }

        if (!containerRef.current || playerInstance.current) return;

        const mergedConfig = {
            ...currentVideo.config,
            videoUrl: currentVideo.url
        };

        const player = new introBackgroundVideo(mergedConfig);
        playerInstance.current = player;
        State.player = player;
        window.currentIntroVideoPlayer = player;

        return () => {
            if (playerInstance.current) {
                playerInstance.current.destroy();
                playerInstance.current = null;
                if (State.player) State.player = null;
                window.currentIntroVideoPlayer = null;
            }
        };
    }, [currentVideo]);

    const target = portalTarget();
    const isActive = currentVideo && currentVideo.type === 'intro';

    return target && isActive ? createPortal(
        <div ref={containerRef} className="intro-video-wrapper d-none">
            <div className="pulse-ring-wrapper">
                <div className="pulse-ring"></div>
                <div className="intro-video-container ringing-animation">
                    <video className="intro-video" playsInline preload="auto" crossOrigin="anonymous" muted></video>
                    <div className="intro-notification-content">
                        <div className="intro-notification-top">
                            <div className="intro-call-title">
                                <i className="bi bi-camera-video-fill text-info"></i>
                                <span id="intro-title">Ringing...</span>
                            </div>
                            <div className="intro-call-subtitle"><span lang="es"><i id="intro-subtitle"></i></span></div>
                        </div>
                        <div className="intro-notification-bottom">
                            <div className="intro-caller-name" id="intro-name">Joe Walsh</div>
                            <div className="intro-caller-title" id="intro-role">English Coach, UFF</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        target
    ) : null;
}
