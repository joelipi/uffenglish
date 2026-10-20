// Unit tests for the audio-playback rules.
// See stories/075-fix-android-silent-video-start/story.md.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    AUDIO_GUARD_INTERVAL_MS,
    AUDIO_GUARD_WINDOW_MS,
    describeAudioState,
    isAudible,
    recoverAudio,
    shouldRepairAudio,
} from './audio-playback-logic.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('isAudible', () => {
    it('is false for a missing element', () => {
        expect(isAudible(null)).toBe(false);
        expect(isAudible(undefined)).toBe(false);
    });

    it('is false when the element is muted', () => {
        expect(isAudible({ muted: true, volume: 1 })).toBe(false);
    });

    it('is false when the volume is zero', () => {
        expect(isAudible({ muted: false, volume: 0 })).toBe(false);
    });

    it('is true when the element is unmuted with volume', () => {
        expect(isAudible({ muted: false, volume: 1 })).toBe(true);
        expect(isAudible({ muted: false, volume: 0.5 })).toBe(true);
    });

    it('treats a missing volume as 1 and a missing muted flag as unmuted', () => {
        expect(isAudible({})).toBe(true);
    });
});

describe('shouldRepairAudio', () => {
    const base = { playing: true, expectedAudible: true, audible: false, elapsedMs: 100 };

    it('repairs a playing, inaudible element inside the window', () => {
        expect(shouldRepairAudio(base)).toBe(true);
    });

    it('does not repair a paused element', () => {
        expect(shouldRepairAudio({ ...base, playing: false })).toBe(false);
    });

    it('does not repair an element that is not supposed to be audible', () => {
        expect(shouldRepairAudio({ ...base, expectedAudible: false })).toBe(false);
    });

    it('does not repair an element that is already audible', () => {
        expect(shouldRepairAudio({ ...base, audible: true })).toBe(false);
    });

    it('does not repair outside the guard window', () => {
        expect(shouldRepairAudio({ ...base, elapsedMs: AUDIO_GUARD_WINDOW_MS + 1 })).toBe(false);
        expect(shouldRepairAudio({ ...base, elapsedMs: -1 })).toBe(false);
        expect(shouldRepairAudio({ ...base, elapsedMs: NaN })).toBe(false);
    });

    it('repairs exactly at the window boundary', () => {
        expect(shouldRepairAudio({ ...base, elapsedMs: AUDIO_GUARD_WINDOW_MS })).toBe(true);
    });

    it('honours a custom window', () => {
        expect(shouldRepairAudio({ ...base, elapsedMs: 900, windowMs: 1000 })).toBe(true);
        expect(shouldRepairAudio({ ...base, elapsedMs: 1100, windowMs: 1000 })).toBe(false);
    });
});

describe('recoverAudio', () => {
    it('clears the mute, restores the volume and re-issues play()', () => {
        const element = { muted: true, volume: 0, paused: false };
        const play = vi.fn();

        expect(recoverAudio(element, play)).toBe(true);
        expect(element.muted).toBe(false);
        expect(element.volume).toBe(1);
        expect(play).toHaveBeenCalledTimes(1);
    });

    it('survives a play() that throws and still reports the element as audible', () => {
        const element = { muted: true, volume: 1, paused: false };
        const play = vi.fn(() => { throw new Error('boom'); });

        expect(recoverAudio(element, play)).toBe(true);
        expect(element.muted).toBe(false);
    });

    it('returns false for a missing element without throwing', () => {
        expect(recoverAudio(null, vi.fn())).toBe(false);
    });

    it('returns false when the muted setter throws', () => {
        const element = {
            get muted() { return true; },
            set muted(_v) { throw new Error('read only'); },
            volume: 1,
            paused: false,
        };
        const play = vi.fn();

        expect(recoverAudio(element, play)).toBe(false);
        expect(play).not.toHaveBeenCalled();
    });

    it('tolerates a missing play function', () => {
        const element = { muted: true, volume: 1, paused: false };
        expect(recoverAudio(element, undefined)).toBe(true);
        expect(element.muted).toBe(false);
    });
});

describe('describeAudioState', () => {
    it('describes a missing element with nulls', () => {
        expect(describeAudioState(null)).toEqual({
            muted: null, volume: null, paused: null, readyState: null, audioBytes: null,
        });
    });

    it('describes an element', () => {
        const element = { muted: false, volume: 1, paused: false, readyState: 4, webkitAudioDecodedByteCount: 1234 };
        expect(describeAudioState(element)).toEqual({
            muted: false, volume: 1, paused: false, readyState: 4, audioBytes: 1234,
        });
    });
});

describe('module purity', () => {
    it('references no browser global in its raw source', () => {
        const source = fs.readFileSync(path.join(HERE, 'audio-playback-logic.js'), 'utf8');
        expect(source).not.toMatch(/\bwindow\b/);
        expect(source).not.toMatch(/\bdocument\b/);
        expect(source).not.toMatch(/\bnavigator\b/);
    });

    it('exposes the guard timings', () => {
        expect(AUDIO_GUARD_INTERVAL_MS).toBeGreaterThan(0);
        expect(AUDIO_GUARD_WINDOW_MS).toBeGreaterThan(AUDIO_GUARD_INTERVAL_MS);
    });
});
