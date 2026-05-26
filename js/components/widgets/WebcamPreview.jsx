import React, { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function WebcamPreview() {
    const webcamStream = useStore(appStore, (state) => state.webcamStream);
    const chatModeActive = useStore(appStore, (state) => state.chatModeActive);
    const videoRef = useRef(null);
    const wrapperRef = useRef(null);

    useEffect(() => {
        videoRef.current = document.getElementById('webcam-preview');
        wrapperRef.current = document.getElementById('pip-wrapper');
    }, []);

    useEffect(() => {
        const video = videoRef.current;
        const wrapper = wrapperRef.current;
        if (!video || !wrapper) return;

        if (webcamStream) {
            if (video.srcObject !== webcamStream) {
                video.srcObject = webcamStream;
            }
            wrapper.classList.remove('d-none');
            const timer = setTimeout(() => {
                if (video.readyState >= 2 || video.paused) {
                    video.play().catch(e => console.log('[Webcam] play failed:', e));
                }
            }, 100);
            return () => clearTimeout(timer);
        } else {
            video.pause();
            video.srcObject = null;
            wrapper.classList.add('d-none');
        }
    }, [webcamStream]);

    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;
        if (chatModeActive) {
            wrapper.classList.add('d-none');
        } else if (webcamStream) {
            wrapper.classList.remove('d-none');
        }
    }, [chatModeActive, webcamStream]);

    return null;
}
