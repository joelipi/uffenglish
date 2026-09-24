import { describe, it, expect } from 'vitest';
import {
    ASK_LESSON_ID,
    ANSWER_LESSON_ID,
    FRIEND_LINK_WINDOW_MS,
    buildFriendLessonLink,
    toFriendLessonHref,
    getFriendLinkRemainingMs,
    isFriendLinkActive,
    formatFriendLinkRemaining,
    upsertFriendLinkMap,
    listActiveFriendLinks,
    resolveFriendLessonLink,
} from './friend-lesson-link-logic.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 24, 12, 0, 0); // 2026-09-24T12:00:00Z
const iso = (ms) => new Date(ms).toISOString();

const entryFriend = { courseId: 'friend', shareCode: 'ab12', addedAt: iso(NOW - HOUR) };
const entryOther = { courseId: 'other', shareCode: 'cd34', addedAt: iso(NOW - 2 * HOUR) };

describe('fixed mapping constants', () => {
    it('pins the ask lesson to a and the answer lesson to b', () => {
        expect(ASK_LESSON_ID).toBe('a');
        expect(ANSWER_LESSON_ID).toBe('b');
    });

    it('reuses the 48h share window', () => {
        expect(FRIEND_LINK_WINDOW_MS).toBe(48 * HOUR);
    });
});

describe('buildFriendLessonLink', () => {
    it('builds the bare host/path link', () => {
        expect(buildFriendLessonLink({ courseId: 'friend', lessonId: 'b', shareCode: 'ab12' }))
            .toBe('example.com/course/friend/lesson/b?shareCode=ab12');
    });

    it('uses an explicit base when provided', () => {
        const url = buildFriendLessonLink({ courseId: 'model', lessonId: 'b', shareCode: 'zz9', base: 'uff.test' });
        expect(url).toBe('uff.test/course/model/lesson/b?shareCode=zz9');
        expect(url).toContain('/course/model/lesson/b?shareCode=zz9');
    });
});

describe('toFriendLessonHref', () => {
    it('prepends https:// to a scheme-less url', () => {
        expect(toFriendLessonHref('example.com/course/friend/lesson/b?shareCode=ab12'))
            .toBe('https://example.com/course/friend/lesson/b?shareCode=ab12');
    });

    it('leaves already-schemed urls unchanged', () => {
        expect(toFriendLessonHref('https://x/y')).toBe('https://x/y');
        expect(toFriendLessonHref('http://x/y')).toBe('http://x/y');
    });
});

describe('getFriendLinkRemainingMs / isFriendLinkActive', () => {
    it('returns the full window at add time', () => {
        expect(getFriendLinkRemainingMs(NOW, NOW)).toBe(FRIEND_LINK_WINDOW_MS);
    });

    it('returns 0 at and after the 48h boundary (clamped)', () => {
        expect(getFriendLinkRemainingMs(NOW, NOW + 48 * HOUR)).toBe(0);
        expect(getFriendLinkRemainingMs(NOW, NOW + 49 * HOUR)).toBe(0);
    });

    it('is active one millisecond before the boundary and inactive at it', () => {
        expect(isFriendLinkActive(NOW, NOW + 48 * HOUR - 1)).toBe(true);
        expect(isFriendLinkActive(NOW, NOW + 48 * HOUR)).toBe(false);
    });
});

describe('formatFriendLinkRemaining', () => {
    it.each([
        [48 * HOUR, '48h 0m'],
        [47 * HOUR, '47h 0m'],
        [90 * 60 * 1000, '1h 30m'],
        [59 * 60 * 1000, '59m'],
        [30 * 1000, '0m'],
    ])('formats %d ms as %s', (ms, expected) => {
        expect(formatFriendLinkRemaining(ms)).toBe(expected);
    });

    it('returns null for non-positive / missing values', () => {
        expect(formatFriendLinkRemaining(0)).toBeNull();
        expect(formatFriendLinkRemaining(-1)).toBeNull();
        expect(formatFriendLinkRemaining(null)).toBeNull();
        expect(formatFriendLinkRemaining(undefined)).toBeNull();
    });
});

