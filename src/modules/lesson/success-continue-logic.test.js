// success-continue-logic.test.js
// Unit tests for the friend-row delayed Continue rules (story 061,
// Task 4). Fake timers for the scheduler; no store, no DOM.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    SUCCESS_CONTINUE_REVEAL_DELAY_MS,
    isSuccessContinueDelayed,
    scheduleSuccessContinueReveal,
} from './success-continue-logic.js';

describe('SUCCESS_CONTINUE_REVEAL_DELAY_MS', () => {
    it('is the specified 3 seconds', () => {
        expect(SUCCESS_CONTINUE_REVEAL_DELAY_MS).toBe(3000);
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
