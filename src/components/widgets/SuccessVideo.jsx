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
    const [diag, setDiag] = useState(null);
    const lastProgressLogRef = useRef(-1);
    const endedRef = useRef(false);
    // True once playback has actually moved past the very start. Needed because
    // some mobile browsers reset currentTime to 0 and clear `ended` when a clip
    // finishes, so the only end signal is "was playing, now paused at 0".
    const hasProgressedRef = useRef(false);

    const markEnded = useCallback(() => {
        if (endedRef.current) return;
        endedRef.current = true;
        console.log('[SuccessVideo] markEnded → showing overlay');
        setPlaying(false);
        setEnded(true);
    }, []);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !blob) return;

        endedRef.current = false;
        hasProgressedRef.current = false;
        setEnded(false);
        const url = URL.createObjectURL(blob);
        video.src = url;
        video.play().then(() => {
            console.log('[SuccessVideo] play() resolved');
        }).catch((e) => {
            // iOS blocks unmuted autoplay without a fresh gesture; leave it for
            // the user to start (the ▶ overlay) rather than muting the recap.
            console.log('[SuccessVideo] play() blocked (awaiting user tap):', e?.name);
        });

        // Event-independent safety net: some iOS builds finish a clip without
        // firing `ended` (and sometimes without a near-end `timeupdate`), so poll
        // the element position too. This only reads state; it never delays UI.
        const endPoll = setInterval(() => {
            const v = videoRef.current;
            if (!v) return;
            setDiag({ t: v.currentTime, d: v.duration, paused: v.paused, ended: v.ended, rs: v.readyState });
            if (v.currentTime > 0.5) hasProgressedRef.current = true;
            if (endedRef.current) return;
            if (!Number.isFinite(v.duration) || v.duration <= 0) return;
            if (v.ended || (v.currentTime > 0 && v.currentTime >= v.duration - 0.5)) {
                console.log('[SuccessVideo] end detected via poll', { currentTime: v.currentTime, duration: v.duration, ended: v.ended });
                markEnded();
                return;
            }
            // Finished clips that reset to 0 (see hasProgressedRef).
            if (hasProgressedRef.current && v.paused && v.currentTime < 1 && !v.ended) {
                console.log('[SuccessVideo] end detected via reset-to-0 after playback');
                markEnded();
            }
        }, 250);

        return () => {
            URL.revokeObjectURL(url);
            clearInterval(endPoll);
        };
    }, [blob, markEnded]);

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
        if (Number.isFinite(end) && end > 0 && video.currentTime > 0 && video.currentTime >= end - 1) {
            console.log('[SuccessVideo] near end detected via timeupdate', { currentTime: video.currentTime, end });
            markEnded();
        }
    }, [markEnded]);

    const handlePause = useCallback(() => {
        const video = videoRef.current;
        console.log('[SuccessVideo] pause', {
            currentTime: video?.currentTime,
            duration: video?.duration,
            readyState: video?.readyState,
            muted: video?.muted,
            error: video?.error?.code,
            visibility: typeof document !== 'undefined' ? document.visibilityState : 'n/a',
        });
        setPlaying(false);
        // iOS sometimes parks a finished clip as "paused" without firing `ended`;
        // treat a pause at the very end as completion too.
        if (video && Number.isFinite(video.duration) && video.duration > 0 && video.currentTime > 0 && video.currentTime >= video.duration - 1) {
            console.log('[SuccessVideo] paused at end → marking ended');
            markEnded();
            return;
        }
        // Or the clip finished and the browser reset currentTime to 0.
        if (video && hasProgressedRef.current && video.currentTime < 1 && !video.ended) {
            console.log('[SuccessVideo] paused at 0 after playback → marking ended');
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
                onPause={handlePause}
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
            {diag && (
                <div style={{
                    position: 'absolute', top: 6, left: 6, zIndex: 60,
                    background: 'rgba(0,0,0,0.8)', color: '#6f6',
                    fontFamily: 'monospace', fontSize: 12, padding: '3px 6px',
                    borderRadius: 4, pointerEvents: 'none', whiteSpace: 'nowrap'
                }}>
                    t={Number.isFinite(diag.t) ? diag.t.toFixed(2) : String(diag.t)} d={Number.isFinite(diag.d) ? diag.d.toFixed(2) : String(diag.d)} paused={String(diag.paused)} ended={String(diag.ended)} rs={diag.rs}
                </div>
            )}
        </div>
    );
}
