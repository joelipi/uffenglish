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
        ['attemptStart', 'handleVideoEnded', 'unmuteAfterStart'].forEach((name) => {
            const fn = sliceBetween(playbackRaw, `const ${name} = `, '\n    };');
            expect(fn, name).toContain('playSafely(');
        });
    });
});

describe('the start ladder asks for sound once then falls back to muted', () => {
    const attemptStart = sliceBetween(playbackRaw, 'const attemptStart = (attempt = 0) => {', '\n    };');

    it('derives the mute state from the ladder rule', () => {
        expect(attemptStart).toContain('shouldStartMuted({ attempt, muteIntent: muteIntentRef.current })');
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
        const unmute = sliceBetween(playbackRaw, 'const unmuteAfterStart = () => {', '\n    };');
        expect(unmute).toContain('if (!el || muteIntentRef.current) return;');
        expect(unmute.indexOf('setElementMuted(el, false)')).toBeLessThan(unmute.indexOf('playSafely(el)'));
        // Reached only from the muted-start success path.
        expect(attemptStart).toContain('if (muted && !muteIntentRef.current) unmuteAfterStart();');
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
        const playBranch = sliceBetween(handler, "if (action === 'play') {", '}');
        expect(playBranch).toContain('attemptStart(0);');
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
