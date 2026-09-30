// src/modules/video/lesson-preload.test.js
// Story 031: the first lesson video is prefetched at high priority and the rest
// are deferred until idle at low priority so they cannot starve it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    planLessonPreload,
    preloadLessonVideos,
    PRELOAD_DEFER_TIMEOUT_MS,
} from './lesson-preload.js';

const buildVideoUrl = (slug) => `/v/${slug}.mp4`;

describe('planLessonPreload', () => {
    it('sets the first distinct video as immediate and the rest as deferred', () => {
        const lesson = {
            steps: [
                { introBackgroundVideoUrl: 's1' },
                { simpleVideoUrl: 's1' },
                { simpleVideoUrl: 's2' },
            ],
        };
        expect(planLessonPreload(lesson, buildVideoUrl)).toEqual({
            immediate: ['/v/s1.mp4'],
            deferred: ['/v/s2.mp4'],
        });
    });

    it('follows loader precedence: interactiveVideoUrl wins over simpleVideoUrl', () => {
        const lesson = {
            steps: [{ interactiveVideoUrl: 'i', simpleVideoUrl: 's', introBackgroundVideoUrl: 'b' }],
        };
        expect(planLessonPreload(lesson, buildVideoUrl)).toEqual({
            immediate: ['/v/i.mp4'],
            deferred: [],
        });
    });

    it('promotes the first video even when step 0 has no video', () => {
        const lesson = { steps: [{}, { simpleVideoUrl: 's1' }] };
        expect(planLessonPreload(lesson, buildVideoUrl)).toEqual({
            immediate: ['/v/s1.mp4'],
            deferred: [],
        });
    });

    it('dedupes duplicate slugs in first-seen order', () => {
        const lesson = {
            steps: [
                { simpleVideoUrl: 'a' },
                { simpleVideoUrl: 'b' },
                { simpleVideoUrl: 'a' },
            ],
        };
        expect(planLessonPreload(lesson, buildVideoUrl)).toEqual({
            immediate: ['/v/a.mp4'],
            deferred: ['/v/b.mp4'],
        });
    });

    it.each([
        ['null lesson', null],
        ['lessons-only object', { lessons: [] }],
        ['empty object', {}],
        ['empty steps', { steps: [] }],
        ['video-less steps', { steps: [{}, { simpleVideoUrl: '' }] }],
    ])('returns empty lists for %s', (_label, lesson) => {
        expect(planLessonPreload(lesson, buildVideoUrl)).toEqual({ immediate: [], deferred: [] });
    });

    it('skips a step whose buildVideoUrl returns a falsy URL', () => {
        expect(planLessonPreload({ steps: [{ simpleVideoUrl: 's1' }] }, () => '')).toEqual({
            immediate: [],
            deferred: [],
        });
    });

    it('skips a step with an empty-string slug and no other video field', () => {
        expect(
            planLessonPreload({ steps: [{ simpleVideoUrl: '' }, { simpleVideoUrl: 's2' }] }, buildVideoUrl)
        ).toEqual({ immediate: ['/v/s2.mp4'], deferred: [] });
    });
});

describe('preloadLessonVideos', () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));

    it('fetches the immediate URL at high priority', () => {
        const fetchImpl = vi.fn(() => Promise.resolve());
        const schedule = vi.fn();
        preloadLessonVideos({ immediate: ['a'], deferred: [] }, { fetchImpl, schedule });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl).toHaveBeenCalledWith('a', { priority: 'high' });
        expect(schedule).not.toHaveBeenCalled();
    });

    it('defers the remaining URLs until the schedule callback runs', () => {
        const fetchImpl = vi.fn(() => Promise.resolve());
        let scheduled = null;
        const schedule = vi.fn((cb) => { scheduled = cb; });

        preloadLessonVideos({ immediate: ['a'], deferred: ['b', 'c'] }, { fetchImpl, schedule });

        expect(schedule).toHaveBeenCalledTimes(1);
        expect(typeof schedule.mock.calls[0][0]).toBe('function');
        expect(fetchImpl).not.toHaveBeenCalledWith('b', expect.anything());
        expect(fetchImpl).not.toHaveBeenCalledWith('c', expect.anything());

        scheduled();

        expect(fetchImpl).toHaveBeenCalledWith('b', { priority: 'low' });
        expect(fetchImpl).toHaveBeenCalledWith('c', { priority: 'low' });
    });

    it('does not schedule when there is nothing deferred', () => {
        const fetchImpl = vi.fn(() => Promise.resolve());
        const schedule = vi.fn();
        preloadLessonVideos({ immediate: [], deferred: [] }, { fetchImpl, schedule });
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(schedule).not.toHaveBeenCalled();
    });

    it('does not touch fetchImpl or schedule for an empty plan', () => {
        const fetchImpl = vi.fn(() => Promise.resolve());
        const schedule = vi.fn();
        preloadLessonVideos({}, { fetchImpl, schedule });
        preloadLessonVideos(undefined, { fetchImpl, schedule });
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(schedule).not.toHaveBeenCalled();
    });

    it('swallows immediate and deferred fetch rejections without throwing', async () => {
        const unhandled = [];
        const onUnhandled = (reason) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);

        const fetchImpl = vi.fn(() => Promise.reject(new Error('x')));
        const schedule = vi.fn((cb) => cb());

        expect(() =>
            preloadLessonVideos({ immediate: ['a'], deferred: ['b'] }, { fetchImpl, schedule })
        ).not.toThrow();

        await tick();
        process.off('unhandledRejection', onUnhandled);
        expect(unhandled).toEqual([]);
    });
});

describe('preloadLessonVideos default scheduler', () => {
    afterEach(() => {
        delete globalThis.requestIdleCallback;
        vi.restoreAllMocks();
    });

    it('uses requestIdleCallback with the defer timeout when available', () => {
        const ric = vi.fn();
        globalThis.requestIdleCallback = ric;
        const fetchImpl = vi.fn(() => Promise.resolve());

        preloadLessonVideos({ immediate: [], deferred: ['b'] }, { fetchImpl });

        expect(ric).toHaveBeenCalledTimes(1);
        expect(ric.mock.calls[0][1]).toEqual({ timeout: PRELOAD_DEFER_TIMEOUT_MS });
        expect(typeof ric.mock.calls[0][0]).toBe('function');
    });

    it('falls back to setTimeout when requestIdleCallback is unavailable', () => {
        expect(typeof requestIdleCallback).toBe('undefined');
        const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        const fetchImpl = vi.fn(() => Promise.resolve());

        preloadLessonVideos({ immediate: [], deferred: ['b'] }, { fetchImpl });

        expect(timeoutSpy).toHaveBeenCalled();
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
