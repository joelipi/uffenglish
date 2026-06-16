import React, { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore, getWebcamStream } from '../../modules/store/store.js';

export default function WebcamPreview() {
    // Subscribe to the key counter (bumped by setWebcamStream) for reactivity,
    // then read the actual stream from the module-level getter.
    const webcamStreamKey = useStore(appStore, (state) => state._webcamStreamKey);
    const mediaState = useStore(appStore, (state) => state.mediaState);
    const isMicActive = useStore(appStore, (state) => state.isMicActive);
    const videoRef = useRef(null);
    const wrapperRef = useRef(null);
    const prevMicActive = useRef(isMicActive);
    const [takeover, setTakeover] = useState(false);

    // Keep webcam full-frame until overlay has time to render after mic deactivates
    useEffect(() => {
        if (isMicActive) {
            setTakeover(true);
        } else if (prevMicActive.current) {
            const timer = setTimeout(() => setTakeover(false), 250);
            return () => clearTimeout(timer);
        } else {
            setTakeover(false);
        }
        prevMicActive.current = isMicActive;
    }, [isMicActive]);

    useEffect(() => {
        const stream = getWebcamStream();
        const video = videoRef.current;
        if (!video) return;

        if (stream) {
            if (video.srcObject !== stream) {
                video.srcObject = stream;
            }
            const timer = setTimeout(() => {
                if (video.readyState >= 2 || video.paused) {
                    video.play().catch(e => console.log('[Webcam] play failed:', e));
                }
            }, 100);
            return () => clearTimeout(timer);
        } else {
            video.pause();
            video.srcObject = null;
        }
    }, [webcamStreamKey]);

    const show = !!getWebcamStream() && (mediaState === 'webcamOrAvatar' || mediaState === 'simpleVideo' || mediaState === 'interactiveVideo');

    let className = 'pip-container';
    if (show) {
        className += takeover ? ' pip-container--takeover' : ' shadow';
    } else {
        className += ' d-none';
    }

    return (
        <div ref={wrapperRef} id="pip-wrapper" className={className}>
            <video ref={videoRef} id="webcam-preview" autoPlay muted playsInline></video>
        </div>
    );
}
