// Source guards for the recorded take's autoplay start
// (stories/094-fix-ipad-recorded-take-autoplay).
//
// Guard discipline (docs/learnings.md): every slice runs from its function start
// to the NEXT real marker (never EOF); sequenced calls assert index order, not
// co-presence; absence assertions run on comment-stripped source so the guard's
// own prose cannot satisfy them.
//
// Fail-proof note: proven able to fail by temporarily (a) restoring
// `video.play().catch(` in handleVideoEnded, (b) removing `onCanPlay={handleReady}`
// from the <video> element, (c) replacing the observer's `shouldPauseOffscreen`
// call with the bare `!entry.isIntersecting`, and (d) deleting the `'play'`
// branch from handleTakeTap.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PLAYBACK_UNMUTE_FALLBACK_MS } from './playback-start-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sliceBetween(source, startToken, endToken) {
    const start = source.indexOf(startToken);
    if (start === -1) throw new Error(`start token missing: ${startToken}`);
    const end = source.indexOf(endToken, start + startToken.length);
    if (end === -1) throw new Error(`end token missing: ${endToken}`);
    return source.slice(start, end);
}

const playbackRaw = readFileSync(path.join(ROOT, 'src/components/PlaybackVideo.jsx'), 'utf8');
const playbackStripped = stripComments(playbackRaw);
const videoElement = sliceBetween(playbackRaw, '<video ref={videoRef}', "style={{ cursor: 'pointer' }} />");

describe('the take starts from every readiness signal, not one event', () => {
    it('wires canplay, loadeddata and loadedmetadata', () => {
        expect(videoElement).toContain('onCanPlay={handleReady}');
        expect(videoElement).toContain('onLoadedData={handleReady}');
        expect(videoElement).toContain('onLoadedMetadata={handleLoadedMetadata}');
    });

    it('handleLoadedMetadata asks the same start path as the other events', () => {
        const handler = sliceBetween(playbackRaw, 'const handleLoadedMetadata = () => {', '\n    };');
        expect(handler).toContain('handleReady();');
    });

    it('handleReady continues the ladder instead of restarting the audible rung', () => {
        const handler = sliceBetween(playbackRaw, 'const handleReady = () => {', '\n    };');
        expect(handler).toContain('shouldAttemptStart(');
        expect(handler).toContain('attemptStart(attemptRef.current);');
        // The gate decides first: a clip the learner paused after it played is
        // not restarted by a late readiness event.
        expect(handler.indexOf('shouldAttemptStart(')).toBeLessThan(handler.indexOf('attemptStart(attemptRef.current);'));
        // Restarting at rung 0 would ask iPadOS for the unmuted start it just
        // refused, once per readiness event.
        expect(handler).not.toContain('attemptStart(0)');
    });

    it('kicks the start when the fresh blob is handed over', () => {
        const blobEffect = sliceBetween(playbackRaw, '// Blob URL management', '// Clear trigger');
        expect(blobEffect).toContain('attemptStart(0);');
        // iPadOS defers loading: the kick must not wait for an event.
        expect(blobEffect.indexOf('video.src = URL.createObjectURL(blob);'))
            .toBeLessThan(blobEffect.indexOf('attemptStart(0);'));
    });

    it('marks the clip started on the playing event and clears pending retries', () => {
        expect(videoElement).toContain('onPlaying={handleVideoPlaying}');
        const handler = sliceBetween(playbackRaw, 'const handleVideoPlaying = () => {', '\n    };');
        expect(handler).toContain('hasStartedRef.current = true;');
        expect(handler).toContain('clearRetry();');
    });
});

describe('a new take starts from its own state', () => {
    it('clears the previous take\'s persistent loop before assigning the new source', () => {
        const blobEffect = sliceBetween(playbackRaw, '// Blob URL management', '// Clear trigger');
        expect(blobEffect).toContain('video.loop = false;');
        // `loop` is a property on the persistent element, so assigning a new src
        // does not reset it; a re-record must not auto-loop from its first play.
        expect(blobEffect.indexOf('video.loop = false;'))
            .toBeLessThan(blobEffect.indexOf('video.src = URL.createObjectURL(blob);'));
    });
});

