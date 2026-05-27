import React, { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function WebcamPreview() {
    const webcamStream = useStore(appStore, (state) => state.webcamStream);
    const chatModeActive = useStore(appStore, (state) => state.chatModeActive);
    const videoRef = useRef(null);
    const wrapperRef = useRef(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        if (webcamStream) {
            if (video.srcObject !== webcamStream) {
                video.srcObject = webcamStream;
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
    }, [webcamStream]);

    const show = webcamStream && !chatModeActive;

    return (
        <div ref={wrapperRef} id="pip-wrapper" className={`pip-container shadow ${show ? '' : 'd-none'}`}>
            <video ref={videoRef} id="webcam-preview" autoPlay muted playsInline></video>
        </div>
    );
}
