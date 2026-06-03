import React, { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore, getWebcamStream } from '../../modules/store/store.js';

export default function WebcamPreview() {
    // Subscribe to the key counter (bumped by setWebcamStream) for reactivity,
    // then read the actual stream from the module-level getter.
    const webcamStreamKey = useStore(appStore, (state) => state._webcamStreamKey);
    const chatModeActive = useStore(appStore, (state) => state.chatModeActive);
    const videoRef = useRef(null);
    const wrapperRef = useRef(null);

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

    const show = !!getWebcamStream() && !chatModeActive;

    return (
        <div ref={wrapperRef} id="pip-wrapper" className={`pip-container shadow ${show ? '' : 'd-none'}`}>
            <video ref={videoRef} id="webcam-preview" autoPlay muted playsInline></video>
        </div>
    );
}
