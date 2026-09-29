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
    friendLinkEntryKey,
    upsertFriendLinkMap,
    listActiveFriendLinks,
    resolveRecapFirstClip,
    resolveFriendLessonLink,
} from './friend-lesson-link-logic.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 24, 12, 0, 0); // 2026-09-24T12:00:00Z
const iso = (ms) => new Date(ms).toISOString();

// New (story 026) keyed entries.
const entryA = { courseId: 'friend', lessonId: 'a', shareCode: 'ab12', otherShareCode: '', addedAt: iso(NOW - HOUR) };
const entryB1 = { courseId: 'friend', lessonId: 'b', shareCode: 'ab12', otherShareCode: 'cd34', addedAt: iso(NOW - 2 * HOUR) };
const entryB2 = { courseId: 'friend', lessonId: 'b', shareCode: 'ab12', otherShareCode: 'ef56', addedAt: iso(NOW - 3 * HOUR) };
const entryOther = { courseId: 'other', lessonId: 'b', shareCode: 'cd34', otherShareCode: '', addedAt: iso(NOW - 2 * HOUR) };
// Legacy (story 012) shape: course-keyed, no lessonId / otherShareCode.
const legacyFriend = { courseId: 'friend', shareCode: 'ab12', addedAt: iso(NOW - 1 * HOUR) };

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
            .toBe('ultrafastfluency.com/course/friend/lesson/b?shareCode=ab12');
    });

    it('uses an explicit base when provided', () => {
        const url = buildFriendLessonLink({ courseId: 'model', lessonId: 'b', shareCode: 'zz9', base: 'uff.test' });
        expect(url).toBe('uff.test/course/model/lesson/b?shareCode=zz9');
        expect(url).toContain('/course/model/lesson/b?shareCode=zz9');
    });
});

