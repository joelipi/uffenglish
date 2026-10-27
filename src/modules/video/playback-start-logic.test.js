// Unit tests for the recorded-take start rules
// (stories/094-fix-ipad-recorded-take-autoplay).

import { describe, it, expect } from 'vitest';
import {
    AUTOPLAY_ERROR_NAMES,
    PLAYBACK_START_RETRY_DELAYS_MS,
    PLAYBACK_START_WATCHDOG_MS,
    PLAYBACK_STALL_CHECK_MS,
    PLAYBACK_UNMUTE_FALLBACK_MS,
    describePlaybackSample,
    describeStartState,
    describeTakeMedia,
    playSafely,
    resolveStartRecovery,
    resolveTapAction,
    retryDelayMs,
    setElementMuted,
    shouldAttemptStart,
    shouldKickStalledPlayback,
    shouldPauseOffscreen,
    shouldRetryStart,
    shouldStartMuted,
    shouldUnmuteTechnicalMute,
    shouldWaitForReadiness,
} from './playback-start-logic.js';

/** A media-element fake: only the members the start rules read or write. */
function makeElement(overrides = {}) {
    const attributes = new Map();
    return {
        paused: true,
        muted: false,
        defaultMuted: false,
        readyState: 0,
        networkState: 0,
        ended: false,
        play: () => Promise.resolve(),
        setAttribute: (name, value) => attributes.set(name, value),
        removeAttribute: (name) => attributes.delete(name),
        hasAttribute: (name) => attributes.has(name),
        ...overrides,
    };
}

describe('shouldStartMuted', () => {
    it('asks for sound on the first attempt of a clip the learner has not muted', () => {
        expect(shouldStartMuted({ attempt: 0, muteIntent: false })).toBe(false);
        expect(shouldStartMuted()).toBe(false);
    });

    it('starts muted on every retry (iPadOS refuses the unmuted start)', () => {
        expect(shouldStartMuted({ attempt: 1 })).toBe(true);
        expect(shouldStartMuted({ attempt: 3 })).toBe(true);
    });

    it('starts muted from the first attempt when the learner muted the clip', () => {
        expect(shouldStartMuted({ attempt: 0, muteIntent: true })).toBe(true);
    });

    it('starts muted from the first attempt on iOS, where the unmuted start is always refused', () => {
        expect(shouldStartMuted({ attempt: 0, muteIntent: false, preferMutedStart: true })).toBe(true);
        expect(shouldStartMuted({ attempt: 1, preferMutedStart: true })).toBe(true);
        // A learner's explicit unmute intent is not overridden by the platform.
        expect(shouldStartMuted({ attempt: 0, muteIntent: false, preferMutedStart: false })).toBe(false);
    });
});

describe('shouldRetryStart / retryDelayMs', () => {
    it('retries a named refusal while a delay remains', () => {
        AUTOPLAY_ERROR_NAMES.forEach((name) => {
            expect(shouldRetryStart({ attempt: 0, errorName: name })).toBe(true);
        });
    });

    it('retries an unnamed refusal', () => {
        expect(shouldRetryStart({ attempt: 0, errorName: null })).toBe(true);
        expect(shouldRetryStart({ attempt: 0, errorName: '' })).toBe(true);
    });

    it('does not retry an error a muted start cannot fix', () => {
        expect(shouldRetryStart({ attempt: 0, errorName: 'NotSupportedError' })).toBe(false);
    });

    it('stops at the end of the ladder', () => {
        const last = PLAYBACK_START_RETRY_DELAYS_MS.length - 1;
        expect(shouldRetryStart({ attempt: last })).toBe(false);
        expect(retryDelayMs(last)).toBeNull();
    });

    it('returns the next delay while the ladder has rungs left', () => {
        expect(retryDelayMs(0)).toBe(PLAYBACK_START_RETRY_DELAYS_MS[1]);
        expect(retryDelayMs(1)).toBe(PLAYBACK_START_RETRY_DELAYS_MS[2]);
    });

    it('rejects an invalid attempt index', () => {
        expect(shouldRetryStart({ attempt: -1 })).toBe(false);
        expect(shouldRetryStart({ attempt: 1.5 })).toBe(false);
        expect(retryDelayMs(-1)).toBeNull();
    });
});

