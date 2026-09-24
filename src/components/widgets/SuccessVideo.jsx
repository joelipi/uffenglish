import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { getBilingual } from '../../data/strings.js';

export default function SuccessVideo() {
    const videoRef = useRef(null);
    const blob = useStore(appStore, (state) => state.successVideoBlob);
    const userData = useStore(appStore, (state) => state.userData);
    const [playing, setPlaying] = useState(false);
    const [ended, setEnded] = useState(false);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !blob) return;

        setEnded(false);
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

    if (!blob) return null;

    const overlayBilingual = getBilingual('video_share_friends', userData?.native_language || 'en');

    return (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 20 }}>
            <video ref={videoRef} id="resultVideo" playsInline
                onClick={handleToggle}
                onPlay={() => { setPlaying(true); setEnded(false); }}
                onPause={() => setPlaying(false)}
                onEnded={() => { setPlaying(false); setEnded(true); }}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    backgroundColor: 'black',
                    cursor: 'pointer'
                }} />
            {!playing && !ended && (
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
            {ended && (
                <>
                    <div className="ivp-click-block" onClick={(e) => e.stopPropagation()} />
                    <div className="ivp-overlay water-surface" style={{ display: 'flex' }}>
                        <div className="ivp-overlay-content">
                            <p className="ivp-overlay-text">
                                {overlayBilingual.localized ? (
                                    <>{overlayBilingual.english}<br /><span lang={overlayBilingual.lang}>{overlayBilingual.localized}</span></>
                                ) : overlayBilingual.english}
                            </p>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
