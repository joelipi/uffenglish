import { describe, it, expect } from 'vitest';
import friend from './friend.json';
import model from './model.json';
import gt2 from './gt2.json';
import wouldrather from './wouldrather.json';
import friendchain from './friendchain.json';
import t from './t.json';
import testApi from './test-api.json';
import testConfig from './test.json';
import { nextFriendLessonId } from '../modules/user/friend-lesson-link-logic.js';

// The friend-challenge chain is the sequence of `recapOverlay: "shareCta"`
// lessons in config order. These tests lock the premise on the real configs:
// the link after a lesson exists only where a later shareCta lesson follows.

function lessonIds(config) {
    return config.lessons.map((l) => l.lessonId);
}

describe('shareCta-order chain premise', () => {
    it('friend.json chains a -> b -> (null): b is the last shareCta lesson', () => {
        expect(lessonIds(friend)).toContain('a');
        expect(lessonIds(friend)).toContain('b');
        expect(nextFriendLessonId(friend, 'a')).toBe('b');
        expect(nextFriendLessonId(friend, 'b')).toBeNull();
    });

    it('wouldrather.json chains a -> b -> (null)', () => {
        expect(nextFriendLessonId(wouldrather, 'a')).toBe('b');
        expect(nextFriendLessonId(wouldrather, 'b')).toBeNull();
    });

    it('friendchain.json chains a -> b -> ... -> h -> (null)', () => {
        expect(nextFriendLessonId(friendchain, 'a')).toBe('b');
        expect(nextFriendLessonId(friendchain, 'b')).toBe('c');
        expect(nextFriendLessonId(friendchain, 'g')).toBe('h');
        expect(nextFriendLessonId(friendchain, 'h')).toBeNull();
    });

    it('a config with no shareCta lessons yields no next', () => {
        // gt2 has no shareCta lessons at all.
        expect(nextFriendLessonId(gt2, 'g-a')).toBeNull();
    });

    it('model.json has no single-letter friend lesson ids', () => {
        const ids = lessonIds(model);
        expect(ids).not.toContain('a');
        expect(ids).not.toContain('b');
    });

    it('gt2.json has no single-letter friend lesson ids', () => {
        const ids = lessonIds(gt2);
        expect(ids).not.toContain('a');
        expect(ids).not.toContain('b');
    });

    it('single-user configs have no bare single-letter lesson ids', () => {
        // A single-letter id (a-z) is route-detected as a friend lesson, so
        // non-friend courses must not use them (model/gt2/t/test-api renamed).
        const singleLetter = /^[a-z]$/;
        for (const [name, config] of Object.entries({ model, gt2, t, testApi })) {
            for (const id of lessonIds(config)) {
                expect(singleLetter.test(id), `${name} lesson id ${id} looks like a friend lesson`).toBe(false);
            }
        }
    });
});

describe('model.json shareCta lessons chain in config order', () => {
    it('orders w -> wa -> wf -> wfa', () => {
        // model.json contains four shareCta lessons; the generic rule orders
        // them by their position in configData.lessons.
        expect(nextFriendLessonId(model, 'm-w')).toBe('wa');
        expect(nextFriendLessonId(model, 'wa')).toBe('wf');
        expect(nextFriendLessonId(model, 'wf')).toBe('wfa');
        expect(nextFriendLessonId(model, 'wfa')).toBeNull();
    });
});

// A `{friendCode}<courseId>-<lessonId>-response-NN` reference must point at a
// lesson that exists in the same course, because clips publish under the
// exported lesson id (buildUgcSegmentKey). A lesson rename that misses a
// reference would silently 404 the friend's clip (regression: model w -> m-w).
describe('{friendCode} references resolve to a real lesson', () => {
    const CONFIGS = { friend, model, gt2, wouldrather, friendchain, t, testApi, test: testConfig };
    const VIDEO_FIELDS = ['interactiveVideoUrl', 'introBackgroundVideoUrl', 'simpleVideoUrl'];

    it('every friend-slug lesson component exists in the same config', () => {
        for (const [name, config] of Object.entries(CONFIGS)) {
            const ids = new Set(lessonIds(config));
            for (const lesson of config.lessons) {
                for (const step of lesson.steps || []) {
                    for (const field of VIDEO_FIELDS) {
                        const value = step[field];
                        if (typeof value !== 'string' || !value.includes('{friendCode}')) continue;
                        const match = /-([a-z0-9-]+)-response-\d+$/.exec(value.replace('{friendCode}', ''));
                        expect(match, `${name} ${lesson.lessonId}: unparseable friend slug ${value}`).not.toBeNull();
                        expect(ids, `${name} ${lesson.lessonId}: ${value} points at missing lesson ${match[1]}`)
                            .toContain(match[1]);
                    }
                }
            }
        }
    });
});

// The legacy friend.json `b` still embeds three ask-recording steps tagged
// `publishLessonId: "a"`. Preserve this invariant while the file exists.
describe('friend.json b embedded ask steps', () => {
    const b = friend.lessons.find((l) => l.lessonId === 'b');

    it('tags exactly three steps with publishLessonId a, and no other lesson', () => {
        const askSteps = b.steps.filter((s) => s.publishLessonId === 'a');
        expect(askSteps).toHaveLength(3);
        const taggedLessons = friend.lessons.flatMap((l) =>
            l.steps.filter((s) => s.publishLessonId !== undefined).map(() => l.lessonId)
        );
        expect([...new Set(taggedLessons)]).toEqual(['b']);
    });
});