describe('shouldAttemptStart', () => {
    it('starts a paused clip that has never started when autoplay is on', () => {
        expect(shouldAttemptStart({ paused: true, hasStarted: false, autoplay: true })).toBe(true);
    });

    it('never starts when autoplay is off', () => {
        expect(shouldAttemptStart({ paused: true, hasStarted: false, autoplay: false })).toBe(false);
    });

    it('never restarts a clip that is already playing', () => {
        expect(shouldAttemptStart({ paused: false, hasStarted: false, autoplay: true })).toBe(false);
    });

    it('leaves a clip the learner paused after it played alone', () => {
        expect(shouldAttemptStart({ paused: true, hasStarted: true, autoplay: true })).toBe(false);
    });
});

describe('shouldPauseOffscreen', () => {
    it('does not pause a clip before its first start (iPad layout settling)', () => {
        expect(shouldPauseOffscreen({ isIntersecting: false, hasStarted: false })).toBe(false);
    });

    it('pauses a clip that has started and left the viewport', () => {
        expect(shouldPauseOffscreen({ isIntersecting: false, hasStarted: true })).toBe(true);
    });

    it('never pauses a visible clip', () => {
        expect(shouldPauseOffscreen({ isIntersecting: true, hasStarted: true })).toBe(false);
    });
});

describe('resolveTapAction', () => {
    it('starts a paused clip on a tap instead of toggling its sound', () => {
        expect(resolveTapAction({ paused: true, muted: false })).toBe('play');
        expect(resolveTapAction({ paused: true, muted: true })).toBe('play');
    });

    it('unmutes a silent playing clip', () => {
        expect(resolveTapAction({ paused: false, muted: true })).toBe('unmute');
    });

    it('mutes an audible playing clip', () => {
        expect(resolveTapAction({ paused: false, muted: false })).toBe('mute');
    });
});

describe('playSafely', () => {
    it('returns the promise when play() returns one', async () => {
        const element = makeElement({ play: () => Promise.resolve() });
        const { promise, error } = playSafely(element);
        expect(error).toBeNull();
        await expect(promise).resolves.toBeUndefined();
    });

    it('survives WebKit returning undefined from play()', () => {
        const element = makeElement({ play: () => undefined });
        expect(playSafely(element)).toEqual({ promise: null, error: null });
    });

    it('returns a synchronous throw instead of propagating it', () => {
        const thrown = new Error('boom');
        const element = makeElement({ play: () => { throw thrown; } });
        expect(playSafely(element)).toEqual({ promise: null, error: thrown });
    });

    it('is a no-op without an element', () => {
        expect(playSafely(null)).toEqual({ promise: null, error: null });
        expect(playSafely({})).toEqual({ promise: null, error: null });
    });
});

describe('setElementMuted', () => {
    it('mirrors the mute on the property AND the attribute Safari reads', () => {
        const element = makeElement();
        expect(setElementMuted(element, true)).toBe(true);
        expect(element.muted).toBe(true);
        expect(element.defaultMuted).toBe(true);
        expect(element.hasAttribute('muted')).toBe(true);
    });

    it('clears the attribute on unmute', () => {
        const element = makeElement();
        setElementMuted(element, true);
        expect(setElementMuted(element, false)).toBe(true);
        expect(element.muted).toBe(false);
        expect(element.defaultMuted).toBe(false);
        expect(element.hasAttribute('muted')).toBe(false);
    });

    it('keeps a property write when the element has no attribute API', () => {
        const element = makeElement({ setAttribute: undefined, removeAttribute: undefined });
        expect(setElementMuted(element, true)).toBe(true);
        expect(element.muted).toBe(true);
    });

    it('reports failure when the property write throws', () => {
        const element = makeElement();
        Object.defineProperty(element, 'muted', { set() { throw new Error('readonly'); }, get() { return false; } });
        expect(setElementMuted(element, true)).toBe(false);
    });
});

