import React, { useEffect, useRef } from 'react';
import { introBackgroundVideo } from './intro-background-video.js';

export default function IntroVideoWrapper({ videoUrl, config }) {
    const containerRef = useRef(null);
    const playerInstance = useRef(null);

    useEffect(() => {
        const staticWidget = document.getElementById('intro-call-widget');
        let originalId = '';
        if (staticWidget && staticWidget !== containerRef.current) {
            originalId = staticWidget.id;
            staticWidget.id = 'intro-call-widget-static';
        }

        if (containerRef.current && !playerInstance.current) {
            containerRef.current.id = 'intro-call-widget';

            const mergedConfig = {
                ...config,
                videoUrl
            };

            // Mount the vanilla class into the React-controlled DOM node
            playerInstance.current = new introBackgroundVideo(mergedConfig);
        }

        return () => {
            if (playerInstance.current) {
                if (typeof playerInstance.current.destroy === 'function') {
                    playerInstance.current.destroy();
                }
                playerInstance.current = null;
            }
            if (staticWidget && originalId) {
                staticWidget.id = originalId;
            }
        };
    }, [videoUrl, config]);

    return (
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
        </div>
    );
}
