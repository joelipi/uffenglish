import { describe, it, expect } from 'vitest';
import {
    FRIEND_LINK_WINDOW_MS,
    nextFriendLessonId,
    hasEarlierShareCtaLesson,
    buildFriendLessonLink,
    toFriendLessonHref,
    getFriendLinkRemainingMs,
    isFriendLinkActive,
    formatFriendLinkRemaining,
    upsertFriendLinkMap,
    listActiveFriendLinks,
    groupActiveFriendLinks,
    resolveFriendLessonLink,
} from './friend-lesson-link-logic.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 24, 12, 0, 0); // 2026-09-24T12:00:00Z
const iso = (ms) => new Date(ms).toISOString();

const entryFriend = { courseId: 'friend', recordedLessonId: 'a', lessonId: 'b', shareCode: 'ab12', addedAt: iso(NOW - HOUR) };
const entryOther = { courseId: 'other', recordedLessonId: 'a', lessonId: 'b', shareCode: 'cd34', addedAt: iso(NOW - 2 * HOUR) };

describe('FRIEND_LINK_WINDOW_MS', () => {
    it('reuses the 48h share window', () => {
        expect(FRIEND_LINK_WINDOW_MS).toBe(48 * HOUR);
    });
});

describe('nextFriendLessonId', () => {
    const chain = {
        lessons: [
            { lessonId: 'a', recapOverlay: 'shareCta' },
            { lessonId: 'b', recapOverlay: 'shareCta' },
            { lessonId: 'c', recapOverlay: 'shareCta' },
            { lessonId: 'd', recapOverlay: 'shareCta' },
        ],
    };

    it('walks a chain of shareCta lessons in order', () => {
        expect(nextFriendLessonId(chain, 'a')).toBe('b');
        expect(nextFriendLessonId(chain, 'b')).toBe('c');
        expect(nextFriendLessonId(chain, 'c')).toBe('d');
        expect(nextFriendLessonId(chain, 'd')).toBeNull();
    });

    it('skips a middle lesson that is not shareCta', () => {
        const gapped = {
            lessons: [
                { lessonId: 'a', recapOverlay: 'shareCta' },
                { lessonId: 'x', recapOverlay: 'videoOnly' },
                { lessonId: 'b', recapOverlay: 'shareCta' },
            ],
        };
        expect(nextFriendLessonId(gapped, 'a')).toBe('b');
    });

    it('returns null for missing config, missing lessonId, or a non-shareCta lesson', () => {
        expect(nextFriendLessonId(null, 'a')).toBeNull();
        expect(nextFriendLessonId(undefined, 'a')).toBeNull();
        expect(nextFriendLessonId({}, 'a')).toBeNull();
        expect(nextFriendLessonId({ lessons: 'nope' }, 'a')).toBeNull();
        expect(nextFriendLessonId(chain, 'zz')).toBeNull();
        expect(nextFriendLessonId(chain, '')).toBeNull();
        expect(nextFriendLessonId(chain, undefined)).toBeNull();
        const noOverlay = { lessons: [{ lessonId: 'a' }, { lessonId: 'b', recapOverlay: 'shareCta' }] };
        expect(nextFriendLessonId(noOverlay, 'a')).toBeNull();
    });
});

describe('hasEarlierShareCtaLesson', () => {
    const chain = {
        lessons: [
            { lessonId: 'a', recapOverlay: 'shareCta' },
            { lessonId: 'b', recapOverlay: 'shareCta' },
            { lessonId: 'c', recapOverlay: 'shareCta' },
        ],
    };

    it('is false for the first chain lesson and true for later ones', () => {
        expect(hasEarlierShareCtaLesson(chain, 'a')).toBe(false);
        expect(hasEarlierShareCtaLesson(chain, 'b')).toBe(true);
        expect(hasEarlierShareCtaLesson(chain, 'c')).toBe(true);
    });

    it('is false for a lesson not in the config or missing input', () => {
        expect(hasEarlierShareCtaLesson(chain, 'z')).toBe(false);
        expect(hasEarlierShareCtaLesson(null, 'a')).toBe(false);
        expect(hasEarlierShareCtaLesson(undefined, 'a')).toBe(false);
        expect(hasEarlierShareCtaLesson({}, 'a')).toBe(false);
    });

    it('is false for a non-shareCta lesson even when a shareCta lesson precedes it', () => {
        const gapped = {
            lessons: [
                { lessonId: 'a', recapOverlay: 'shareCta' },
                { lessonId: 'x', recapOverlay: 'videoOnly' },
            ],
        };
        expect(hasEarlierShareCtaLesson(gapped, 'x')).toBe(false);
    });
});

