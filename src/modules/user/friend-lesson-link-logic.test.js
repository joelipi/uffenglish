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
    resolveFriendLessonLink,
} from './friend-lesson-link-logic.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 24, 12, 0, 0); // 2026-09-24T12:00:00Z
const iso = (ms) => new Date(ms).toISOString();

const entryFriend = { courseId: 'friend', lessonId: 'b', shareCode: 'ab12', addedAt: iso(NOW - HOUR) };
const entryOther = { courseId: 'other', lessonId: 'b', shareCode: 'cd34', addedAt: iso(NOW - 2 * HOUR) };

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
        expect(upsertFriendLinkMap(null, entryFriend)).toEqual({ 'friend:b': entryFriend });
        expect(upsertFriendLinkMap({}, entryFriend)).toEqual({ 'friend:b': entryFriend });
    });

    it('keys by courseId:lessonId, so different lessons both survive', () => {
        const b = { ...entryFriend, lessonId: 'b' };
        const c = { ...entryFriend, lessonId: 'c' };
        const merged = upsertFriendLinkMap({ 'friend:b': b }, c);
        expect(Object.keys(merged).sort()).toEqual(['friend:b', 'friend:c']);
        expect(merged['friend:c']).toEqual(c);
    });

    it('replaces the entry for the same course+lesson (addedAt reset)', () => {
        const oldEntry = { ...entryFriend, addedAt: iso(NOW - 5 * HOUR) };
        const newEntry = { ...entryFriend, addedAt: iso(NOW) };
        const merged = upsertFriendLinkMap({ 'friend:b': oldEntry }, newEntry);
        expect(merged['friend:b']).toEqual(newEntry);
    });

    it('falls back to the course id when lessonId is absent (legacy entry)', () => {
        const legacy = { courseId: 'friend', shareCode: 'ab12', addedAt: iso(NOW) };
        expect(upsertFriendLinkMap({}, legacy)).toEqual({ friend: legacy });
    });

    it('keeps distinct courses for the same lesson id', () => {
        const merged = upsertFriendLinkMap({ 'friend:b': entryFriend }, entryOther);
        expect(Object.keys(merged).sort()).toEqual(['friend:b', 'other:b']);
        expect(merged['other:b']).toEqual(entryOther);
    });

    it('does not mutate the input map', () => {
        const input = { 'friend:b': entryFriend };
        upsertFriendLinkMap(input, entryOther);
        expect(input).toEqual({ 'friend:b': entryFriend });
    });

    it('ignores non-object input', () => {
        expect(upsertFriendLinkMap('x', entryFriend)).toEqual({ 'friend:b': entryFriend });
        expect(upsertFriendLinkMap([entryFriend], entryFriend)).toEqual({ 'friend:b': entryFriend });
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

describe('resolveFriendLessonLink', () => {
    const chain = {
        lessons: [
            { lessonId: 'a', recapOverlay: 'shareCta', title: { en: 'Ask' } },
            { lessonId: 'b', recapOverlay: 'shareCta', title: 'Answer' },
            { lessonId: 'c', recapOverlay: 'shareCta', title: 'Follow Up' },
            { lessonId: 'd', recapOverlay: 'shareCta', title: 'Last' },
        ],
    };

    it('returns the next lesson payload with the next lesson title', () => {
        expect(resolveFriendLessonLink({
            configData: chain, lessonId: 'b', courseId: 'friendchain', shareCode: 'ab12', succeeded: 3,
        })).toEqual({ courseId: 'friendchain', lessonId: 'c', shareCode: 'ab12', lessonTitle: 'Follow Up' });
    });

    it('treats a non-string title as an empty lessonTitle', () => {
        expect(resolveFriendLessonLink({
            configData: chain, lessonId: 'a', courseId: 'friendchain', shareCode: 'ab12', succeeded: 3,
        })).toEqual({ courseId: 'friendchain', lessonId: 'b', shareCode: 'ab12', lessonTitle: 'Answer' });
        // c -> d, d title is a string; use a config where the next title is not a string.
        const noTitle = { lessons: [{ lessonId: 'a', recapOverlay: 'shareCta' }, { lessonId: 'b', recapOverlay: 'shareCta', title: { en: 'x' } }] };
        expect(resolveFriendLessonLink({
            configData: noTitle, lessonId: 'a', courseId: 'c', shareCode: 'ab12', succeeded: 3,
        })).toEqual({ courseId: 'c', lessonId: 'b', shareCode: 'ab12', lessonTitle: '' });
    });

    it('returns null when the lesson has no next (last chain lesson)', () => {
        expect(resolveFriendLessonLink({
            configData: chain, lessonId: 'd', courseId: 'friendchain', shareCode: 'ab12', succeeded: 3,
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