describe('the first kick waits for the new source to reset', () => {
    it('defers the kick to a macrotask and clears it on a readiness event and unmount', () => {
        const blobEffect = sliceBetween(playbackRaw, '// Blob URL management', '// Clear trigger');
        expect(blobEffect).toContain('startKickRef.current = setTimeout');
        // The timer must be scheduled AFTER the new source is assigned, so the
        // load algorithm has a task to reset readyState first.
        expect(blobEffect.indexOf('video.src = URL.createObjectURL(blob);'))
            .toBeLessThan(blobEffect.indexOf('startKickRef.current = setTimeout'));
        const kick = sliceBetween(blobEffect, 'startKickRef.current = setTimeout', '}, 0);');
        expect(kick).toContain('attemptStart(0);');
        // A readiness event starts the ladder itself; the pending kick must not
        // start it again at rung 0 after the refusal.
        const ready = sliceBetween(playbackRaw, 'const handleReady = () => {', '\n    };');
        expect(ready).toContain('clearStartKick();');
        const cleanup = sliceBetween(playbackRaw, 'useEffect(() => () => {', '\n    }, []);');
        expect(cleanup).toContain('clearStartKick();');
    });
});

describe('the start path survives WebKit returning undefined from play()', () => {
    it('imports playSafely from the video module', () => {
        expect(playbackRaw).toContain('playSafely,');
        expect(playbackRaw).toContain("} from '../modules/video/playback-start-logic.js';");
    });

    it('never calls .play().catch( directly (the undefined-return crash shape)', () => {
        expect(playbackStripped).not.toContain('.play().catch(');
        expect(playbackStripped).not.toContain('?.play().catch(');
    });

    it('routes every start through playSafely', () => {
        ['attemptStart', 'replaySilentLoop', 'unmuteNow'].forEach((name) => {
            const fn = sliceBetween(playbackRaw, `const ${name} = `, '\n    };');
            expect(fn, name).toContain('playSafely(');
        });
    });

    it('defers the silent-loop replay past the ended event instead of playing inside it', () => {
        const handler = sliceBetween(playbackRaw, 'const handleVideoEnded = () => {', '\n    };');
        // iPadOS can ignore a play() issued synchronously inside `ended`.
        expect(handler).toContain('replaySilentLoop(0, replayVideo, replayGen)');
        expect(handler).toContain('clearReplayTimer()');
        const replay = sliceBetween(playbackRaw, 'const replaySilentLoop = (attempt = 0, video = null, gen = -1) => {', '\n    };');
        expect(replay).toContain('video.currentTime = 0');
        expect(replay.indexOf('video.currentTime = 0')).toBeLessThan(replay.indexOf('playSafely(video)'));
        expect(replay).toContain('setTimeout(');
        // The element persists across takes (only src changes), so a late
        // rejection from take A must not replay take B: the generation captured
        // at schedule time has to match, at entry AND in the retry.
        expect(replay).toContain('gen !== replayGenRef.current');
        expect(replay).toContain('videoRef.current !== video');
        expect(replay.indexOf('gen !== replayGenRef.current'))
            .toBeLessThan(replay.indexOf('video.currentTime = 0'));
        expect(playbackRaw).toContain('replayGenRef.current += 1;');
    });
});