describe('buildFriendLessonLink', () => {
    it('builds the bare host/path link', () => {
        expect(buildFriendLessonLink({ courseId: 'friend', lessonId: 'b', shareCode: 'ab12' }))
            .toBe('ultrafastfluency.com/course/friend/lesson/b?shareCode=ab12');
    });

    it('uses an explicit base when provided', () => {
        const url = buildFriendLessonLink({ courseId: 'model', lessonId: 'm-a', shareCode: 'zz9', base: 'uff.test' });
        expect(url).toBe('uff.test/course/model/lesson/m-a?shareCode=zz9');
        expect(url).toContain('/course/model/lesson/m-a?shareCode=zz9');
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

describe('upsertFriendLinkMap', () => {
    it('treats null and {} as an empty map', () => {
        expect(upsertFriendLinkMap(null, entryFriend)).toEqual({ 'friend:a': entryFriend });
        expect(upsertFriendLinkMap({}, entryFriend)).toEqual({ 'friend:a': entryFriend });
    });

    it('keys by courseId:recordedLessonId, so different recorded lessons both survive', () => {
        const a = { ...entryFriend, recordedLessonId: 'a', lessonId: 'b' };
        const c = { ...entryFriend, recordedLessonId: 'c', lessonId: 'd' };
        const merged = upsertFriendLinkMap({ 'friend:a': a }, c);
        expect(Object.keys(merged).sort()).toEqual(['friend:a', 'friend:c']);
        expect(merged['friend:c']).toEqual(c);
    });

    it('replaces the entry for the same course+recorded lesson (addedAt reset)', () => {
        const oldEntry = { ...entryFriend, addedAt: iso(NOW - 5 * HOUR) };
        const newEntry = { ...entryFriend, addedAt: iso(NOW) };
        const merged = upsertFriendLinkMap({ 'friend:a': oldEntry }, newEntry);
        expect(merged['friend:a']).toEqual(newEntry);
    });

    it('falls back to ${courseId}:${lessonId} for a legacy entry without recordedLessonId', () => {
        const legacy = { courseId: 'friend', lessonId: 'b', shareCode: 'ab12', addedAt: iso(NOW) };
        expect(upsertFriendLinkMap({}, legacy)).toEqual({ 'friend:b': legacy });
    });

    it('falls back to the course id when neither recordedLessonId nor lessonId is present', () => {
        const noLesson = { courseId: 'friend', shareCode: 'ab12', addedAt: iso(NOW) };
        expect(upsertFriendLinkMap({}, noLesson)).toEqual({ friend: noLesson });
    });

    it('keeps distinct courses for the same recorded lesson id', () => {
        const merged = upsertFriendLinkMap({ 'friend:a': entryFriend }, entryOther);
        expect(Object.keys(merged).sort()).toEqual(['friend:a', 'other:a']);
        expect(merged['other:a']).toEqual(entryOther);
    });

    it('does not mutate the input map', () => {
        const input = { 'friend:a': entryFriend };
        upsertFriendLinkMap(input, entryOther);
        expect(input).toEqual({ 'friend:a': entryFriend });
    });

    it('ignores non-object input', () => {
        expect(upsertFriendLinkMap('x', entryFriend)).toEqual({ 'friend:a': entryFriend });
        expect(upsertFriendLinkMap([entryFriend], entryFriend)).toEqual({ 'friend:a': entryFriend });
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
            a: { courseId: 'a', lessonId: 'b', shareCode: 'x', addedAt: iso(NOW - 3 * HOUR) },
            b: { courseId: 'b', lessonId: 'b', shareCode: 'y', addedAt: iso(NOW - 1 * HOUR) },
        }, NOW);
        expect(active.map((e) => e.courseId)).toEqual(['b', 'a']);
    });

    it('drops entries with no lessonId or no shareCode', () => {
        const active = listActiveFriendLinks({
            legacy: { courseId: 'legacy', shareCode: 'x', addedAt: iso(NOW - HOUR) },
            noCode: { courseId: 'noCode', lessonId: 'b', addedAt: iso(NOW - HOUR) },
            emptyCode: { courseId: 'emptyCode', lessonId: 'b', shareCode: '', addedAt: iso(NOW - HOUR) },
            good: { courseId: 'good', lessonId: 'b', shareCode: 'z', addedAt: iso(NOW - HOUR) },
        }, NOW);
        expect(active.map((e) => e.courseId)).toEqual(['good']);
    });

    it('returns [] for missing / non-object / array input', () => {
        expect(listActiveFriendLinks(null, NOW)).toEqual([]);
        expect(listActiveFriendLinks({}, NOW)).toEqual([]);
        expect(listActiveFriendLinks('x', NOW)).toEqual([]);
        expect(listActiveFriendLinks([entryFriend], NOW)).toEqual([]);
    });

    it('excludes entries with missing or invalid addedAt', () => {
        const active = listActiveFriendLinks({
            noStamp: { courseId: 'noStamp', lessonId: 'b', shareCode: 'x' },
            badStamp: { courseId: 'badStamp', lessonId: 'b', shareCode: 'x', addedAt: 'not-a-date' },
            good: { courseId: 'good', lessonId: 'b', shareCode: 'x', addedAt: iso(NOW - HOUR) },
        }, NOW);
        expect(active.map((e) => e.courseId)).toEqual(['good']);
    });
});

describe('groupActiveFriendLinks', () => {
    it('groups active entries in the same course, order newest-first within a group', () => {
        const groups = groupActiveFriendLinks({
            'friendchain:a': { courseId: 'friendchain', courseName: 'Friend Chain', recordedLessonId: 'a', lessonId: 'b', shareCode: 'x', addedAt: iso(NOW - 3 * HOUR) },
            'friendchain:c': { courseId: 'friendchain', courseName: 'Friend Chain', recordedLessonId: 'c', lessonId: 'd', shareCode: 'x', addedAt: iso(NOW - 1 * HOUR) },
        }, NOW);
        expect(groups).toHaveLength(1);
        expect(groups[0].courseId).toBe('friendchain');
        expect(groups[0].courseName).toBe('Friend Chain');
        expect(groups[0].entries.map((e) => e.recordedLessonId)).toEqual(['c', 'a']);
    });

    it('groups entries in two courses in first-seen order of listActiveFriendLinks', () => {
        const groups = groupActiveFriendLinks({
            'a:a': { courseId: 'a', courseName: 'Course A', recordedLessonId: 'a', lessonId: 'b', shareCode: 'x', addedAt: iso(NOW - 3 * HOUR) },
            'b:a': { courseId: 'b', courseName: 'Course B', recordedLessonId: 'a', lessonId: 'b', shareCode: 'y', addedAt: iso(NOW - 1 * HOUR) },
        }, NOW);
        expect(groups.map((g) => g.courseId)).toEqual(['b', 'a']);
        expect(groups.map((g) => g.courseName)).toEqual(['Course B', 'Course A']);
    });

    it('keeps same-name courses with different courseIds in separate groups', () => {
        const groups = groupActiveFriendLinks({
            'one:a': { courseId: 'one', courseName: 'Same Name', recordedLessonId: 'a', lessonId: 'b', shareCode: 'x', addedAt: iso(NOW - 3 * HOUR) },
            'two:a': { courseId: 'two', courseName: 'Same Name', recordedLessonId: 'a', lessonId: 'b', shareCode: 'y', addedAt: iso(NOW - 1 * HOUR) },
        }, NOW);
        expect(groups).toHaveLength(2);
        expect(groups.map((g) => g.courseId).sort()).toEqual(['one', 'two']);
    });

    it('defaults a missing courseName to the empty string', () => {
        const groups = groupActiveFriendLinks({
            'friendchain:a': { courseId: 'friendchain', recordedLessonId: 'a', lessonId: 'b', shareCode: 'x', addedAt: iso(NOW - HOUR) },
        }, NOW);
        expect(groups[0].courseName).toBe('');
    });

    it('returns [] for expired-only / no entries / junk input', () => {
        expect(groupActiveFriendLinks({
            'friendchain:a': { courseId: 'friendchain', recordedLessonId: 'a', lessonId: 'b', shareCode: 'x', addedAt: iso(NOW - 48 * HOUR) },
        }, NOW)).toEqual([]);
        expect(groupActiveFriendLinks({}, NOW)).toEqual([]);
        expect(groupActiveFriendLinks(null, NOW)).toEqual([]);
        expect(groupActiveFriendLinks('x', NOW)).toEqual([]);
        expect(groupActiveFriendLinks([entryFriend], NOW)).toEqual([]);
    });
});

describe('resolveFriendLessonLink', () => {
    const chain = {
        lessons: [
            { lessonId: 'a', recapOverlay: 'shareCta', title: 'Make 3 questions' },
            { lessonId: 'b', recapOverlay: 'shareCta', title: 'Answer' },
            { lessonId: 'c', recapOverlay: 'shareCta', title: 'Follow Up' },
            { lessonId: 'd', recapOverlay: 'shareCta', title: 'Last' },
        ],
    };

    it('records the exported lesson and targets the next lesson', () => {
        expect(resolveFriendLessonLink({
            configData: chain, lessonId: 'a', courseId: 'friendchain', courseName: 'Friend Chain', shareCode: 'ab12', succeeded: 3,
        })).toEqual({
            courseId: 'friendchain', courseName: 'Friend Chain', recordedLessonId: 'a',
            lessonId: 'b', shareCode: 'ab12', lessonTitle: 'Make 3 questions',
        });
    });

    it('labels with the RECORDED lesson title, not the target lesson title', () => {
        const payload = resolveFriendLessonLink({
            configData: chain, lessonId: 'b', courseId: 'friendchain', courseName: 'Friend Chain', shareCode: 'ab12', succeeded: 3,
        });
        expect(payload.lessonTitle).toBe('Answer');
        expect(payload.lessonId).toBe('c');
        expect(payload.recordedLessonId).toBe('b');
    });

    it('treats a non-string recorded title as an empty lessonTitle', () => {
        const noTitle = { lessons: [
            { lessonId: 'a', recapOverlay: 'shareCta', title: { en: 'x' } },
            { lessonId: 'b', recapOverlay: 'shareCta', title: 'y' },
        ] };
        expect(resolveFriendLessonLink({
            configData: noTitle, lessonId: 'a', courseId: 'c', courseName: 'C', shareCode: 'ab12', succeeded: 3,
        })).toEqual({
            courseId: 'c', courseName: 'C', recordedLessonId: 'a',
            lessonId: 'b', shareCode: 'ab12', lessonTitle: '',
        });
    });

    it('defaults courseName to an empty string when omitted or non-string', () => {
        const omitted = resolveFriendLessonLink({
            configData: chain, lessonId: 'a', courseId: 'friendchain', shareCode: 'ab12', succeeded: 3,
        });
        expect(omitted.courseName).toBe('');
        const nonString = resolveFriendLessonLink({
            configData: chain, lessonId: 'a', courseId: 'friendchain', courseName: 42, shareCode: 'ab12', succeeded: 3,
        });
        expect(nonString.courseName).toBe('');
    });

    it('returns null when the recorded lesson has no next (last chain lesson)', () => {
        expect(resolveFriendLessonLink({
            configData: chain, lessonId: 'd', courseId: 'friendchain', courseName: 'Friend Chain', shareCode: 'ab12', succeeded: 3,
        })).toBeNull();
    });

    it('returns null for a lesson that is not a shareCta lesson', () => {
        const withPlain = { lessons: [{ lessonId: 'a', recapOverlay: 'shareCta' }, { lessonId: 'b' }, { lessonId: 'c', recapOverlay: 'shareCta' }] };
        expect(resolveFriendLessonLink({
            configData: withPlain, lessonId: 'b', courseId: 'friendchain', shareCode: 'ab12', succeeded: 3,
        })).toBeNull();
    });

    it('returns null without a real export or shareCode', () => {
        expect(resolveFriendLessonLink({
            configData: chain, lessonId: 'a', courseId: 'friendchain', shareCode: 'ab12', succeeded: 0,
        })).toBeNull();
        expect(resolveFriendLessonLink({
            configData: chain, lessonId: 'a', courseId: 'friendchain', shareCode: '', succeeded: 3,
        })).toBeNull();
    });

    it('returns null without a courseId', () => {
        expect(resolveFriendLessonLink({
            configData: chain, lessonId: 'a', courseId: '', shareCode: 'ab12', succeeded: 3,
        })).toBeNull();
        expect(resolveFriendLessonLink({
            configData: chain, lessonId: 'a', courseId: undefined, shareCode: 'ab12', succeeded: 3,
        })).toBeNull();
    });

    it('returns null for missing configData', () => {
        expect(resolveFriendLessonLink({
            configData: null, lessonId: 'a', courseId: 'friendchain', shareCode: 'ab12', succeeded: 3,
        })).toBeNull();
        expect(resolveFriendLessonLink({
            configData: undefined, lessonId: 'a', courseId: 'friendchain', shareCode: 'ab12', succeeded: 3,
        })).toBeNull();
        expect(resolveFriendLessonLink({
            configData: {}, lessonId: 'a', courseId: 'friendchain', shareCode: 'ab12', succeeded: 3,
        })).toBeNull();
    });
});
