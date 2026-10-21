// success-continue-logic.test.js
// Unit tests for the friend-row delayed Continue rules (story 061,
// Task 4). Fake timers for the scheduler; no store, no DOM.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    SUCCESS_CONTINUE_REVEAL_DELAY_MS,
    findLessonById,
    isSuccessContinueDelayed,
    isSuccessContinueBlockedByUpload,
    scheduleSuccessContinueReveal,
    shouldShowSuccessContinue,
} from './success-continue-logic.js';

describe('SUCCESS_CONTINUE_REVEAL_DELAY_MS', () => {
    it('is the specified 3 seconds', () => {
        expect(SUCCESS_CONTINUE_REVEAL_DELAY_MS).toBe(3000);
    });
});

describe('findLessonById', () => {
    const config = { lessons: [{ lessonId: 'a' }, { lessonId: 'b', recapOverlay: 'shareCta' }] };

    it('resolves by id and returns null when absent', () => {
        expect(findLessonById(config, 'b')).toEqual({ lessonId: 'b', recapOverlay: 'shareCta' });
        expect(findLessonById(config, 'zzz')).toBeNull();
        expect(findLessonById(null, 'b')).toBeNull();
        expect(findLessonById({}, 'b')).toBeNull();
        expect(findLessonById(config, null)).toBeNull();
    });
});

describe('isSuccessContinueDelayed', () => {
    it.each([
        [{ recapOverlay: 'shareCta' }, true],
        [{ recapOverlay: 'fluency' }, false],
        [{ recapOverlay: 'none' }, false],
        [{}, false],
        [null, false],
        [undefined, false],
    ])('lesson %j → %s', (lesson, expected) => {
        expect(isSuccessContinueDelayed(lesson)).toBe(expected);
    });
});

describe('isSuccessContinueBlockedByUpload', () => {
    it.each([
        [true, true],
        [false, false],
        [undefined, false],
        [null, false],
        [0, false],
        [1, true],
        ['', false],
    ])('clipsPublishing %j → blocked %s', (clipsPublishing, expected) => {
        expect(isSuccessContinueBlockedByUpload(clipsPublishing)).toBe(expected);
    });
});

describe('shouldShowSuccessContinue', () => {
    it.each([
        // visible × publishing
        [{ visible: true, clipsPublishing: false }, true],
        [{ visible: true, clipsPublishing: true }, false],
        [{ visible: false, clipsPublishing: false }, false],
        [{ visible: false, clipsPublishing: true }, false],
    ])('%j → %s', (input, expected) => {
        expect(shouldShowSuccessContinue(input)).toBe(expected);
    });

    it('never throws on a missing or malformed input', () => {
        expect(shouldShowSuccessContinue()).toBe(false);
        expect(shouldShowSuccessContinue({})).toBe(false);
        expect(shouldShowSuccessContinue(null)).toBe(false);
        // A malformed (truthy) publishing flag fails closed: the button stays
        // hidden rather than risking an aborted upload.
        expect(shouldShowSuccessContinue({ visible: true, clipsPublishing: 'no' })).toBe(false);
    });
});

describe('scheduleSuccessContinueReveal', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('reveals after the delay while the lesson is still active', () => {
        const reveal = vi.fn();
        scheduleSuccessContinueReveal({ lessonId: 'b', reveal, getActiveLessonId: () => 'b' });
        vi.advanceTimersByTime(2999);
        expect(reveal).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(reveal).toHaveBeenCalledTimes(1);
    });

    it('uses the default 3s delay when none is given', () => {
        const reveal = vi.fn();
        scheduleSuccessContinueReveal({ lessonId: 'b', reveal, getActiveLessonId: () => 'b' });
        vi.advanceTimersByTime(3000);
        expect(reveal).toHaveBeenCalledTimes(1);
    });

    it('never reveals for a stale lesson', () => {
        const reveal = vi.fn();
        scheduleSuccessContinueReveal({ lessonId: 'b', reveal, getActiveLessonId: () => 'c' });
        vi.advanceTimersByTime(10000);
        expect(reveal).not.toHaveBeenCalled();
    });

    it('cancel suppresses the reveal and is idempotent', () => {
        const reveal = vi.fn();
        const cancel = scheduleSuccessContinueReveal({ lessonId: 'b', reveal, getActiveLessonId: () => 'b' });
        cancel();
        cancel();
        vi.advanceTimersByTime(10000);
        expect(reveal).not.toHaveBeenCalled();
    });

    it('a throwing lesson getter suppresses the reveal', () => {
        const reveal = vi.fn();
        scheduleSuccessContinueReveal({
            lessonId: 'b',
            reveal,
            getActiveLessonId: () => { throw new Error('gone'); },
        });
        vi.advanceTimersByTime(10000);
        expect(reveal).not.toHaveBeenCalled();
    });

    it('a throwing reveal never surfaces as an uncaught timer exception', () => {
        const reveal = vi.fn(() => { throw new Error('torn down'); });
        scheduleSuccessContinueReveal({ lessonId: 'b', reveal, getActiveLessonId: () => 'b' });
        expect(() => vi.advanceTimersByTime(10000)).not.toThrow();
        expect(reveal).toHaveBeenCalledTimes(1);
    });

    it('falls back to the default delay for a bad delayMs and never throws without a reveal', () => {
        const reveal = vi.fn();
        scheduleSuccessContinueReveal({ lessonId: 'b', delayMs: -5, reveal, getActiveLessonId: () => 'b' });
        vi.advanceTimersByTime(3000);
        expect(reveal).toHaveBeenCalledTimes(1);
        expect(() => scheduleSuccessContinueReveal({ lessonId: 'b' })).not.toThrow();
        expect(typeof scheduleSuccessContinueReveal({ lessonId: 'b' })).toBe('function');
    });
});

describe('success-continue-logic source hygiene', () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(__dirname, 'success-continue-logic.js'), 'utf8');

    it('imports no React, touches no DOM, and reads no backend', () => {
        expect(src).not.toContain("from 'react'");
        expect(src).not.toContain('window');
        expect(src).not.toContain('document');
        expect(src).not.toContain('supabase');
    });
});