describe('the start ladder asks for sound once then falls back to muted', () => {
    const attemptStart = sliceBetween(playbackRaw, 'const attemptStart = (attempt = 0, { fromGesture = false } = {}) => {', '\n    };');

    it('derives the mute state from the ladder rule', () => {
        expect(attemptStart).toContain('shouldStartMuted({');
        expect(attemptStart).toContain('muteIntent: fromGesture ? false : muteIntentRef.current');
        // iPadOS refuses the unmuted start unconditionally, so iOS asks for the
        // muted start from attempt 0 and re-opens the audio once playing. A
        // gesture start is exempt (see the tap tests below).
        expect(attemptStart).toContain('preferMutedStart: fromGesture ? false : isIOS');
        expect(attemptStart).toContain('setElementMuted(video, muted)');
        // The mute must be applied BEFORE play() is asked for: a muted start is
        // only allowed once the element already carries the muted attribute.
        expect(attemptStart.indexOf('setElementMuted(video, muted)'))
            .toBeLessThan(attemptStart.indexOf('playSafely(video)'));
    });

    it('goes through the retry gate for a refusal', () => {
        expect(attemptStart).toContain('handleBlockedStart(attempt,');
        const blocked = sliceBetween(playbackRaw, 'const handleBlockedStart = (attempt, error) => {', '\n    };');
        expect(blocked).toContain('shouldRetryStart({ attempt, errorName: name })');
        expect(blocked.indexOf('shouldRetryStart(')).toBeLessThan(blocked.indexOf('scheduleRetry(attempt);'));
    });

    it('schedules the next rung with the ladder delay, one timer at a time', () => {
        const retry = sliceBetween(playbackRaw, 'const scheduleRetry = (attempt) => {', '\n    };');
        expect(retry).toContain('retryDelayMs(attempt)');
        expect(retry).toContain('clearRetry();');
        expect(retry.indexOf('retryDelayMs(attempt)')).toBeLessThan(retry.indexOf('clearRetry();'));
        expect(retry).toContain('attemptStart(attempt + 1)');
    });

    it('unmutes only after the muted start succeeded, and re-issues play after the unmute', () => {
        const unmute = sliceBetween(playbackRaw, 'const unmuteNow = () => {', '\n    };');
        expect(unmute).toContain('if (!el || muteIntentRef.current) return;');
        expect(unmute.indexOf('setElementMuted(el, false)')).toBeLessThan(unmute.indexOf('playSafely(el)'));
        // The muted start was only the autoplay permission handshake: rewind it
        // before the audible pass so the learner hears the take from 0, not from
        // the end of the muted lead-in.
        expect(unmute).toContain('el.currentTime = 0');
        expect(unmute.indexOf('el.currentTime = 0')).toBeLessThan(unmute.indexOf('setElementMuted(el, false)'));
        expect(unmute).toContain("takeDiagnostics.push('rewound before audible start'");
        // Reached only from the muted-start success path.
        expect(attemptStart).toContain("pendingUnmuteRef.current = true;");
    });

    it('re-opens the audio on `playing`, not when play() resolves', () => {
        // The field report: the take never played unless ?diag=1 changed the
        // timing. Unmuting before the element has presented a frame is what lets
        // WebKit revoke the muted-autoplay allowance and pause the take, so the
        // audible pass hangs off `playing` (with a fallback for a browser that
        // never fires it) instead of the play() promise.
        const playing = sliceBetween(playbackRaw, 'const handleVideoPlaying = () => {', '\n    };');
        expect(playing).toContain('shouldUnmuteTechnicalMute(');
        expect(playing).toContain('scheduleUnmute(');
        expect(playing.indexOf('shouldUnmuteTechnicalMute(')).toBeLessThan(playing.indexOf('scheduleUnmute('));
        expect(videoElement).toContain('onPlaying={handleVideoPlaying}');
        // The start no longer schedules the unmute itself...
        expect(attemptStart).not.toContain('unmuteNow()');
        // ...and the fallback is long enough to be a fallback, not the plan.
        expect(attemptStart).toContain('scheduleUnmute(PLAYBACK_UNMUTE_FALLBACK_MS)');
        expect(PLAYBACK_UNMUTE_FALLBACK_MS).toBeGreaterThanOrEqual(500);
    });

    it('restarts a take the element left paused before it ever played', () => {
        // Nothing may depend on one more readiness event arriving after the
        // element paused (the ?diag=1 race): the watchdog looks at the element.
        const watchdog = sliceBetween(playbackRaw, 'const checkStartWatchdog = () => {', '\n    };');
        expect(watchdog).toContain('resolveStartRecovery(');
        expect(watchdog).toContain("if (action === 'restart') {");
        expect(watchdog).toContain('attemptStart(attemptRef.current);');
        expect(watchdog).toContain('armStartWatchdog();');
        expect(watchdog.indexOf('resolveStartRecovery(')).toBeLessThan(watchdog.indexOf('attemptStart(attemptRef.current);'));
        // Armed by every start attempt, and stood down once playback really began.
        expect(attemptStart).toContain('armStartWatchdog();');
        const playing = sliceBetween(playbackRaw, 'const handleVideoPlaying = () => {', '\n    };');
        expect(playing).toContain('clearStartWatchdog();');
        // Every timer is cleared with the others, so a watchdog cannot fire into
        // the next take or a gone element.
        const blobEffect = sliceBetween(playbackRaw, '// Blob URL management', '// Clear trigger');
        expect(blobEffect).toContain('clearStartWatchdog();');
        expect(blobEffect).toContain('startWatchdogBeganRef.current = 0;');
        const cleanup = sliceBetween(playbackRaw, 'useEffect(() => () => {', '\n    }, []);');
        expect(cleanup).toContain('clearStartWatchdog();');
        // A ladder that gave up is left alone: the learner taps instead.
        const blocked = sliceBetween(playbackRaw, 'const handleBlockedStart = (attempt, error) => {', '\n    };');
        expect(blocked).toContain('startGaveUpRef.current = true;');
    });

    it('nudges load() at most once per element+source, and only when the source is idle', () => {
        const ensure = sliceBetween(playbackRaw, 'const ensureLoaded = (video) => {', '\n    };');
        expect(ensure).toContain('video.readyState !== 0 || video.networkState !== 0');
        expect(ensure).toContain('loadedElementRef.current.element === video');
        expect(ensure.indexOf('loadedElementRef.current.element === video'))
            .toBeLessThan(ensure.indexOf('video.load()'));
    });
});