describe('upsertFriendLinkMap', () => {
    it('treats null and {} as an empty map', () => {
        expect(upsertFriendLinkMap(null, entryFriend)).toEqual({ friend: entryFriend });
        expect(upsertFriendLinkMap({}, entryFriend)).toEqual({ friend: entryFriend });
    });

    it('keeps other courses when adding a new one', () => {
        const merged = upsertFriendLinkMap({ friend: entryFriend }, entryOther);
        expect(Object.keys(merged).sort()).toEqual(['friend', 'other']);
        expect(merged.other).toEqual(entryOther);
    });

    it('replaces the entry for the same course (addedAt reset)', () => {
        const oldEntry = { ...entryFriend, addedAt: iso(NOW - 5 * HOUR) };
        const newEntry = { ...entryFriend, addedAt: iso(NOW) };
        const merged = upsertFriendLinkMap({ friend: oldEntry }, newEntry);
        expect(merged.friend).toEqual(newEntry);
    });

    it('does not mutate the input map', () => {
        const input = { friend: entryFriend };
        upsertFriendLinkMap(input, entryOther);
        expect(input).toEqual({ friend: entryFriend });
    });

    it('ignores non-object input', () => {
        expect(upsertFriendLinkMap('x', entryFriend)).toEqual({ friend: entryFriend });
        expect(upsertFriendLinkMap([entryFriend], entryFriend)).toEqual({ friend: entryFriend });
    });
});

describe('listActiveFriendLinks', () => {
    it('keeps only entries inside the 48h window', () => {
        const active = listActiveFriendLinks({
            friend: { ...entryFriend, addedAt: iso(NOW - HOUR) },
            old: { ...entryOther, addedAt: iso(NOW - 48 * HOUR) },
        }, NOW);
        expect(active).toHaveLength(1);
        expect(active[0].courseId).toBe('friend');
    });

    it('sorts newest first', () => {
        const active = listActiveFriendLinks({
            a: { courseId: 'a', addedAt: iso(NOW - 3 * HOUR) },
            b: { courseId: 'b', addedAt: iso(NOW - 1 * HOUR) },
        }, NOW);
        expect(active.map((e) => e.courseId)).toEqual(['b', 'a']);
    });

    it('returns [] for missing / non-object / array input', () => {
        expect(listActiveFriendLinks(null, NOW)).toEqual([]);
        expect(listActiveFriendLinks({}, NOW)).toEqual([]);
        expect(listActiveFriendLinks('x', NOW)).toEqual([]);
        expect(listActiveFriendLinks([entryFriend], NOW)).toEqual([]);
    });

    it('excludes entries with missing or invalid addedAt', () => {
        const active = listActiveFriendLinks({
            noStamp: { courseId: 'noStamp' },
            badStamp: { courseId: 'badStamp', addedAt: 'not-a-date' },
            good: { courseId: 'good', addedAt: iso(NOW - HOUR) },
        }, NOW);
        expect(active.map((e) => e.courseId)).toEqual(['good']);
    });
});

describe('resolveFriendLessonLink', () => {
    const configWithB = { lessons: [{ lessonId: 'a' }, { lessonId: 'b' }] };
    const configWithoutB = { lessons: [{ lessonId: 'a' }, { lessonId: 'w' }] };

    it('returns the payload for a completed/exported lesson a in a course with lesson b', () => {
        expect(resolveFriendLessonLink({
            configData: configWithB, lessonId: 'a', courseId: 'friend', shareCode: 'ab12', succeeded: 3,
        })).toEqual({ courseId: 'friend', shareCode: 'ab12' });
    });

    it('returns null when the course has no lesson b (guard)', () => {
        expect(resolveFriendLessonLink({
            configData: configWithoutB, lessonId: 'a', courseId: 'model', shareCode: 'ab12', succeeded: 3,
        })).toBeNull();
    });

    it('returns null for any exported lesson other than a', () => {
        for (const lessonId of ['b', 'w', '']) {
            expect(resolveFriendLessonLink({
                configData: configWithB, lessonId, courseId: 'friend', shareCode: 'ab12', succeeded: 3,
            })).toBeNull();
        }
    });

    it('returns null without a real export or shareCode', () => {
        expect(resolveFriendLessonLink({
            configData: configWithB, lessonId: 'a', courseId: 'friend', shareCode: 'ab12', succeeded: 0,
        })).toBeNull();
        expect(resolveFriendLessonLink({
            configData: configWithB, lessonId: 'a', courseId: 'friend', shareCode: '', succeeded: 3,
        })).toBeNull();
    });

    it('returns null for missing configData', () => {
        expect(resolveFriendLessonLink({
            configData: null, lessonId: 'a', courseId: 'friend', shareCode: 'ab12', succeeded: 3,
        })).toBeNull();
        expect(resolveFriendLessonLink({
            configData: undefined, lessonId: 'a', courseId: 'friend', shareCode: 'ab12', succeeded: 3,
        })).toBeNull();
    });
});
