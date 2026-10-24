import { useEffect, useRef } from 'react';
import { appStore } from '../modules/store/store.js';
import { usePlaybackVideo } from '../hooks/usePlaybackVideo.js';
import { useVideoSpeed } from '../hooks/useVideoSpeed.js';
import { createAudioGuard } from '../modules/video/audio-guard.js';
import {
    describeStartState,
    playSafely,
    resolveTapAction,
    retryDelayMs,
    setElementMuted,
    shouldAttemptStart,
    shouldPauseOffscreen,
    shouldRetryStart,
    shouldStartMuted,
} from '../modules/video/playback-start-logic.js';
import VideoSpeedToggle from './VideoSpeedToggle.jsx';

// Intentional navigator sniff — guarded with typeof checks. In React Native
// navigator is undefined → isIOS is false (native video player handles iOS specifics).
const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export default function PlaybackVideo() {
    const { blob, autoplay, isMuted, visible, clearVideo, videoPlayTrigger, videoClearTrigger, mediaState } = usePlaybackVideo();

    const videoRef = useRef(null);
    const observerRef = useRef(null);
    const prevClearTrigger = useRef(videoClearTrigger);
    const prevPlayTrigger = useRef(videoPlayTrigger);
    // The audio guard watches the element while the clip plays and repairs one
    // that ends up muted — the Android-only silent start of the recorded take
    // (stories/075-fix-android-silent-video-start).
    const audioGuardRef = useRef(null);
    // True while the clip is supposed to be SILENT. Two things make it so: the
    // learner tapped the clip to mute it, and the clip already played once and
    // now loops silently (hearing yourself twice is worse than hearing yourself
    // once). The guard must not fight either of them.
    const muteIntentRef = useRef(false);
    // Whether this clip has ever actually started. Until it has, the start path
    // keeps trying (and the viewport observer is not allowed to pause it);
    // afterwards the clip belongs to the learner (stories/094).
    const hasStartedRef = useRef(false);
    // The pending retry of the autoplay ladder, and the delayed unmute that
    // follows a muted start. Both are cleared when the clip changes or the
    // player unmounts, so a stale timer cannot touch the next take.
    const retryTimerRef = useRef(null);
    const unmuteTimerRef = useRef(null);
    // The start path nudges `load()` at most once per element+source: a second
    // load() aborts the resource selection in flight (iPadOS defers loading, so
    // the element can sit at HAVE_NOTHING with no `canplay` coming).
    const loadedElementRef = useRef({ element: null, key: null });
    // The rung of the autoplay ladder we are on. A readiness event must CONTINUE
    // the ladder, not restart it at the audible rung — otherwise every `canplay`
    // asks iPadOS for the unmuted start it just refused.
    const attemptRef = useRef(0);
    // Speed toggle (1x -> 0.8x -> 0.6x -> 1x), reset per recording.
    const [playbackRate, handleSpeedCycle] = useVideoSpeed(videoRef, blob);

    const clearRetry = () => {
        if (retryTimerRef.current !== null) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
    };

    const clearUnmuteTimer = () => {
        if (unmuteTimerRef.current !== null) {
            clearTimeout(unmuteTimerRef.current);
            unmuteTimerRef.current = null;
        }
    };

    /**
     * Ask the element to load its source exactly once per element+source.
     * Only when it is genuinely idle: a load already in flight must not be
     * aborted, and `NETWORK_EMPTY` is the browser saying it has nothing.
     */
    const ensureLoaded = (video) => {
        if (!video || video.readyState !== 0 || video.networkState !== 0) return;
        const key = video.currentSrc || video.src || '';
        if (loadedElementRef.current.element === video && loadedElementRef.current.key === key) return;
        loadedElementRef.current = { element: video, key };
        try {
            video.load();
            console.log('[Playback] source was idle at HAVE_NOTHING — load() requested');
        } catch (e) {
            console.warn('[Playback] load() failed:', e && e.message ? e.message : e);
        }
    };

    /**
     * A muted start succeeded: re-open the audio output. Clearing `muted` alone
     * is not enough on a browser that already tore the output down, so playback
     * is re-issued as well (stories/075). The learner's own mute intent wins.
     */
    const unmuteAfterStart = () => {
        clearUnmuteTimer();
        unmuteTimerRef.current = setTimeout(() => {
            unmuteTimerRef.current = null;
            const el = videoRef.current;
            if (!el || muteIntentRef.current) return;
            setElementMuted(el, false);
            const { promise, error } = playSafely(el);
            if (promise) promise.catch(() => {});
            if (error) console.warn('[Playback] could not re-open audio:', error && error.message ? error.message : error);
            console.log('[Playback] unmuted after the muted start');
        }, 100);
    };

    const scheduleRetry = (attempt) => {
        const delay = retryDelayMs(attempt);
        if (delay === null) return;
        clearRetry();
        retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            attemptStart(attempt + 1);
        }, delay);
    };

    const handleBlockedStart = (attempt, error) => {
        const name = error && error.name ? error.name : null;
        console.warn('[Playback] play attempt ' + attempt + ' refused:', name || error || 'unknown', describeStartState(videoRef.current));
        if (!shouldRetryStart({ attempt, errorName: name })) {
            console.warn('[Playback] autoplay gave up after ' + (attempt + 1) + ' attempts — the learner can tap the clip to start it');
            return;
        }
        scheduleRetry(attempt);
    };

    /**
     * One rung of the autoplay ladder. Attempt 0 asks for sound; every retry is
     * muted, because iPadOS refuses an unmuted play() that is not in the same
     * task as a gesture and allows the muted start.
     */
    const attemptStart = (attempt = 0) => {
        const video = videoRef.current;
        if (!video) return;
        if (!video.paused) return;
        attemptRef.current = attempt;

        const muted = shouldStartMuted({ attempt, muteIntent: muteIntentRef.current });
        const applied = setElementMuted(video, muted);
        if (attempt === 0 && !muted) {
            // A fresh clip is audible; mirror the state so the player and the
            // audio guard agree about what this attempt is asking for.
            appStore.getState().setPlaybackMuted(false);
        }
        if (!applied) {
            console.warn('[Playback] could not set the element mute state', describeStartState(video));
        }

        ensureLoaded(video);
        const { promise, error } = playSafely(video);
        console.log('[Playback] start attempt ' + attempt + ' muted=' + muted, describeStartState(video));

        if (error) {
            handleBlockedStart(attempt, error);
            return;
        }
        if (!promise) {
            // WebKit can return undefined from play(); there is nothing to
            // await, and the `playing` event is the only confirmation.
            console.log('[Playback] play() returned no promise (WebKit) — waiting for the playing event');
            return;
        }
        promise.then(() => {
            if (muted && !muteIntentRef.current) unmuteAfterStart();
        }).catch((e) => handleBlockedStart(attempt, e));
    };

    /** Any readiness signal is a chance to start; the first successful one wins. */
    const handleReady = () => {
        const video = videoRef.current;
        if (!video) return;
        if (mediaState === 'chat') return;
        if (!shouldAttemptStart({ paused: video.paused, hasStarted: hasStartedRef.current, autoplay })) return;
        attemptStart(attemptRef.current);
    };

    const handleVideoPlaying = () => {
        hasStartedRef.current = true;
        attemptRef.current = 0;
        clearRetry();
    };

    const handleVideoEnded = () => {
        const video = videoRef.current;
        if (!video) return;
        // The clip has played once with sound; from now on it loops silently.
        // The mute is intentional, so the audio guard must stand down.
        muteIntentRef.current = true;
        setElementMuted(video, true);
        video.loop = true;
        appStore.getState().setPlaybackMuted(true);
        const { promise } = playSafely(video);
        if (promise) promise.catch(e => console.warn('[playback] replay after mute failed:', e));
    };

    const handleVideoError = () => {
        const video = videoRef.current;
        if (!video) return;
        try {
            const alternativeBlob = new Blob([blob], { type: 'video/mp4' });
            video.src = URL.createObjectURL(alternativeBlob);
        } catch (e) { }
    };

    const handleTakeTap = () => {
        const video = videoRef.current;
        if (!video) return;
        const action = resolveTapAction({ paused: video.paused, muted: video.muted === true });
        if (action === 'play') {
            // A tap is a gesture, so this is the one attempt that can start the
            // clip with sound on iPad (stories/094). The learner's mute intent
            // is unchanged.
            attemptStart(0);
            return;
        }
        const next = action === 'mute';
        // The learner's own choice: the guard must not undo it.
        muteIntentRef.current = next;
        setElementMuted(video, next);
        appStore.getState().setPlaybackMuted(next);
    };

    const handleLoadedMetadata = () => {
        const video = videoRef.current;
        if (!video) return;

        if (observerRef.current) observerRef.current.disconnect();
        observerRef.current = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (shouldPauseOffscreen({ isIntersecting: entry.isIntersecting, hasStarted: hasStartedRef.current }) && !video.paused) {
                    video.pause();
                }
            });
        }, { threshold: 0.1 });
        requestAnimationFrame(() => {
            if (observerRef.current && video) {
                observerRef.current.observe(video);
            }
        });

        handleReady();
    };

    // The audio guard. It samples the element while the clip plays and repairs
    // one that ends up muted, and it logs the audio state so the next field
    // report names the mechanism (stories/075-fix-android-silent-video-start).
    useEffect(() => {
        const guard = createAudioGuard({
            getElement: () => videoRef.current,
            isExpectedAudible: () => !muteIntentRef.current,
            play: () => {
                const { promise } = playSafely(videoRef.current);
                if (promise) promise.catch(() => {});
            },
        });
        audioGuardRef.current = guard;
        return () => {
            guard.stop();
            audioGuardRef.current = null;
        };
    }, []);

    // Blob URL management
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        // A new take starts from scratch: nothing has started yet, and no timer
        // from the previous clip may fire into this one.
        clearRetry();
        clearUnmuteTimer();
        hasStartedRef.current = false;
        attemptRef.current = 0;
        loadedElementRef.current = { element: null, key: null };

        if (!blob) {
            video.pause();
            if (video.src && video.src.startsWith('blob:')) {
                URL.revokeObjectURL(video.src);
            }
            video.src = '';
            video.load();
            return;
        }

        // A new clip starts audible: the learner has not muted it yet and it
        // has not looped once.
        muteIntentRef.current = false;

        if (video.src && video.src.startsWith('blob:')) {
            URL.revokeObjectURL(video.src);
        }

        video.src = URL.createObjectURL(blob);

        // Kick the start now: iPadOS defers media loading, so waiting for an
        // event that may never come is how the clip stayed a still frame.
        attemptStart(0);

        return () => {
            clearRetry();
            clearUnmuteTimer();
            if (video.src && video.src.startsWith('blob:')) {
                URL.revokeObjectURL(video.src);
            }
        };
    }, [blob]);

    // Clear trigger
    useEffect(() => {
        if (videoClearTrigger === prevClearTrigger.current) return;
        prevClearTrigger.current = videoClearTrigger;
        clearVideo();
    }, [videoClearTrigger]);

    // Play trigger
    useEffect(() => {
        if (videoPlayTrigger === prevPlayTrigger.current) return;
        prevPlayTrigger.current = videoPlayTrigger;
        const video = videoRef.current;
        if (video) {
            // The store mirrors the learner's mute intent, so the guard reads
            // the same intent from here on.
            muteIntentRef.current = appStore.getState().isPlaybackMuted === true;
            setElementMuted(video, isMuted);
            const { promise } = playSafely(video);
            if (promise) promise.catch(e => console.warn('[playback] Playback resume failed:', e));
        }
    }, [videoPlayTrigger]);

    // Pause when triggerPauseAllVideos fires
    useEffect(() => {
        const unsub = appStore.subscribe((state, prev) => {
            if (state.pauseAllVideosTrigger !== prev.pauseAllVideosTrigger) {
                videoRef.current?.pause();
            }
        });
        return unsub;
    }, []);

    // Unmount: no pending start may fire into a gone element, and the viewport
    // observer must let go of it (it would otherwise keep observing a detached
    // video element for the life of the page).
    useEffect(() => () => {
        clearRetry();
        clearUnmuteTimer();
        if (observerRef.current) {
            observerRef.current.disconnect();
            observerRef.current = null;
        }
    }, []);

    if (!blob) return null;

    return (
        <div id="playback-video-wrapper"
            className={`playback-video-container position-absolute top-0 start-0 w-100 h-100 ${visible ? '' : 'd-none'}`}
            style={{ zIndex: 10 }}>
            <video ref={videoRef} id="playback-video" playsInline preload="auto" controls={isIOS} muted={isMuted} onEnded={handleVideoEnded} onError={handleVideoError} onLoadedData={handleReady} onCanPlay={handleReady} onLoadedMetadata={handleLoadedMetadata}
                onPlay={() => audioGuardRef.current?.start()}
                onPlaying={handleVideoPlaying}
                onPause={() => audioGuardRef.current?.stop()}
                onClick={handleTakeTap}
                style={{ cursor: 'pointer' }} />
            <VideoSpeedToggle rate={playbackRate} onCycle={handleSpeedCycle} />
        </div>
    );
}
