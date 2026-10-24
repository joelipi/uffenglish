// Unit tests for the recorded-take start rules
// (stories/094-fix-ipad-recorded-take-autoplay).

import { describe, it, expect } from 'vitest';
import {
    AUTOPLAY_ERROR_NAMES,
    PLAYBACK_START_RETRY_DELAYS_MS,
    describeStartState,
    playSafely,
    resolveTapAction,
    retryDelayMs,
    setElementMuted,
    shouldAttemptStart,
    shouldPauseOffscreen,
    shouldRetryStart,
    shouldStartMuted,
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
