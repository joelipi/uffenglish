// Unit tests for the audio guard adapter.
// See stories/075-fix-android-silent-video-start/story.md.
import { describe, it, expect, vi } from 'vitest';

import { createAudioGuard } from './audio-guard.js';

/** A controllable clock + timer so the guard can be stepped deterministically. */
function makeClock() {
    let time = 0;
    const timers = new Map();
    let nextId = 1;
    return {
        now: () => time,
        setTimer(fn, ms) {
            const id = nextId++;
            timers.set(id, { fn, ms });
            return id;
        },
        clearTimer(id) {
            timers.delete(id);
        },
        get pending() {
            return timers.size;
        },
        advance(ms) {
            time += ms;
            for (const { fn, ms: every } of [...timers.values()]) {
                if (time % every === 0) fn();
            }
        },
        step(ms) {
            time += ms;
            for (const { fn } of [...timers.values()]) fn();
        },
    };
}

function makeElement(overrides = {}) {
    return {
        muted: false,
        volume: 1,
        paused: false,
        readyState: 4,
        webkitAudioDecodedByteCount: 1000,
        ...overrides,
    };
}

describe('createAudioGuard', () => {
    it('does not touch an element that is playing and audible', () => {
        const clock = makeClock();
        const element = makeElement();
        const play = vi.fn();
        const log = vi.fn();
        const guard = createAudioGuard({
            getElement: () => element,
            play,
            log,
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
        });

        guard.start();
        clock.step(200);
        clock.step(200);

        expect(play).not.toHaveBeenCalled();
        expect(element.muted).toBe(false);
        expect(log).not.toHaveBeenCalled();
    });

    it('repairs an element that is playing but muted', () => {
        const clock = makeClock();
        const element = makeElement({ muted: true });
        const play = vi.fn();
        const log = vi.fn();
        const guard = createAudioGuard({
            getElement: () => element,
            play,
            log,
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
        });

        guard.start();
        clock.step(200);

        expect(element.muted).toBe(false);
        expect(element.volume).toBe(1);
        expect(play).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(
            expect.stringContaining('muted during playback'),
            expect.objectContaining({ muted: true })
        );
        expect(log).toHaveBeenCalledWith(expect.stringContaining('repaired muted audio'));
    });

    it('does not repair a paused element', () => {
        const clock = makeClock();
        const element = makeElement({ muted: true, paused: true });
        const play = vi.fn();
        const guard = createAudioGuard({
            getElement: () => element,
            play,
            log: vi.fn(),
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
        });

        guard.start();
        clock.step(200);

        expect(element.muted).toBe(true);
        expect(play).not.toHaveBeenCalled();
    });

    it('does not repair when the clip is not supposed to be audible', () => {
        const clock = makeClock();
        const element = makeElement({ muted: true });
        const play = vi.fn();
        const guard = createAudioGuard({
            getElement: () => element,
            isExpectedAudible: () => false,
            play,
            log: vi.fn(),
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
        });

        guard.start();
        clock.step(200);

        expect(element.muted).toBe(true);
        expect(play).not.toHaveBeenCalled();
    });

    it('stops repairing once the guard window has closed', () => {
        const clock = makeClock();
        const element = makeElement({ muted: true });
        const play = vi.fn();
        const guard = createAudioGuard({
            getElement: () => element,
            play,
            log: vi.fn(),
            windowMs: 500,
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
        });

        guard.start();
        clock.step(600);   // past the window
        clock.step(200);

        expect(element.muted).toBe(true);
        expect(play).not.toHaveBeenCalled();
        expect(guard.isRunning()).toBe(false);
    });

    it('logs a summary of the audio state when the window closes', () => {
        const clock = makeClock();
        const element = makeElement();
        const log = vi.fn();
        const guard = createAudioGuard({
            getElement: () => element,
            log,
            windowMs: 400,
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
        });

        guard.start();
        clock.step(500);

        expect(log).toHaveBeenCalledWith(
            expect.stringContaining('audio state at'),
            expect.objectContaining({ muted: false, volume: 1 })
        );
        expect(guard.isRunning()).toBe(false);
    });

    it('reports a clip that stays muted once, not once per tick', () => {
        const clock = makeClock();
        const element = makeElement({ muted: true });
        const log = vi.fn();
        const guard = createAudioGuard({
            getElement: () => element,
            play: vi.fn(),
            log,
            windowMs: 5000,
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
        });

        guard.start();
        clock.step(200);
        clock.step(200);
        clock.step(200);

        const mutedLines = log.mock.calls.filter((c) => String(c[0]).includes('muted during playback'));
        expect(mutedLines).toHaveLength(1);
    });

    it('stop() clears the timer', () => {
        const clock = makeClock();
        const guard = createAudioGuard({
            getElement: () => makeElement(),
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
        });

        guard.start();
        expect(guard.isRunning()).toBe(true);
        expect(clock.pending).toBe(1);
        guard.stop();
        expect(guard.isRunning()).toBe(false);
        expect(clock.pending).toBe(0);
    });

    it('survives a missing element', () => {
        const clock = makeClock();
        const log = vi.fn();
        const guard = createAudioGuard({
            getElement: () => null,
            log,
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
        });

        guard.start();
        expect(() => clock.step(200)).not.toThrow();
    });
});