describe('describeStartState', () => {
    it('captures what the start path saw', () => {
        const element = makeElement({ paused: false, readyState: 4, muted: true, networkState: 2 });
        expect(describeStartState(element)).toEqual({
            paused: false, readyState: 4, muted: true, ended: false, networkState: 2,
        });
    });

    it('is null-safe', () => {
        expect(describeStartState(null)).toEqual({
            paused: null, readyState: null, muted: null, ended: null, networkState: null,
        });
    });
});

describe('describeTakeMedia', () => {
    it('reports a take that carries a video track', () => {
        const element = makeElement({ videoWidth: 720, videoHeight: 1280, duration: 3.4567 });
        const blob = { size: 240720, type: 'video/mp4' };
        expect(describeTakeMedia(element, blob)).toEqual({
            videoWidth: 720,
            videoHeight: 1280,
            hasVideoTrack: true,
            duration: 3.46,
            blobSize: 240720,
            blobType: 'video/mp4',
        });
    });

    it('flags an audio-only recording (the iPad MediaRecorder shape)', () => {
        const element = makeElement({ videoWidth: 0, videoHeight: 0, duration: 4 });
        const media = describeTakeMedia(element, { size: 40000, type: 'video/mp4' });
        expect(media.hasVideoTrack).toBe(false);
        expect(media.blobSize).toBe(40000);
    });

    it('is null-safe and ignores a non-finite duration', () => {
        expect(describeTakeMedia(null, null)).toEqual({
            videoWidth: null, videoHeight: null, hasVideoTrack: null, duration: null, blobSize: null, blobType: null,
        });
        expect(describeTakeMedia(makeElement({ duration: NaN }), null).duration).toBeNull();
        expect(describeTakeMedia(makeElement({ duration: Infinity }), null).duration).toBeNull();
    });
});

describe('describePlaybackSample', () => {
    it('reads the decoded frame count from getVideoPlaybackQuality', () => {
        const element = makeElement({
            currentTime: 1.234,
            videoWidth: 720,
            getVideoPlaybackQuality: () => ({ totalVideoFrames: 42 }),
        });
        expect(describePlaybackSample(element)).toEqual({ decodedFrames: 42, currentTime: 1.23, videoWidth: 720 });
    });

    it('falls back to webkitDecodedFrameCount', () => {
        const element = makeElement({ webkitDecodedFrameCount: 17 });
        expect(describePlaybackSample(element).decodedFrames).toBe(17);
    });

    it('reports null frames when the browser offers no counter', () => {
        expect(describePlaybackSample(makeElement()).decodedFrames).toBeNull();
    });

    it('survives a throwing quality call and still uses the webkit counter', () => {
        const element = makeElement({
            webkitDecodedFrameCount: 9,
            getVideoPlaybackQuality: () => { throw new Error('unsupported'); },
        });
        expect(describePlaybackSample(element).decodedFrames).toBe(9);
    });

    it('is null-safe', () => {
        expect(describePlaybackSample(null)).toEqual({ decodedFrames: null, currentTime: null, videoWidth: null });
    });
});

describe('shouldWaitForReadiness', () => {
    it('waits at HAVE_NOTHING / HAVE_METADATA', () => {
        expect(shouldWaitForReadiness(0)).toBe(true);
        expect(shouldWaitForReadiness(1)).toBe(true);
        expect(shouldWaitForReadiness(undefined)).toBe(true);
    });

    it('plays at HAVE_CURRENT_DATA or better', () => {
        expect(shouldWaitForReadiness(2)).toBe(false);
        expect(shouldWaitForReadiness(4)).toBe(false);
    });
});

