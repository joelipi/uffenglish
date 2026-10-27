import { useEffect, useRef } from 'react';
import { appStore } from '../modules/store/store.js';
import { usePlaybackVideo } from '../hooks/usePlaybackVideo.js';
import { useVideoSpeed } from '../hooks/useVideoSpeed.js';
import { createAudioGuard } from '../modules/video/audio-guard.js';
import {
    PLAYBACK_READINESS_MAX_WAIT_MS,
    PLAYBACK_READINESS_RETRY_MS,
    PLAYBACK_STALL_CHECK_MS,
    describePlaybackSample,
    describeStartState,
    describeTakeMedia,
    playSafely,
    resolveTapAction,
    retryDelayMs,
    setElementMuted,
    shouldAttemptStart,
    shouldKickStalledPlayback,
    shouldPauseOffscreen,
    shouldRetryStart,
    shouldStartMuted,
    shouldWaitForReadiness,
} from '../modules/video/playback-start-logic.js';
import { takeDiagnostics } from '../modules/diagnostics/take-diagnostics.js';
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
    // One delayed sample of the playing clip, so a report can say whether the
    // take decoded frames (a presentation/recording problem) or decoded none
    // (an audio-only or undecodable file).
    const sampleTimerRef = useRef(null);
    // A not-yet-ready element must not be asked to play (WebKit accepts the call
    // and sits at HAVE_NOTHING, which is how a take ends up on a still frame
    // with `paused:false`). This retries the SAME rung until it is ready.
    const readinessTimerRef = useRef(null);
    const waitingSinceRef = useRef(null);
    // Defer the first kick by a macrotask: assigning `src` queues the media
    // load algorithm, and on iPadOS the element can still report the PREVIOUS
    // take's readyState for that instant. A synchronous start then asks to play
    // too early — the field report where the take only plays when the
    // diagnostics panel's extra work changes the timing.
    const startKickRef = useRef(null);
    const clearStartKick = () => {
        if (startKickRef.current !== null) {
            clearTimeout(startKickRef.current);
            startKickRef.current = null;
        }
    };
    // A started element whose clock never moves is kicked once.
    const stallTimerRef = useRef(null);
    const startedAtRef = useRef({ at: 0, time: 0 });
    const stallKickedRef = useRef(false);
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

    const clearSampleTimer = () => {
        if (sampleTimerRef.current !== null) {
            clearTimeout(sampleTimerRef.current);
            sampleTimerRef.current = null;
        }
    };

    const clearReadinessTimer = () => {
        if (readinessTimerRef.current !== null) {
            clearTimeout(readinessTimerRef.current);
            readinessTimerRef.current = null;
        }
    };

    const clearStallTimer = () => {
        if (stallTimerRef.current !== null) {
            clearTimeout(stallTimerRef.current);
            stallTimerRef.current = null;
        }
    };

    // The silent-loop replay after the first play. A pending replay must not
    // fire into the next take (or a gone element), like every other timer here.
    // The <video> element itself persists across takes (only its src changes),
    // so element identity cannot tell takes apart: the generation does.
    const replayTimerRef = useRef(null);
    const replayGenRef = useRef(0);
    const clearReplayTimer = () => {
        if (replayTimerRef.current !== null) {
            clearTimeout(replayTimerRef.current);
            replayTimerRef.current = null;
        }
    };

    /** Retry the same ladder rung once the element is ready (never mute for this). */
    const scheduleReadinessRetry = (attempt) => {
        clearReadinessTimer();
        readinessTimerRef.current = setTimeout(() => {
            readinessTimerRef.current = null;
            attemptStart(attempt);
        }, PLAYBACK_READINESS_RETRY_MS);
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
     *
     * The muted start only bought the autoplay permission. Rewind it before the
     * audible pass, or the learner hears the take from 100 ms in and thinks the
     * beginning of their recording was cut off.
     */
    const unmuteAfterStart = () => {
        clearUnmuteTimer();
        unmuteTimerRef.current = setTimeout(() => {
            unmuteTimerRef.current = null;
            const el = videoRef.current;
            if (!el || muteIntentRef.current) return;
            const rewindFrom = typeof el.currentTime === 'number' ? el.currentTime : null;
            try {
                if (el.ended || el.currentTime > 0) el.currentTime = 0;
            } catch (error) {
                console.warn('[Playback] could not rewind before the audible start:', error && error.message ? error.message : error);
            }
            takeDiagnostics.push('rewound before audible start', { from: rewindFrom });
            setElementMuted(el, false);
            const { promise, error } = playSafely(el);
            if (promise) promise.catch(() => {});
            if (error) console.warn('[Playback] could not re-open audio:', error && error.message ? error.message : error);
            console.log('[Playback] unmuted after the muted start');
            takeDiagnostics.push('unmuted after muted start');
            // iOS starts muted only to satisfy autoplay; re-open the audio on
            // the next task so the muted lead-in is at most a frame. Android
            // still needs the 100 ms settle for its audio route (stories/075).
        }, isIOS ? 0 : 100);
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
            // The mute we applied was only ever there to satisfy an autoplay
            // attempt. Left on a paused clip it makes the NATIVE play control
            // start silently — it never runs this component's tap handler
            // (field report: "touching the play button plays muted, touching
            // anywhere else plays with sound"). Clear it once we stop trying.
            const el = videoRef.current;
            if (el && !muteIntentRef.current) {
                setElementMuted(el, false);
                appStore.getState().setPlaybackMuted(false);
                console.log('[Playback] cleared the technical mute after giving up');
                takeDiagnostics.push('cleared mute after giving up');
            }
            return;
        }
        scheduleRetry(attempt);
    };

    /**
     * One rung of the autoplay ladder. Attempt 0 asks for sound; every retry is
     * muted, because iPadOS refuses an unmuted play() that is not in the same
     * task as a gesture and allows the muted start.
     */
    const attemptStart = (attempt = 0, { fromGesture = false } = {}) => {
        const video = videoRef.current;
        if (!video) return;
        if (!video.paused) return;
        attemptRef.current = attempt;

        // Wait for HAVE_CURRENT_DATA before asking to play.
        if (shouldWaitForReadiness(video.readyState)) {
            if (waitingSinceRef.current === null) waitingSinceRef.current = Date.now();
            const waitedMs = Date.now() - waitingSinceRef.current;
            ensureLoaded(video);
            console.log('[Playback] waiting for readiness', { readyState: video.readyState, waitedMs });
            takeDiagnostics.push('waiting for readiness', { readyState: video.readyState, waitedMs });
            if (waitedMs >= PLAYBACK_READINESS_MAX_WAIT_MS) {
                console.warn('[Playback] the take never became ready — the learner can tap it');
                waitingSinceRef.current = null;
                return;
            }
            scheduleReadinessRetry(attempt);
            return;
        }
        waitingSinceRef.current = null;

        // A start the learner asked for (a tap) is always AUDIBLE: the muted
        // lead-in exists only to satisfy iOS autoplay policy, and a tap is a
        // gesture, so no policy needs satisfying. This is what stops a re-tapped
        // clip from playing silently (stories/094).
        const muted = shouldStartMuted({
            attempt,
            muteIntent: fromGesture ? false : muteIntentRef.current,
            // iPadOS refuses the unmuted start unconditionally, so ask for the
            // muted start that is actually allowed and re-open the audio after
            // it is playing (stories/094). Desktop/Android still start audible.
            preferMutedStart: fromGesture ? false : isIOS,
        });
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
        const startState = describeStartState(video);
        console.log('[Playback] start attempt ' + attempt + ' muted=' + muted, startState);
        takeDiagnostics.push('start attempt ' + attempt + ' muted=' + muted, startState);

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
        // A readiness event is the better start signal; a still-pending kick
        // must not start the ladder a second time at rung 0.
        clearStartKick();
        attemptStart(attemptRef.current);
    };

    const handleVideoPlaying = () => {
        hasStartedRef.current = true;
        attemptRef.current = 0;
        clearRetry();
        startedAtRef.current = { at: Date.now(), time: videoRef.current ? videoRef.current.currentTime : 0 };

        // A take can report `playing` and then never advance (stories/094). Kick
        // it once if the clock has not moved after the grace period.
        clearStallTimer();
        stallTimerRef.current = setTimeout(() => {
            stallTimerRef.current = null;
            const el = videoRef.current;
            if (!el || stallKickedRef.current) return;
            const elapsedSinceStartMs = Date.now() - startedAtRef.current.at;
            if (!shouldKickStalledPlayback({ paused: el.paused, currentTime: el.currentTime, elapsedSinceStartMs })) return;
            stallKickedRef.current = true;
            console.warn('[Playback] playback stalled at ' + Number(el.currentTime.toFixed(2)) + 's — re-issuing play()');
            takeDiagnostics.push('playback stalled', {
                currentTime: Number(el.currentTime.toFixed(2)),
                elapsedMs: elapsedSinceStartMs,
                readyState: el.readyState,
            });
            try { el.pause(); } catch (error) { /* ignore */ }
            const { promise } = playSafely(el);
            if (promise) promise.catch(() => {});
        }, PLAYBACK_STALL_CHECK_MS);

        // A started take is not necessarily a moving picture. Sample what it
        // actually decoded a moment in, so an iPad report can tell an audio-only
        // recording (videoWidth 0) from one that decodes no frames at all from
        // one that decodes frames without presenting them.
        clearSampleTimer();
        sampleTimerRef.current = setTimeout(() => {
            sampleTimerRef.current = null;
            const el = videoRef.current;
            if (!el) return;
            const sample = describePlaybackSample(el);
            console.log('[Playback] playback sample', sample);
            takeDiagnostics.push('playback sample', sample);
        }, 1200);
    };

    // iPadOS can ignore a play() issued synchronously inside the `ended`
    // event, which leaves the take on its last frame instead of looping
    // (stories/094). The replay is therefore deferred past the event, the clock
    // is rewound explicitly, and a refusal is retried once — with every step
    // logged so the next report names which one failed.
    const replaySilentLoop = (attempt = 0, video = null, gen = -1) => {
        if (!video || videoRef.current !== video) return;
        if (gen !== replayGenRef.current) return;
        try {
            if (video.ended && typeof video.currentTime === 'number') video.currentTime = 0;
        } catch (error) { /* rewinding is best effort; play() still restarts */ }
        const state = describeStartState(video);
        console.log('[Playback] silent-loop replay attempt ' + attempt, state);
        takeDiagnostics.push('silent-loop replay attempt ' + attempt, state);
        const { promise, error } = playSafely(video);
        if (error) {
            console.warn('[Playback] silent-loop replay threw:', error && error.message ? error.message : error);
            takeDiagnostics.push('silent-loop replay failed', { attempt, name: error && error.name ? error.name : null });
        }
        if (!promise) return;
        promise.catch((e) => {
            console.warn('[Playback] silent-loop replay refused (attempt ' + attempt + '):', e && e.name ? e.name : e);
            takeDiagnostics.push('silent-loop replay refused', { attempt, name: e && e.name ? e.name : null });
            if (attempt > 0) return;
            if (videoRef.current !== video || gen !== replayGenRef.current) return;
            clearReplayTimer();
            replayTimerRef.current = setTimeout(() => {
                replayTimerRef.current = null;
                replaySilentLoop(1, video, gen);
            }, 300);
        });
    };

    const handleVideoEnded = () => {
        const video = videoRef.current;
        if (!video) return;
        console.log('[Playback] take ended, starting the silent loop', describeStartState(video));
        takeDiagnostics.push('take ended', describeStartState(video));
        // The clip has played once with sound; from now on it loops silently.
        // The mute is intentional, so the audio guard must stand down.
        muteIntentRef.current = true;
        setElementMuted(video, true);
        video.loop = true;
        appStore.getState().setPlaybackMuted(true);
        clearReplayTimer();
        const replayVideo = video;
        const replayGen = replayGenRef.current;
        replayTimerRef.current = setTimeout(() => {
            replayTimerRef.current = null;
            replaySilentLoop(0, replayVideo, replayGen);
        }, 150);
    };

    /**
     * A pause ends the autoplay negotiation: the technical mute exists only so
     * the next play() can be allowed by iOS. Kept on a paused element it makes
     * the native play control start the take silently, so it is cleared here
     * unless the learner asked for silence (the silent loop).
     */
    const handleVideoPause = () => {
        audioGuardRef.current?.stop();
        const video = videoRef.current;
        if (!video || muteIntentRef.current) return;
        if (video.muted !== true) return;
        setElementMuted(video, false);
        appStore.getState().setPlaybackMuted(false);
        console.log('[Playback] pause cleared the technical mute — a restart will be audible');
        takeDiagnostics.push('pause cleared technical mute');
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
            // A tap is a gesture, so this is the one start that can be audible on
            // iPad. It also clears the silent-loop intent a previous run left
            // behind: otherwise a re-tapped clip would start muted and stay muted
            // (the field report "sometimes they play muted once you've tapped
            // them"). Muted is for the LOOP only.
            muteIntentRef.current = false;
            clearUnmuteTimer();
            setElementMuted(video, false);
            appStore.getState().setPlaybackMuted(false);
            attemptStart(0, { fromGesture: true });
            return;
        }
        const next = action === 'mute';
        // The learner's own choice: the guard must not undo it.
        muteIntentRef.current = next;
        setElementMuted(video, next);
        appStore.getState().setPlaybackMuted(next);

        if (!next) {
            // Unmuting a clip that is already PLAYING is a different case from
            // starting one: clearing `muted` alone can leave iOS's audio output
            // closed, so the tap sounds silent until the audio guard (or a
            // second tap) re-issues playback — the field report "the first time
            // I tapped it played muted, I have to tap again for sound". Issuing
            // play() here re-opens the output inside the gesture.
            const { promise, error } = playSafely(video);
            if (promise) promise.catch((e) => console.warn('[Playback] tap-unmute replay failed:', e && e.name ? e.name : e));
            if (error) console.warn('[Playback] tap-unmute replay threw:', error && error.message ? error.message : error);
            console.log('[Playback] tap unmuted — playback re-issued to re-open audio');
            takeDiagnostics.push('tap unmuted with replay');
        }
    };

    const handleLoadedMetadata = () => {
        const video = videoRef.current;
        if (!video) return;

        const media = describeTakeMedia(video, blob);
        console.log('[Playback] take media', media);
        takeDiagnostics.push('take media', media);
        if (media.hasVideoTrack === false) {
            console.error('[Playback] the recorded take carries no video track — only audio will play', media);
        }

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

        // A new take must not inherit the previous take's silent loop. `loop`
        // is a property on the persistent <video> element and survives a `src`
        // change, so a re-record would otherwise auto-loop from its first play
        // and never fire `ended` (which is what starts the silent loop). The
        // first take is unaffected: the property is already false.
        video.loop = false;

        // A new take starts from scratch: nothing has started yet, and no timer
        // from the previous clip may fire into this one.
        clearRetry();
        clearUnmuteTimer();
        clearSampleTimer();
        clearReadinessTimer();
        clearStallTimer();
        clearReplayTimer();
        clearStartKick();
        replayGenRef.current += 1;
        waitingSinceRef.current = null;
        stallKickedRef.current = false;
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

        // Kick the start from a macrotask, not synchronously: assigning `src`
        // queues the load algorithm, and an immediate attempt can still read
        // the previous source's readyState on iPadOS. This is still an immediate
        // kick from the learner's point of view (no event is awaited), but it
        // gives the new source one task to reach HAVE_NOTHING so the readiness
        // ladder sees the real state.
        startKickRef.current = setTimeout(() => {
            startKickRef.current = null;
            if (hasStartedRef.current || attemptRef.current !== 0) return;
            attemptStart(0);
        }, 0);

        return () => {
            clearRetry();
            clearUnmuteTimer();
            clearSampleTimer();
            clearReadinessTimer();
            clearStallTimer();
            clearReplayTimer();
            clearStartKick();
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
        clearSampleTimer();
        clearReadinessTimer();
        clearStallTimer();
        clearReplayTimer();
        clearStartKick();
        replayGenRef.current += 1;
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
                onPause={handleVideoPause}
                onClick={handleTakeTap}
                style={{ cursor: 'pointer' }} />
            <VideoSpeedToggle rate={playbackRate} onCycle={handleSpeedCycle} />
        </div>
    );
}
