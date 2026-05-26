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
        video.play().catch(() => {});

        return () => {
            URL.revokeObjectURL(url);
        };
    }, [blob]);

    if (!blob) return null;

    return (
        <video ref={videoRef} id="resultVideo" playsInline autoPlay loop controls
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                backgroundColor: 'black',
                zIndex: 10
            }} />
    );
}
