// src/config/friend-lesson-link-config.test.js
// The friend-challenge chain is the sequence of `recapOverlay: "shareCta"`
// lessons in config order. These tests lock the premise on the real configs:
// the link after a lesson exists only where a later shareCta lesson follows.
//
// The course set is small on purpose: one single-user course (`model.json`,
// the regular-flow reference) and one friend course (`wouldyourather-test.json`,
// the dev twin of the generated `wouldyourather.json`).
import { describe, it, expect } from 'vitest';
import model from './model.json';
import friend from './wouldyourather-test.json';
import { nextFriendLessonId } from '../modules/user/friend-lesson-link-logic.js';

function lessonIds(config) {
    return config.lessons.map((l) => l.lessonId);
}

describe('shareCta-order chain premise', () => {
    it('the friend course chains a -> b -> ... -> g -> (null)', () => {
        expect(lessonIds(friend)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
        expect(nextFriendLessonId(friend, 'a')).toBe('b');
        expect(nextFriendLessonId(friend, 'b')).toBe('c');
        expect(nextFriendLessonId(friend, 'e')).toBe('f');
        expect(nextFriendLessonId(friend, 'f')).toBe('g');
        expect(nextFriendLessonId(friend, 'g')).toBeNull();
    });

    it('model.json has no single-letter friend lesson ids', () => {
        const ids = lessonIds(model);
        expect(ids).not.toContain('a');
        expect(ids).not.toContain('b');
    });

    it('single-user configs have no bare single-letter lesson ids', () => {
        // A single-letter id (a-z) is route-detected as a friend lesson, so
        // non-friend courses must not use them.
        const singleLetter = /^[a-z]$/;
        for (const [name, config] of Object.entries({ model })) {
            for (const id of lessonIds(config)) {
                expect(singleLetter.test(id), `${name} lesson id ${id} looks like a friend lesson`).toBe(false);
            }
        }
    });
});

describe('model.json has no friend-challenge chain', () => {
    it('contains no shareCta lessons, so nextFriendLessonId is always null', () => {
        // model.json is single-user; its early friend lessons were removed.
        expect(nextFriendLessonId(model, 'm-t')).toBeNull();
        expect(nextFriendLessonId(model, 'm-x')).toBeNull();
        expect(model.lessons.some((l) => l.recapOverlay === 'shareCta')).toBe(false);
    });
});

// The friend course's answer lessons republish the ASK lesson's question
// takes, so the other user can answer them in the next lesson.
describe('the friend course republishes the ask lesson questions', () => {
    it('the answer lesson tags its record steps with the ask lesson id', () => {
        const a = friend.lessons.find((l) => l.lessonId === 'a');
        const b = friend.lessons.find((l) => l.lessonId === 'b');
        // The ask lesson records its own questions; it republishes nothing.
        expect(a.steps.filter((s) => s.publishLessonId !== undefined)).toHaveLength(0);
        // The answer lesson records the ask lesson's question takes, published
        // under the ask lesson's id so the other user can answer them.
        const askSteps = b.steps.filter((s) => s.publishLessonId === 'a');
        expect(askSteps.length).toBeGreaterThan(0);
        for (const step of askSteps) {
            expect(step.simpleVideoUrl, `${step.simpleVideoUrl} is not an a-question take`)
                .toMatch(/^wouldyourather-a-\d{2}-\d{2}$/);
        }
    });
});

// A `{friendCode}<courseId>-<lessonId>-response-NN` reference must point at
// a lesson that exists in the same course, because clips publish under the
// exported lesson id (buildUgcSegmentKey). A lesson rename that misses a
// reference would silently 404 the friend's clip (regression: model w -> m-w).
describe('{friendCode} references resolve to a real lesson', () => {
    const CONFIGS = { friend, model };
    const VIDEO_FIELDS = ['interactiveVideoUrl', 'introBackgroundVideoUrl', 'simpleVideoUrl'];

    it('every friend-slug lesson component exists in the same config', () => {
        for (const [name, config] of Object.entries(CONFIGS)) {
            const ids = new Set(lessonIds(config));
            for (const lesson of config.lessons) {
                for (const step of lesson.steps || []) {
                    for (const field of VIDEO_FIELDS) {
                        const value = step[field];
                        if (typeof value !== 'string' || !value.includes('{friendCode}')) continue;
                        // UGC shape: {recorder}-{inviter}-<course>-<lesson>-<NN>
                        const parts = value.replace('{friendCode}', '').replace('{selfCode}', '')
                            .split('-').filter(Boolean);
                        const lessonPart = parts.length >= 3 ? parts[parts.length - 2] : null;
                        expect(lessonPart, `${name} ${lesson.lessonId}: unparseable friend slug ${value}`).not.toBeNull();
                        expect(ids, `${name} ${lesson.lessonId}: ${value} points at missing lesson ${lessonPart}`)
                            .toContain(lessonPart);
                    }
                }
            }
        }
    });
});