describe('the take is not paused before it has ever started', () => {
    it('goes through shouldPauseOffscreen', () => {
        const handler = sliceBetween(playbackRaw, 'const handleLoadedMetadata = () => {', '\n    };');
        expect(handler).toContain('shouldPauseOffscreen({ isIntersecting: entry.isIntersecting, hasStarted: hasStartedRef.current })');
        expect(handler.indexOf('shouldPauseOffscreen(')).toBeLessThan(handler.indexOf('video.pause();'));
    });

    it('lets the observer go on unmount', () => {
        const cleanup = sliceBetween(playbackRaw, 'useEffect(() => () => {', '\n    }, []);');
        expect(cleanup).toContain('observerRef.current.disconnect();');
        // Timers must be cleared in the same cleanup — a pending start into a
        // gone element is the other half of the same leak.
        expect(cleanup).toContain('clearRetry();');
        expect(cleanup).toContain('clearUnmuteTimer();');
    });
});

describe('a tap on a paused take plays it', () => {
    it('routes the tap through the tap rule', () => {
        expect(videoElement).toContain('onClick={handleTakeTap}');
        const handler = sliceBetween(playbackRaw, 'const handleTakeTap = () => {', '\n    };');
        expect(handler).toContain('resolveTapAction({ paused: video.paused, muted: video.muted === true })');
    });

    it('starts playback for the play action instead of toggling the sound', () => {
        const handler = sliceBetween(playbackRaw, 'const handleTakeTap = () => {', '\n    };');
        const playBranch = sliceBetween(handler, "if (action === 'play') {", '\n        }');
        expect(playBranch).toContain('attemptStart(0, { fromGesture: true });');
        // The mute path must be the OTHER branch: a tap that only flips sound
        // leaves the learner looking at a still frame.
        expect(handler.indexOf("if (action === 'play') {"))
            .toBeLessThan(handler.indexOf('setElementMuted(video, next)'));
    });

    it('records the learner\'s mute intent before muting', () => {
        const handler = sliceBetween(playbackRaw, 'const handleTakeTap = () => {', '\n    };');
        expect(handler.indexOf('muteIntentRef.current = next;'))
            .toBeLessThan(handler.indexOf('setElementMuted(video, next);'));
    });
});

describe('a started take that looks still names its own shape', () => {
    it('logs what the recorded take contains when the metadata lands', () => {
        const handler = sliceBetween(playbackRaw, 'const handleLoadedMetadata = () => {', '\n    };');
        expect(handler).toContain('describeTakeMedia(video, blob)');
        // An audio-only take must be an ERROR line, not a silent detail: it is
        // the difference between "fix the encoder" and "fix the player".
        expect(handler).toContain('media.hasVideoTrack === false');
        expect(handler.indexOf('describeTakeMedia(video, blob)'))
            .toBeLessThan(handler.indexOf('media.hasVideoTrack === false'));
    });

    it('samples the decoded frames a moment after playback started', () => {
        const handler = sliceBetween(playbackRaw, 'const handleVideoPlaying = () => {', '\n    };');
        expect(handler).toContain('describePlaybackSample(el)');
        expect(handler).toContain('clearSampleTimer();');
    });

    it('clears the sample timer with the other timers on unmount and on a new clip', () => {
        const blobEffect = sliceBetween(playbackRaw, '// Blob URL management', '// Clear trigger');
        expect(blobEffect).toContain('clearSampleTimer();');
        const cleanup = sliceBetween(playbackRaw, 'useEffect(() => () => {', '\n    }, []);');
        expect(cleanup).toContain('clearSampleTimer();');
    });
});

