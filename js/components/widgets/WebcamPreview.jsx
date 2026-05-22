import React, { useEffect } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function WebcamPreview() {
    const webcamStream = useStore(appStore, (state) => state.webcamStream);

    useEffect(() => {
        const video = document.getElementById('webcam-preview');
        const pipWrapper = document.getElementById('pip-wrapper');
        if (!video || !pipWrapper) return;

        if (webcamStream) {
            if (video.srcObject !== webcamStream) {
                video.srcObject = webcamStream;
            }
            pipWrapper.classList.remove('d-none');
            setTimeout(() => {
                if (video.readyState >= 2 || video.paused) {
                    video.play().catch(e => console.log('[Webcam] play failed:', e));
                }
            }, 100);
        } else {
            video.pause();
            video.srcObject = null;
            pipWrapper.classList.add('d-none');
        }
    }, [webcamStream]);

    return null;
}
