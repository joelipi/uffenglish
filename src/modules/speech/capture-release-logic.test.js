// Unit tests for the pure capture-release rules
// (stories/075-fix-android-silent-video-start).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    CAPTURE_RELEASE_SETTLE_MS,
    describeCaptureStream,
    describeRecordingBlob,
    shouldReleaseCaptureBeforePlayback,
    waitForAudioRouteSettle,
} from './capture-release-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(path.join(__dirname, 'capture-release-logic.js'), 'utf8');

describe('shouldReleaseCaptureBeforePlayback', () => {
    it('releases the capture before the hand-over when it is released anyway', () => {
        expect(shouldReleaseCaptureBeforePlayback({ releaseAfterRecording: true, playback: true })).toBe(true);
    });

    it('keeps the capture alive when it is not released at the end of the recording', () => {
        // The desktop warm-up path: the capture deliberately survives the
        // recording, so there is nothing to release and nothing to wait for.
        expect(shouldReleaseCaptureBeforePlayback({ releaseAfterRecording: false, playback: true })).toBe(false);
    });

    it('does nothing when no clip is about to be played', () => {
        expect(shouldReleaseCaptureBeforePlayback({ releaseAfterRecording: true, playback: false })).toBe(false);
    });

    it('treats a missing flag as "no release"', () => {
        expect(shouldReleaseCaptureBeforePlayback({})).toBe(false);
        expect(shouldReleaseCaptureBeforePlayback({ releaseAfterRecording: true })).toBe(false);
        expect(shouldReleaseCaptureBeforePlayback({ playback: true })).toBe(false);
    });

    it('does not release for a truthy-but-not-true flag', () => {
        expect(shouldReleaseCaptureBeforePlayback({ releaseAfterRecording: 'yes', playback: true })).toBe(false);
        expect(shouldReleaseCaptureBeforePlayback({ releaseAfterRecording: true, playback: 'yes' })).toBe(false);
    });
});

describe('waitForAudioRouteSettle', () => {
    it('waits for the documented settle time', async () => {
        const calls = [];
        await waitForAudioRouteSettle(CAPTURE_RELEASE_SETTLE_MS, (ms) => {
            calls.push(ms);
            return Promise.resolve();
        });
        expect(calls).toEqual([CAPTURE_RELEASE_SETTLE_MS]);
    });

    it('resolves immediately for a non-positive delay and never sleeps', async () => {
        const calls = [];
        await waitForAudioRouteSettle(0, (ms) => {
            calls.push(ms);
            return Promise.resolve();
        });
        await waitForAudioRouteSettle(-100, (ms) => {
            calls.push(ms);
            return Promise.resolve();
        });
        expect(calls).toEqual([]);
    });

    it('defaults to the documented settle time', async () => {
        const calls = [];
        await waitForAudioRouteSettle(undefined, (ms) => {
            calls.push(ms);
            return Promise.resolve();
        });
        expect(calls).toEqual([CAPTURE_RELEASE_SETTLE_MS]);
    });

    it('the settle time is a positive, bounded number', () => {
        expect(CAPTURE_RELEASE_SETTLE_MS).toBeGreaterThan(0);
        expect(CAPTURE_RELEASE_SETTLE_MS).toBeLessThanOrEqual(2000);
    });
});

describe('the module stays pure', () => {
    it('references no browser global in its raw source', () => {
        // Raw source (no comment stripping): the comments name setTimeout, so
        // stripping them would hide a real dependency.
        expect(RAW).not.toMatch(/\bwindow\b/);
        expect(RAW).not.toMatch(/\bdocument\b/);
        expect(RAW).not.toMatch(/\bnavigator\b/);
    });
});

describe('describeCaptureStream', () => {
    const track = (kind, overrides = {}) => ({
        kind,
        readyState: 'live',
        enabled: true,
        muted: false,
        getSettings: () => ({ width: 720, height: 1280, frameRate: 24 }),
        ...overrides,
    });

    it('describes a live camera capture for a take', () => {
        const stream = { getTracks: () => [track('video'), track('audio', { getSettings: () => ({ sampleRate: 48000 }) })] };
        expect(describeCaptureStream(stream, { take: 2, isComposite: false, mimeType: 'video/mp4' })).toEqual({
            take: 2,
            mimeType: 'video/mp4',
            isComposite: false,
            trackCount: 2,
            video: { readyState: 'live', enabled: true, muted: false, settings: { width: 720, height: 1280, frameRate: 24 } },
            audio: { readyState: 'live', enabled: true, muted: false, settings: { sampleRate: 48000 } },
        });
    });

    it('flags a video track that is already ended (an audio-only take)', () => {
        const stream = { getTracks: () => [track('video', { readyState: 'ended' })] };
        const described = describeCaptureStream(stream, { take: 2 });
        expect(described.video.readyState).toBe('ended');
        expect(described.trackCount).toBe(1);
        expect(described.audio).toBeNull();
    });

    it('flags a muted video track (the camera delivers no frames)', () => {
        const stream = { getTracks: () => [track('video', { muted: true })] };
        expect(describeCaptureStream(stream, { take: 1 }).video.muted).toBe(true);
    });

    it('survives a throwing getSettings and a missing stream', () => {
        const stream = { getTracks: () => [track('video', { getSettings: () => { throw new Error('nope'); } })] };
        expect(describeCaptureStream(stream).video.settings).toBeNull();
        expect(describeCaptureStream(null)).toEqual({
            take: null, mimeType: null, isComposite: false, trackCount: 0, video: null, audio: null,
        });
    });
});

describe('describeRecordingBlob', () => {
    it('describes the file handed to the player', () => {
        expect(describeRecordingBlob({ size: 240720, type: 'video/mp4' }, { take: 2, mimeType: 'video/mp4' })).toEqual({
            take: 2, mimeType: 'video/mp4', size: 240720, type: 'video/mp4',
        });
    });

    it('is null-safe', () => {
        expect(describeRecordingBlob(null)).toEqual({ take: null, mimeType: null, size: null, type: null });
    });
});