describe('toFriendLessonHref', () => {
    it('prepends https:// to a scheme-less url', () => {
        expect(toFriendLessonHref('ultrafastfluency.com/course/friend/lesson/b?shareCode=ab12'))
            .toBe('https://ultrafastfluency.com/course/friend/lesson/b?shareCode=ab12');
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

describe('friendLinkEntryKey', () => {
    it('keys an ask entry by course + lesson', () => {
        expect(friendLinkEntryKey({ courseId: 'friend', lessonId: 'a' })).toBe('friend:a');
    });

    it('keys an answer entry by course + lesson', () => {
        expect(friendLinkEntryKey({ courseId: 'friend', lessonId: 'b' })).toBe('friend:b');
    });

    it('adds the co-participant for a co-authored answer entry', () => {
        expect(friendLinkEntryKey({ courseId: 'friend', lessonId: 'b', otherShareCode: 'cd34' }))
            .toBe('friend:b:cd34');
    });

    it('falls back to :legacy when lessonId is absent / empty', () => {
        expect(friendLinkEntryKey({ courseId: 'friend' })).toBe('friend:legacy');
        expect(friendLinkEntryKey({ courseId: 'friend', lessonId: '' })).toBe('friend:legacy');
    });
});

describe('upsertFriendLinkMap', () => {
    it('treats null and {} as an empty map', () => {
        expect(upsertFriendLinkMap(null, entryB1)).toEqual({ 'friend:b:cd34': entryB1 });
        expect(upsertFriendLinkMap({}, entryB1)).toEqual({ 'friend:b:cd34': entryB1 });
    });

    it('keeps concurrent co-participant entries for the same lesson', () => {
        const merged = upsertFriendLinkMap({ 'friend:b:cd34': entryB1 }, entryB2);
        expect(Object.keys(merged).sort()).toEqual(['friend:b:cd34', 'friend:b:ef56']);
        expect(merged['friend:b:ef56']).toEqual(entryB2);
    });

    it('replaces the entry for the same key (addedAt reset)', () => {
        const oldB1 = { ...entryB1, addedAt: iso(NOW - 5 * HOUR) };
        const newB1 = { ...entryB1, addedAt: iso(NOW) };
        const merged = upsertFriendLinkMap({ 'friend:b:cd34': oldB1 }, newB1);
        expect(merged['friend:b:cd34']).toEqual(newB1);
        expect(Object.keys(merged)).toEqual(['friend:b:cd34']);
    });

    it('migrates a legacy course-keyed entry rather than duplicating it', () => {
        const merged = upsertFriendLinkMap({ friend: legacyFriend }, entryA);
        expect(Object.keys(merged)).toEqual(['friend:a']);
        expect(merged['friend:a']).toEqual(entryA);
    });

    it('keeps other keys when adding a new one', () => {
        const merged = upsertFriendLinkMap({ 'friend:a': entryA }, entryOther);
        expect(Object.keys(merged).sort()).toEqual(['friend:a', 'other:b']);
        expect(merged['other:b']).toEqual(entryOther);
    });

    it('does not mutate the input map', () => {
        const input = { 'friend:a': entryA };
        upsertFriendLinkMap(input, entryOther);
        expect(input).toEqual({ 'friend:a': entryA });
    });

    it('ignores non-object input', () => {
        expect(upsertFriendLinkMap('x', entryA)).toEqual({ 'friend:a': entryA });
        expect(upsertFriendLinkMap([entryA], entryA)).toEqual({ 'friend:a': entryA });
    });
});

describe('listActiveFriendLinks', () => {
    it('keeps a legacy entry alongside two active co-authored B entries, newest first', () => {
        const active = listActiveFriendLinks({
            friend: legacyFriend,
            'friend:b:cd34': entryB1,
            'friend:b:ef56': entryB2,
        }, NOW);
        expect(active).toHaveLength(3);
        expect(active.map((e) => e.otherShareCode)).toEqual([undefined, 'cd34', 'ef56']);
        // Legacy entry returned unchanged (no lessonId).
        expect(active[0].lessonId).toBeUndefined();
    });

    it('keeps only entries inside the 48h window', () => {
        const active = listActiveFriendLinks({
            'friend:a': { ...entryA, addedAt: iso(NOW - HOUR) },
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
        expect(listActiveFriendLinks([entryA], NOW)).toEqual([]);
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

describe('resolveRecapFirstClip', () => {
    it('uses the creator for an ask recap', () => {
        expect(resolveRecapFirstClip({ shareCode: 'ab12', courseId: 'friend', lessonId: 'a' }))
            .toEqual({ shareCode: 'ab12', courseId: 'friend', lessonId: 'a' });
    });

    it('uses the co-participant for a co-authored answer recap', () => {
        expect(resolveRecapFirstClip({ shareCode: 'ab12', courseId: 'friend', lessonId: 'b', otherShareCode: 'cd34' }))
            .toEqual({ shareCode: 'cd34', courseId: 'friend', lessonId: 'a' });
    });

    it('uses the creator for an answer recap with no co-participant', () => {
        expect(resolveRecapFirstClip({ shareCode: 'ab12', courseId: 'friend', lessonId: 'b' }))
            .toEqual({ shareCode: 'ab12', courseId: 'friend', lessonId: 'b' });
    });

    it('returns null when any required part is missing', () => {
        expect(resolveRecapFirstClip({ courseId: 'friend', lessonId: 'a' })).toBeNull();
        expect(resolveRecapFirstClip({ shareCode: 'ab12', lessonId: 'a' })).toBeNull();
        expect(resolveRecapFirstClip({ shareCode: 'ab12', courseId: 'friend' })).toBeNull();
        expect(resolveRecapFirstClip({})).toBeNull();
        expect(resolveRecapFirstClip()).toBeNull();
    });
});

describe('resolveFriendLessonLink', () => {
    const configWithB = { lessons: [{ lessonId: 'a' }, { lessonId: 'b' }] };
    const configWithoutB = { lessons: [{ lessonId: 'a' }, { lessonId: 'w' }] };

    it('returns the payload (with lessonId) for a completed/exported lesson a', () => {
        expect(resolveFriendLessonLink({
            configData: configWithB, lessonId: 'a', courseId: 'friend', shareCode: 'ab12', succeeded: 3,
        })).toEqual({ courseId: 'friend', lessonId: 'a', shareCode: 'ab12', otherShareCode: '' });
    });

    it('returns null when the course has no lesson b (guard)', () => {
        expect(resolveFriendLessonLink({
            configData: configWithoutB, lessonId: 'a', courseId: 'model', shareCode: 'ab12', succeeded: 3,
        })).toBeNull();
    });

    it('returns null for any exported lesson other than a without askPublished', () => {
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

    it('returns null without a courseId', () => {
        expect(resolveFriendLessonLink({
            configData: configWithB, lessonId: 'a', courseId: '', shareCode: 'ab12', succeeded: 3,
        })).toBeNull();
        expect(resolveFriendLessonLink({
            configData: configWithB, lessonId: 'a', courseId: undefined, shareCode: 'ab12', succeeded: 3,
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

    it('carries the co-participant for a b export that published ask clips', () => {
        expect(resolveFriendLessonLink({
            configData: configWithB, lessonId: 'b', courseId: 'friend', shareCode: 'ab12', succeeded: 3,
            askPublished: true, otherShareCode: 'cd34',
        })).toEqual({ courseId: 'friend', lessonId: 'b', shareCode: 'ab12', otherShareCode: 'cd34' });
    });

    it('omits the co-participant for a b+askPublished export with no otherShareCode', () => {
        expect(resolveFriendLessonLink({
            configData: configWithB, lessonId: 'b', courseId: 'friend', shareCode: 'ab12', succeeded: 3,
            askPublished: true,
        })).toEqual({ courseId: 'friend', lessonId: 'b', shareCode: 'ab12', otherShareCode: '' });
    });

    it('never marks an ask video as co-authored', () => {
        expect(resolveFriendLessonLink({
            configData: configWithB, lessonId: 'a', courseId: 'friend', shareCode: 'ab12', succeeded: 3,
            askPublished: false, otherShareCode: 'cd34',
        })).toEqual({ courseId: 'friend', lessonId: 'a', shareCode: 'ab12', otherShareCode: '' });
    });

    it('returns null for a b export that published no ask clips', () => {
        expect(resolveFriendLessonLink({
            configData: configWithB, lessonId: 'b', courseId: 'friend', shareCode: 'ab12', succeeded: 3,
        })).toBeNull();
        expect(resolveFriendLessonLink({
            configData: configWithB, lessonId: 'b', courseId: 'friend', shareCode: 'ab12', succeeded: 3,
            askPublished: false,
        })).toBeNull();
    });

    it('keeps the lesson-b guard even when askPublished is true', () => {
        expect(resolveFriendLessonLink({
            configData: configWithoutB, lessonId: 'b', courseId: 'model', shareCode: 'ab12', succeeded: 3, askPublished: true,
        })).toBeNull();
    });

    it('returns null for a b+askPublished export without a real export/shareCode/courseId', () => {
        expect(resolveFriendLessonLink({
            configData: configWithB, lessonId: 'b', courseId: 'friend', shareCode: 'ab12', succeeded: 0, askPublished: true,
        })).toBeNull();
        expect(resolveFriendLessonLink({
            configData: configWithB, lessonId: 'b', courseId: 'friend', shareCode: '', succeeded: 3, askPublished: true,
        })).toBeNull();
        expect(resolveFriendLessonLink({
            configData: configWithB, lessonId: 'b', courseId: '', shareCode: 'ab12', succeeded: 3, askPublished: true,
        })).toBeNull();
    });
});