describe('shouldKickStalledPlayback', () => {
    it('kicks a playing element whose clock never moved', () => {
        expect(shouldKickStalledPlayback({
            paused: false,
            currentTime: 0.03,
            elapsedSinceStartMs: PLAYBACK_STALL_CHECK_MS,
        })).toBe(true);
    });

    it('leaves a clip that is actually advancing alone', () => {
        expect(shouldKickStalledPlayback({
            paused: false,
            currentTime: 0.8,
            elapsedSinceStartMs: PLAYBACK_STALL_CHECK_MS,
        })).toBe(false);
    });

    it('never touches a paused element', () => {
        expect(shouldKickStalledPlayback({ paused: true, currentTime: 0, elapsedSinceStartMs: 5000 })).toBe(false);
    });

    it('waits out the grace period and ignores unusable readings', () => {
        expect(shouldKickStalledPlayback({ paused: false, currentTime: 0, elapsedSinceStartMs: 100 })).toBe(false);
        expect(shouldKickStalledPlayback({ paused: false, currentTime: NaN, elapsedSinceStartMs: 5000 })).toBe(false);
        expect(shouldKickStalledPlayback({})).toBe(false);
    });
});

// The take the browser left unplayed (the ?diag=1 race). A start is only real
// once `playing` arrives; until then the element is watched and restarted.
describe('resolveStartRecovery', () => {
    const base = { autoplay: true, hasStarted: false, gaveUp: false, waitedMs: 400 };

    it('restarts a take the element left paused before it ever played', () => {
        expect(resolveStartRecovery({ ...base, paused: true })).toBe('restart');
    });

    it('kicks a not-paused element whose clock did not move', () => {
        expect(resolveStartRecovery({ ...base, paused: false, movedS: 0 })).toBe('kick');
        expect(resolveStartRecovery({ ...base, paused: false, movedS: 0.01 })).toBe('kick');
    });

    it('leaves a clip that is actually advancing alone', () => {
        expect(resolveStartRecovery({ ...base, paused: false, movedS: 0.4 })).toBe('none');
    });

    it('records the first reading instead of kicking on it', () => {
        expect(resolveStartRecovery({ ...base, paused: false, movedS: null })).toBe('none');
    });

    it('never fights a step without autoplay, a started clip, a given-up ladder or the closed window', () => {
        expect(resolveStartRecovery({ ...base, autoplay: false, paused: true })).toBe('none');
        expect(resolveStartRecovery({ ...base, hasStarted: true, paused: true })).toBe('none');
        expect(resolveStartRecovery({ ...base, gaveUp: true, paused: true })).toBe('none');
        expect(resolveStartRecovery({ ...base, paused: true, waitedMs: 4001 })).toBe('none');
        expect(resolveStartRecovery({ ...base, paused: true, waitedMs: NaN })).toBe('none');
    });

    it('is null-safe', () => {
        expect(resolveStartRecovery()).toBe('none');
    });

    it('watches sooner than the readiness stall window closes', () => {
        expect(PLAYBACK_START_WATCHDOG_MS).toBeGreaterThan(0);
        expect(PLAYBACK_START_WATCHDOG_MS).toBeLessThan(PLAYBACK_STALL_CHECK_MS);
    });
});

describe('shouldUnmuteTechnicalMute', () => {
    it('re-opens the audio once playback really started', () => {
        expect(shouldUnmuteTechnicalMute({ pendingUnmute: true, muteIntent: false })).toBe(true);
    });

    it('never overrides the learner\'s own silence', () => {
        expect(shouldUnmuteTechnicalMute({ pendingUnmute: true, muteIntent: true })).toBe(false);
    });

    it('does nothing when there is no technical mute to undo', () => {
        expect(shouldUnmuteTechnicalMute({ pendingUnmute: false, muteIntent: false })).toBe(false);
        expect(shouldUnmuteTechnicalMute()).toBe(false);
    });

    it('the fallback is a fallback, not the plan', () => {
        expect(PLAYBACK_UNMUTE_FALLBACK_MS).toBeGreaterThanOrEqual(500);
    });
});
