import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';

export default function SuccessVideo() {
    const videoRef = useRef(null);
    const blob = useStore(appStore, (state) => state.successVideoBlob);
    // While the display-only after-video loop runs, the canvas owns the frame
    // and the blob is shared via the share sheet — mounting #resultVideo too
    // would stack two surfaces (stories/060-autoplay-share-video).
    const afterVideoActive = useStore(appStore, (state) => state.afterVideoActive);
    const [playing, setPlaying] = useState(false);

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

    const handleToggle = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            video.play().catch(() => {});
        } else {
            video.pause();
        }
    };

    if (!blob || afterVideoActive) return null;

    return (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 20 }}>
            <video ref={videoRef} id="resultVideo" playsInline
                onClick={handleToggle}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    backgroundColor: 'black',
                    cursor: 'pointer'
                }} />
            {!playing && (
                <div onClick={handleToggle} style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    color: 'white',
                    fontSize: '3rem',
                    opacity: 0.8,
                    cursor: 'pointer',
                    pointerEvents: 'auto'
                }}>
                    ▶
                </div>
            )}
        </div>
    );
}
