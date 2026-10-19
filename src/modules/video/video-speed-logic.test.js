import { describe, it, expect } from 'vitest';
import {
    VIDEO_SPEED_STEPS,
    VIDEO_SPEED_TOGGLE_TESTID,
    nextVideoSpeed,
    formatVideoSpeedLabel,
    buildVideoSpeedToggleView,
    applyVideoSpeed,
} from './video-speed-logic.js';

describe('VIDEO_SPEED_STEPS', () => {
    it('cycles 1 -> 0.8 -> 0.6 -> 1', () => {
        expect(VIDEO_SPEED_STEPS).toEqual([1, 0.8, 0.6]);
    });
});

describe('nextVideoSpeed', () => {
    it('advances 1 to 0.8', () => {
        expect(nextVideoSpeed(1)).toBe(0.8);
    });

    it('advances 0.8 to 0.6', () => {
        expect(nextVideoSpeed(0.8)).toBe(0.6);
    });

    it('wraps 0.6 back to 1', () => {
        expect(nextVideoSpeed(0.6)).toBe(1);
    });

    it('resets an unknown rate to 1', () => {
        expect(nextVideoSpeed(1.5)).toBe(1);
        expect(nextVideoSpeed(Number.NaN)).toBe(1);
    });
});

describe('formatVideoSpeedLabel', () => {
    it('labels 1 as 1x', () => {
        expect(formatVideoSpeedLabel(1)).toBe('1x');
    });

    it('labels 0.8 as 0.8x', () => {
        expect(formatVideoSpeedLabel(0.8)).toBe('0.8x');
    });

    it('labels 0.6 as 0.6x', () => {
        expect(formatVideoSpeedLabel(0.6)).toBe('0.6x');
    });
});

describe('buildVideoSpeedToggleView', () => {
    it('marks 1x as not slowed and points at 0.8x', () => {
        const view = buildVideoSpeedToggleView({ rate: 1 });
        expect(view.label).toBe('1x');
        expect(view.next).toBe(0.8);
        expect(view.nextLabel).toBe('0.8x');
        expect(view.slowed).toBe(false);
        expect(view.testId).toBe(VIDEO_SPEED_TOGGLE_TESTID);
    });

    it('marks 0.6x as slowed and wraps next to 1x', () => {
        const view = buildVideoSpeedToggleView({ rate: 0.6 });
        expect(view.label).toBe('0.6x');
        expect(view.slowed).toBe(true);
        expect(view.next).toBe(1);
        expect(view.ariaLabel).toContain('0.6x');
        expect(view.ariaLabel).toContain('1x');
    });

    it('normalizes an unknown rate to 1x', () => {
        const view = buildVideoSpeedToggleView({ rate: 2 });
        expect(view.rate).toBe(1);
        expect(view.label).toBe('1x');
    });
});

describe('applyVideoSpeed', () => {
    it('writes playbackRate onto the element and returns the rate', () => {
        const video = {};
        const out = applyVideoSpeed(video, 0.8);
        expect(out).toBe(0.8);
        expect(video.playbackRate).toBe(0.8);
    });

    it('returns the rate without throwing when there is no element', () => {
        expect(applyVideoSpeed(null, 0.6)).toBe(0.6);
        expect(applyVideoSpeed(undefined, 1)).toBe(1);
    });
});
