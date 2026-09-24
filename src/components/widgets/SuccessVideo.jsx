import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { getBilingual } from '../../data/strings.js';

export default function SuccessVideo() {
    const videoRef = useRef(null);
    const blob = useStore(appStore, (state) => state.successVideoBlob);
    const userData = useStore(appStore, (state) => state.userData);
    const [playing, setPlaying] = useState(false);
    const [ended, setEnded] = useState(false);
    const lastProgressLogRef = useRef(-1);

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

    const markEnded = useCallback(() => {
        setPlaying(false);
        setEnded(true);
    }, []);

    const handleLoadedMetadata = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        console.log('[SuccessVideo] loadedmetadata duration:', video.duration, 'seekable:', video.seekable?.length ?? 0);
    }, []);

    // MediaRecorder blobs (iOS WebM in particular) can report a non-finite
    // `duration`; the element then freezes at the end and never fires `ended`,
    // so the overlay would never show. The seekable range still ends at the real
    // clip end, so use it as a fallback end check alongside `ended`.
    const handleTimeUpdate = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        const whole = Math.floor(video.currentTime);
        if (whole !== lastProgressLogRef.current && whole % 3 === 0) {
            lastProgressLogRef.current = whole;
            console.log('[SuccessVideo] timeupdate', { currentTime: video.currentTime, duration: video.duration, paused: video.paused });
        }
        const seekableEnd = (video.seekable && video.seekable.length)
            ? video.seekable.end(video.seekable.length - 1)
            : video.duration;
        const end = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : seekableEnd;
        if (Number.isFinite(end) && end > 0 && video.currentTime >= end - 0.25) {
            console.log('[SuccessVideo] near end detected via timeupdate', { currentTime: video.currentTime, end });
            markEnded();
        }
    }, [markEnded]);

    const handleEnded = useCallback(() => {
        console.log('[SuccessVideo] ended');
        markEnded();
    }, [markEnded]);

    const handleError = useCallback(() => {
        console.warn('[SuccessVideo] error', videoRef.current?.error?.code);
    }, []);

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
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onPlay={() => { console.log('[SuccessVideo] play'); setPlaying(true); setEnded(false); }}
                onPause={() => { console.log('[SuccessVideo] pause'); setPlaying(false); }}
                onEnded={handleEnded}
                onError={handleError}
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
