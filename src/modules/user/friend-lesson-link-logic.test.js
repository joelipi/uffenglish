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
    listActiveFriendLinks,
    groupActiveFriendLinks,
    buildFriendPracticeView,
    buildVisitorPracticeView,
    listFriendCourseIds,
    buildChainHeads,
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

// The map merge moved server-side (`record_friend_link`, migration 011): a
// client-side read-modify-write could lose an entry SILENTLY, because a
// zero-row UPDATE is not an error in PostgREST. Its shape is guarded by
// src/modules/api/friend-link-write-migration.test.js.

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

    it('defaults a missing courseName to the courseId', () => {
        const groups = groupActiveFriendLinks({
            'friendchain:a': { courseId: 'friendchain', recordedLessonId: 'a', lessonId: 'b', shareCode: 'x', addedAt: iso(NOW - HOUR) },
        }, NOW);
        expect(groups[0].courseName).toBe('friendchain');
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

describe('buildFriendPracticeView', () => {
    it('is active and ticking with groups when a link is inside the window', () => {
        const view = buildFriendPracticeView({
            'friendchain:a': { courseId: 'friendchain', courseName: 'Friend Chain', recordedLessonId: 'a', lessonId: 'b', shareCode: 'x', addedAt: iso(NOW - HOUR) },
        }, NOW);
        expect(view.mode).toBe('active');
        expect(view.isTicking).toBe(true);
        expect(view.groups).toHaveLength(1);
    });

    it('is expired and not ticking when nothing is active', () => {
        expect(buildFriendPracticeView({}, NOW)).toEqual({ mode: 'expired', groups: [], isTicking: false });
        expect(buildFriendPracticeView(null, NOW)).toEqual({ mode: 'expired', groups: [], isTicking: false });
        const expired = buildFriendPracticeView({
            'friendchain:a': { courseId: 'friendchain', recordedLessonId: 'a', lessonId: 'b', shareCode: 'x', addedAt: iso(NOW - 48 * HOUR) },
        }, NOW);
        expect(expired).toEqual({ mode: 'expired', groups: [], isTicking: false });
    });
});

describe('listFriendCourseIds / buildChainHeads', () => {
    it('lists the unique course ids referenced by the links, ascending', () => {
        expect(listFriendCourseIds({
            'b:x': { courseId: 'b' },
            'a:x': { courseId: 'a' },
            'a:y': { courseId: 'a' },
        })).toEqual(['a', 'b']);
    });

    it('returns [] for missing / junk input', () => {
        expect(listFriendCourseIds(null)).toEqual([]);
        expect(listFriendCourseIds('x')).toEqual([]);
        expect(listFriendCourseIds([{ courseId: 'a' }])).toEqual([]);
        expect(listFriendCourseIds({ bad: null, empty: { courseId: '' } })).toEqual([]);
    });

    it('maps each { courseId, config } to its first shareCta lesson', () => {
        const heads = buildChainHeads([
            { courseId: 'friendchain', config: { lessons: [{ lessonId: 'a', recapOverlay: 'shareCta' }, { lessonId: 'b', recapOverlay: 'shareCta' }] } },
            { courseId: 'nocourse', config: { lessons: [{ lessonId: 'z' }] } },
        ]);
        expect(heads.get('friendchain')).toBe('a');
        expect(heads.has('nocourse')).toBe(false);
    });

    it('returns an empty Map for junk input', () => {
        expect(buildChainHeads(null).size).toBe(0);
        expect(buildChainHeads([null, { courseId: 'x' }]).size).toBe(0);
    });
});

describe('buildVisitorPracticeView', () => {
    // friendchain and friend both head at 'a'; the second chain lesson is 'c'.
    const heads = new Map([['friendchain', 'a'], ['other', 'a']]);
    const entryA = {
        courseId: 'friendchain', courseName: 'Friend Chain', recordedLessonId: 'a',
        lessonId: 'b', shareCode: 'owner1', addedAt: iso(NOW - HOUR), lessonTitle: 'Ask',
    };
    const entryC = {
        courseId: 'friendchain', courseName: 'Friend Chain', recordedLessonId: 'c',
        lessonId: 'd', shareCode: 'owner1', addedAt: iso(NOW - 2 * HOUR), lessonTitle: 'Follow Up',
    };
    const mixedLinks = { 'friendchain:a': entryA, 'friendchain:c': entryC };
    const emptyViewer = { shareCode: 'viewer1', counted_lessons: [], notifications: [], ownerShareCode: 'owner1' };
    const recordedLessons = (view) => view.groups.flatMap((g) => g.entries.map((e) => e.recordedLessonId));

    it('logged-out: lists only chain-head entries, newest first, flagged not-together', () => {
        const view = buildVisitorPracticeView({ friendLinks: mixedLinks, nowMs: NOW, viewer: null, chainHeads: heads });
        expect(view.mode).toBe('active');
        expect(view.isTicking).toBe(true);
        const entries = view.groups.flatMap((g) => g.entries);
        expect(entries.map((e) => e.recordedLessonId)).toEqual(['a']);
        expect(entries[0].completedTogether).toBe(false);
    });

    it('logged-out: fails open for a course absent from chainHeads', () => {
        const missing = {
            courseId: 'missing', courseName: 'Missing', recordedLessonId: 'z',
            lessonId: 'y', shareCode: 'owner1', addedAt: iso(NOW - HOUR),
        };
        const view = buildVisitorPracticeView({
            friendLinks: { 'missing:z': missing, 'friendchain:c': entryC },
            nowMs: NOW, viewer: null, chainHeads: heads,
        });
        expect(recordedLessons(view)).toEqual(['z']);
    });

    it('logged-in: an inbox row naming the owner features the owner recorded lesson first', () => {
        const viewer = {
            ...emptyViewer,
            notifications: [{ type: 'friend_response', course_id: 'friendchain', lesson_id: 'c', payload: { actorShareCode: 'owner1' } }],
        };
        const view = buildVisitorPracticeView({ friendLinks: mixedLinks, nowMs: NOW, viewer, chainHeads: heads });
        // featuring entry first, then the chain head; 'c' has no recorder match.
        expect(recordedLessons(view)).toEqual(['c', 'a']);
        const featuring = view.groups.flatMap((g) => g.entries).find((e) => e.recordedLessonId === 'c');
        expect(featuring.completedTogether).toBe(false);
    });

    it('logged-in: a counted key features the entry and badges it as completed together', () => {
        const viewer = { ...emptyViewer, counted_lessons: ['friendchain_c'] };
        const view = buildVisitorPracticeView({ friendLinks: mixedLinks, nowMs: NOW, viewer, chainHeads: heads });
        expect(recordedLessons(view)).toEqual(['c', 'a']);
        const featuring = view.groups.flatMap((g) => g.entries).find((e) => e.recordedLessonId === 'c');
        expect(featuring.completedTogether).toBe(true);
    });

    it('logged-in: joins on recordedLessonId, never the follow-on lessonId', () => {
        // The viewer's mentions point at 'd' (entry.lessonId); they must not
        // feature entry 'c' (recordedLessonId 'c').
        const viewer = {
            ...emptyViewer,
            counted_lessons: ['friendchain_d'],
            notifications: [{ type: 'friend_response', course_id: 'friendchain', lesson_id: 'd', payload: { actorShareCode: 'owner1' } }],
        };
        const view = buildVisitorPracticeView({ friendLinks: mixedLinks, nowMs: NOW, viewer, chainHeads: heads });
        expect(recordedLessons(view)).toEqual(['a']);
    });

    it('logged-in: an entry both featuring and chain-head appears once, in the featuring group', () => {
        const viewer = { ...emptyViewer, counted_lessons: ['friendchain_a'] };
        const view = buildVisitorPracticeView({
            friendLinks: { 'friendchain:a': entryA }, nowMs: NOW, viewer, chainHeads: heads,
        });
        expect(recordedLessons(view)).toEqual(['a']);
        expect(view.groups.flatMap((g) => g.entries)).toHaveLength(1);
        expect(view.groups[0].entries[0].completedTogether).toBe(true);
    });

    it('logged-in with no featuring entries: only chain-head lessons, matching the logged-out list', () => {
        const loggedIn = buildVisitorPracticeView({ friendLinks: mixedLinks, nowMs: NOW, viewer: emptyViewer, chainHeads: heads });
        const loggedOut = buildVisitorPracticeView({ friendLinks: mixedLinks, nowMs: NOW, viewer: null, chainHeads: heads });
        expect(recordedLessons(loggedIn)).toEqual(recordedLessons(loggedOut));
        const entries = loggedIn.groups.flatMap((g) => g.entries);
        expect(entries.every((e) => e.completedTogether === false)).toBe(true);
    });

    it('is expired with the unchanged shape for empty / expired input', () => {
        expect(buildVisitorPracticeView({ friendLinks: {}, nowMs: NOW, viewer: emptyViewer, chainHeads: heads }))
            .toEqual({ mode: 'expired', groups: [], isTicking: false });
        expect(buildVisitorPracticeView({ friendLinks: null, nowMs: NOW, viewer: null }))
            .toEqual({ mode: 'expired', groups: [], isTicking: false });
        expect(buildVisitorPracticeView({
            friendLinks: { 'friendchain:a': { ...entryA, addedAt: iso(NOW - 48 * HOUR) } },
            nowMs: NOW, viewer: emptyViewer, chainHeads: heads,
        })).toEqual({ mode: 'expired', groups: [], isTicking: false });
    });

    it('is expired when the visitor filter leaves nothing (only non-head links)', () => {
        const view = buildVisitorPracticeView({
            friendLinks: { 'friendchain:c': entryC }, nowMs: NOW, viewer: null, chainHeads: heads,
        });
        expect(view.mode).toBe('expired');
        expect(view.groups).toEqual([]);
    });

    it('delegates to buildFriendPracticeView without a viewer and without chainHeads', () => {
        const links = { 'friendchain:a': entryA };
        expect(buildVisitorPracticeView({ friendLinks: links, nowMs: NOW }))
            .toEqual(buildFriendPracticeView(links, NOW));
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
