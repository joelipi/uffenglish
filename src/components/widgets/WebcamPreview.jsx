import React, { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore, getWebcamStream } from '../../modules/store/store.js';

export default function WebcamPreview() {
    // Subscribe to the key counter (bumped by setWebcamStream) for reactivity,
    // then read the actual stream from the module-level getter.
    const webcamStreamKey = useStore(appStore, (state) => state._webcamStreamKey);
    const mediaState = useStore(appStore, (state) => state.mediaState);
    const videoRef = useRef(null);
    const wrapperRef = useRef(null);
    const prevShow = useRef(false);
    const [takeover, setTakeover] = useState(false);

    const show = !!getWebcamStream() && (mediaState === 'webcamOrAvatar' || mediaState === 'simpleVideo' || mediaState === 'interactiveVideo');

    // Full-screen takeover only during the recording/answering phase
    // (mediaState === 'webcamOrAvatar'). During normal video playback
    // (simpleVideo/interactiveVideo) the preview stays a small PiP, not full-screen.
    const fullScreen = show && mediaState === 'webcamOrAvatar';

    useEffect(() => {
        if (fullScreen) {
            setTakeover(true);
        } else if (prevShow.current) {
            const timer = setTimeout(() => setTakeover(false), 250);
            return () => clearTimeout(timer);
        } else {
            setTakeover(false);
        }
        prevShow.current = fullScreen;
    }, [fullScreen]);

    useEffect(() => {
        const stream = getWebcamStream();
        const video = videoRef.current;
        if (!video) return;

        if (stream) {
            if (video.srcObject !== stream) {
                video.srcObject = stream;
            }
            video.play().catch(e => console.log('[Webcam] play failed:', e));
        } else {
            video.pause();
            video.srcObject = null;
        }
    }, [webcamStreamKey]);

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
