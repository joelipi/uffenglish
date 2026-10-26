import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../../modules/store/store.js';
import { useVideoSpeed } from '../../hooks/useVideoSpeed.js';
import {
    PLAYBACK_READINESS_RETRY_MS,
    playSafely,
    retryDelayMs,
    setElementMuted,
    shouldRetryStart,
    shouldStartMuted,
    shouldWaitForReadiness,
} from '../../modules/video/playback-start-logic.js';
import { takeDiagnostics } from '../../modules/diagnostics/take-diagnostics.js';
import VideoSpeedToggle from '../VideoSpeedToggle.jsx';

const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export default function SuccessVideo() {
    const videoRef = useRef(null);
    const blob = useStore(appStore, (state) => state.successVideoBlob);
    // While the display-only after-video loop runs, the canvas owns the frame
    // and the blob is shared via the share sheet — mounting #resultVideo too
    // would stack two surfaces (stories/060-autoplay-share-video).
    const afterVideoActive = useStore(appStore, (state) => state.afterVideoActive);
    const [playing, setPlaying] = useState(false);
    // Speed toggle (1x -> 0.8x -> 0.6x -> 1x), reset per result clip.
    const [playbackRate, handleSpeedCycle] = useVideoSpeed(videoRef, blob);

    // The success clip is the same iPadOS problem as the recorded take
    // (stories/094): an unmuted play() outside a gesture is refused, WebKit can
    // return undefined from play(), and asking to play before the file is ready
    // leaves a still frame. Same ladder as PlaybackVideo: audibly once, muted
    // from the first retry, unmuted once it is really playing, and a tap (▶)
    // when the device refuses everything.
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !blob) return;

        const url = URL.createObjectURL(blob);
        video.src = url;

        let cancelled = false;
        let attempt = 0;
        let retryTimer = null;
        let readyTimer = null;
        let unmuteTimer = null;

        const handleBlocked = (error) => {
            const name = error && error.name ? error.name : null;
            console.warn('[SuccessVideo] play attempt ' + attempt + ' refused:', name || error);
            takeDiagnostics.push('success play refused', { attempt, name });
            if (!shouldRetryStart({ attempt, errorName: name })) {
                console.warn('[SuccessVideo] autoplay gave up — the learner can tap to start the clip');
                return;
            }
            const delay = retryDelayMs(attempt);
            if (delay === null) return;
            attempt += 1;
            clearTimeout(retryTimer);
            retryTimer = setTimeout(tryStart, delay);
        };

        const tryStart = () => {
            if (cancelled) return;
            const el = videoRef.current;
            if (!el) return;
            if (shouldWaitForReadiness(el.readyState)) {
                clearTimeout(readyTimer);
                readyTimer = setTimeout(tryStart, PLAYBACK_READINESS_RETRY_MS);
                return;
            }
            const muted = shouldStartMuted({ attempt, preferMutedStart: isIOS });
            setElementMuted(el, muted);
            const startState = { attempt, muted, readyState: el.readyState };
            console.log('[SuccessVideo] start attempt', startState);
            takeDiagnostics.push('success start attempt', startState);

            const { promise, error } = playSafely(el);
            if (error) {
                handleBlocked(error);
                return;
            }
            if (!promise) return;
            promise.then(() => {
                if (!muted) return;
                clearTimeout(unmuteTimer);
                unmuteTimer = setTimeout(() => {
                    const current = videoRef.current;
                    if (!current || cancelled) return;
                    // The muted start only bought autoplay permission. Rewind
                    // before the audible pass so the recap is heard from 0, never
                    // from the end of the muted lead-in.
                    try {
                        if (current.ended || current.currentTime > 0) current.currentTime = 0;
                    } catch (error) { /* best effort */ }
                    takeDiagnostics.push('success rewound before audible start');
                    setElementMuted(current, false);
                    const next = playSafely(current);
                    if (next.promise) next.promise.catch(() => {});
                // iOS re-opens the audio on the next task; Android still needs
                // the 100 ms settle for its audio route (stories/075).
                }, isIOS ? 0 : 100);
            }).catch(handleBlocked);
        };

        tryStart();

        return () => {
            cancelled = true;
            clearTimeout(retryTimer);
            clearTimeout(readyTimer);
            clearTimeout(unmuteTimer);
            URL.revokeObjectURL(url);
        };
    }, [blob]);

    const handleToggle = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            const { promise } = playSafely(video);
            if (promise) promise.catch(() => {});
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
            <VideoSpeedToggle rate={playbackRate} onCycle={handleSpeedCycle} />
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
