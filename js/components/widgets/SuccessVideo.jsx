import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store.js';

export default function SuccessVideo() {
    const videoRef = useRef(null);
    const blob = useStore(appStore, (state) => state.successVideoBlob);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !blob) return;

        const url = URL.createObjectURL(blob);
        video.src = url;
        video.classList.remove('d-none');
        video.style.display = 'block';

        return () => {
            URL.revokeObjectURL(url);
            const displayCanvas = document.getElementById('displayCanvas');
            if (displayCanvas) displayCanvas.classList.add('d-none');
        };
    }, [blob]);

    if (!blob) return null;

    return (
        <video ref={videoRef} id="resultVideo" playsInline controls
            className="d-none"
            style={{ width: '100%', height: 'calc(100% - 140px)', objectFit: 'contain', backgroundColor: 'black' }} />
    );
}