describe('a not-yet-ready take is not asked to play, and a stalled one is kicked', () => {
    const attemptStart = () => sliceBetween(playbackRaw, 'const attemptStart = (attempt = 0, { fromGesture = false } = {}) => {', '\n    };');

    it('waits for HAVE_CURRENT_DATA before calling play()', () => {
        const body = attemptStart();
        expect(body).toContain('shouldWaitForReadiness(video.readyState)');
        // The readiness branch must return BEFORE playSafely, or the element is
        // asked to play at HAVE_NOTHING (the stalled-first-frame shape).
        expect(body.indexOf('shouldWaitForReadiness(video.readyState)')).toBeLessThan(body.indexOf('playSafely(video)'));
        expect(body).toContain('scheduleReadinessRetry(attempt);');
        expect(body).toContain('PLAYBACK_READINESS_MAX_WAIT_MS');
    });

    it('retries the SAME rung while waiting (it must not fall back to muted)', () => {
        const retry = sliceBetween(playbackRaw, 'const scheduleReadinessRetry = (attempt) => {', '\n    };');
        expect(retry).toContain('attemptStart(attempt);');
        expect(retry).toContain('PLAYBACK_READINESS_RETRY_MS');
        expect(retry).not.toContain('attemptStart(attempt + 1)');
    });

    it('kicks a playing clip whose clock never moved, once', () => {
        const body = sliceBetween(playbackRaw, 'const handleVideoPlaying = () => {', '\n    };');
        expect(body).toContain('shouldKickStalledPlayback(');
        expect(body).toContain('stallKickedRef.current = true;');
        // A pause is what restarts the renderer; a bare play() is a no-op.
        expect(body).toContain('el.pause()');
        expect(body.indexOf('shouldKickStalledPlayback(')).toBeLessThan(body.indexOf('el.pause()'));
    });

    it('clears the readiness, stall and replay timers with the others', () => {
        const cleanup = sliceBetween(playbackRaw, 'useEffect(() => () => {', '\n    }, []);');
        expect(cleanup).toContain('clearReadinessTimer();');
        expect(cleanup).toContain('clearStallTimer();');
        expect(cleanup).toContain('clearReplayTimer();');
        const blobEffect = sliceBetween(playbackRaw, '// Blob URL management', '// Clear trigger');
        expect(blobEffect).toContain('clearReadinessTimer();');
        expect(blobEffect).toContain('clearStallTimer();');
        expect(blobEffect).toContain('clearReplayTimer();');
        expect(blobEffect).toContain('stallKickedRef.current = false;');
    });
});


// stories/094: a tap must be AUDIBLE on every platform. The muted lead-in only
// exists to satisfy iOS autoplay policy, and a tap is a gesture, so a
// learner-started clip must never play muted (the field report "sometimes they
// play muted once you've tapped them"). Muted is for the silent LOOP only.
describe('a tap starts the take with sound', () => {
    const handler = sliceBetween(playbackRaw, 'const handleTakeTap = () => {', '\n    };');
    const playBranch = sliceBetween(handler, "if (action === 'play') {", '\n        }');

    it('clears the silent-loop intent before starting', () => {
        expect(playBranch).toContain('muteIntentRef.current = false;');
        expect(playBranch).toContain('setPlaybackMuted(false)');
        // The intent has to be cleared BEFORE the start is attempted, otherwise
        // the start still reads the previous run's silence.
        expect(playBranch.indexOf('muteIntentRef.current = false;'))
            .toBeLessThan(playBranch.indexOf('attemptStart(0, { fromGesture: true });'));
        expect(playBranch).toContain('setElementMuted(video, false)');
        expect(playBranch).toContain('clearUnmuteTimer()');
    });

    it('a gesture start never asks for the muted iOS lead-in', () => {
        const attemptStart = sliceBetween(playbackRaw, 'const attemptStart = (attempt = 0, { fromGesture = false } = {}) => {', '\n    };');
        expect(attemptStart).toContain('muteIntent: fromGesture ? false : muteIntentRef.current');
        expect(attemptStart).toContain('preferMutedStart: fromGesture ? false : isIOS');
    });

    it('tapping an already-muted clip re-issues playback so iOS re-opens the audio', () => {
        // A bare `muted = false` can leave the output closed on iOS: the learner
        // taps, hears nothing, and has to tap again (the field report).
        const handler = sliceBetween(playbackRaw, 'const handleTakeTap = () => {', '\n    };');
        const unmuteTail = handler.slice(handler.indexOf('const next = action === \'mute\';'));
        expect(unmuteTail).toContain('if (!next) {');
        expect(unmuteTail).toContain('playSafely(video)');
        expect(unmuteTail.indexOf('setElementMuted(video, next)'))
            .toBeLessThan(unmuteTail.indexOf('playSafely(video)'));
        expect(unmuteTail).toContain('tap unmuted with replay');
    });

    it('the silent loop is still the one muted path', () => {
        const ended = sliceBetween(playbackRaw, 'const handleVideoEnded = () => {', '\n    };');
        expect(ended).toContain('muteIntentRef.current = true;');
        expect(ended).toContain('setElementMuted(video, true)');
        expect(ended).toContain('video.loop = true');
    });
});
