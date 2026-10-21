import { describe, it, expect } from 'vitest';
import {
    FRIEND_LINK_WINDOW_MS,
    nextFriendLessonId,
    isTerminalFriendLesson,
    recordedLessonOrdinal,
    buildRecordedLessonOrdinals,
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

describe('isTerminalFriendLesson', () => {
    const chain = {
        lessons: [
            { lessonId: 'a', recapOverlay: 'shareCta' },
            { lessonId: 'b', recapOverlay: 'shareCta' },
            { lessonId: 'c', recapOverlay: 'shareCta' },
        ],
    };

    it('is true only for the last shareCta lesson', () => {
        expect(isTerminalFriendLesson(chain, 'a')).toBe(false);
        expect(isTerminalFriendLesson(chain, 'b')).toBe(false);
        expect(isTerminalFriendLesson(chain, 'c')).toBe(true);
    });

    it('ignores non-chain lessons that follow the last chain lesson', () => {
        const withTail = {
            lessons: [
                { lessonId: 'a', recapOverlay: 'shareCta' },
                { lessonId: 'z', recapOverlay: 'fluency' },
            ],
        };
        expect(isTerminalFriendLesson(withTail, 'a')).toBe(true);
    });

    it('is false for a non-shareCta lesson and for malformed input', () => {
        expect(isTerminalFriendLesson(chain, 'z')).toBe(false);
        expect(isTerminalFriendLesson(null, 'c')).toBe(false);
        expect(isTerminalFriendLesson({}, 'c')).toBe(false);
        expect(isTerminalFriendLesson(chain, null)).toBe(false);
        const noOverlay = { lessons: [{ lessonId: 'a' }] };
        expect(isTerminalFriendLesson(noOverlay, 'a')).toBe(false);
    });
});

describe('recordedLessonOrdinal', () => {
    const course = {
        lessons: [
            { lessonId: 'a', recapOverlay: 'shareCta' },
            { lessonId: 'b', recapOverlay: 'shareCta' },
            { lessonId: 'x', recapOverlay: 'fluency' },
            { lessonId: 'c', recapOverlay: 'shareCta' },
        ],
    };

    it('counts only the shareCta lessons, 1-based', () => {
        expect(recordedLessonOrdinal(course, 'a')).toEqual({ n: 1, total: 3 });
        expect(recordedLessonOrdinal(course, 'b')).toEqual({ n: 2, total: 3 });
        expect(recordedLessonOrdinal(course, 'c')).toEqual({ n: 3, total: 3 });
    });

    it('returns null for a non-chain lesson, an unknown id and malformed input', () => {
        expect(recordedLessonOrdinal(course, 'x')).toBeNull();
        expect(recordedLessonOrdinal(course, 'zz')).toBeNull();
        expect(recordedLessonOrdinal(null, 'a')).toBeNull();
        expect(recordedLessonOrdinal({}, 'a')).toBeNull();
        expect(recordedLessonOrdinal(course, null)).toBeNull();
    });
});

describe('buildRecordedLessonOrdinals', () => {
    it('keys the ordinal by course and RECORDED lesson', () => {
        const links = {
            'wouldyourather:a': {
                courseId: 'wouldyourather', recordedLessonId: 'a', lessonId: 'b', shareCode: 'c',
            },
        };
        const entries = [{
            courseId: 'wouldyourather',
            config: {
                lessons: [
                    { lessonId: 'a', recapOverlay: 'shareCta' },
                    { lessonId: 'b', recapOverlay: 'shareCta' },
                ],
            },
        }];
        expect(buildRecordedLessonOrdinals(links, entries)).toEqual({
            'wouldyourather:a': { n: 1, total: 2 },
        });
    });

    it('omits a link whose course has not loaded, so the stored title is used', () => {
        const links = { 'missing:a': { courseId: 'missing', recordedLessonId: 'a' } };
        expect(buildRecordedLessonOrdinals(links, [])).toEqual({});
        expect(buildRecordedLessonOrdinals(null, null)).toEqual({});
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

describe('buildVisitorPracticeView', () => {
    // The profile holds one link per RECORDED lesson (the ping-pong chain):
    // 'a' links to 'b', 'c' links to 'd'. Every one of them is listed.
    const entryA = {
        courseId: 'friendchain', courseName: 'Friend Chain', recordedLessonId: 'a',
        lessonId: 'b', shareCode: 'owner1', addedAt: iso(NOW - HOUR), lessonTitle: 'Ask',
    };
    const entryC = {
        courseId: 'friendchain', courseName: 'Friend Chain', recordedLessonId: 'c',
        lessonId: 'd', shareCode: 'owner1', addedAt: iso(NOW - 2 * HOUR), lessonTitle: 'Follow Up',
    };
    const mixedLinks = { 'friendchain:a': entryA, 'friendchain:c': entryC };
    // `friendCompletions` is what the API returns for THIS owner (RLS is
    // actor-only, and the query filters by owner_id), so the logic never has
    // to guess WHICH friend a lesson was done with.
    const emptyViewer = { shareCode: 'viewer1', friendCompletions: [], notifications: [], ownerShareCode: 'owner1' };
    const recordedLessons = (view) => view.groups.flatMap((g) => g.entries.map((e) => e.recordedLessonId));

    it('logged-out: lists EVERY recorded lesson, newest first, flagged not-together', () => {
        const view = buildVisitorPracticeView({ friendLinks: mixedLinks, nowMs: NOW, viewer: null });
        expect(view.mode).toBe('active');
        expect(view.isTicking).toBe(true);
        const entries = view.groups.flatMap((g) => g.entries);
        expect(entries.map((e) => e.recordedLessonId)).toEqual(['a', 'c']);
        expect(entries[0].completedTogether).toBe(false);
    });

    it('logged-out: a link for a lesson that is not the course\'s first is still listed', () => {
        // The regression: a learner who recorded the follow-up lesson ('b' or
        // 'c') had their link hidden, so the profile said "all your lessons have
        // expired" while a fresh link was in the database.
        const view = buildVisitorPracticeView({ friendLinks: { 'friendchain:c': entryC }, nowMs: NOW, viewer: null });
        expect(view.mode).toBe('active');
        expect(recordedLessons(view)).toEqual(['c']);
    });

    it('logged-in: an inbox row naming the owner features the owner recorded lesson first', () => {
        const viewer = {
            ...emptyViewer,
            notifications: [{ type: 'friend_response', course_id: 'friendchain', lesson_id: 'c', payload: { actorShareCode: 'owner1' } }],
        };
        const view = buildVisitorPracticeView({ friendLinks: mixedLinks, nowMs: NOW, viewer });
        // The featuring entry first, then the rest.
        expect(recordedLessons(view)).toEqual(['c', 'a']);
        const featuring = view.groups.flatMap((g) => g.entries).find((e) => e.recordedLessonId === 'c');
        expect(featuring.completedTogether).toBe(false);
    });

    it('logged-in: a completion of the link\'s target features the entry and badges it as completed together', () => {
        // The visitor opened the owner's `c` entry, so they completed `d`.
        const viewer = { ...emptyViewer, friendCompletions: [{ courseId: 'friendchain', lessonId: 'd' }] };
        const view = buildVisitorPracticeView({ friendLinks: mixedLinks, nowMs: NOW, viewer });
        expect(recordedLessons(view)).toEqual(['c', 'a']);
        const featuring = view.groups.flatMap((g) => g.entries).find((e) => e.recordedLessonId === 'c');
        expect(featuring.completedTogether).toBe(true);
    });

    it('regression: badges the owner\'s entry on ANOTHER profile when the visitor did its lesson', () => {
        // The reported bug: the badge keyed on the owner's recorded lesson, so
        // it only ever matched when the viewer looked at their OWN profile.
        // Here the owner recorded `a`; the visitor answered it by doing `b`.
        const viewer = { ...emptyViewer, friendCompletions: [{ courseId: 'friendchain', lessonId: 'b' }] };
        const view = buildVisitorPracticeView({ friendLinks: { 'friendchain:a': entryA }, nowMs: NOW, viewer });
        expect(recordedLessons(view)).toEqual(['a']);
        expect(view.groups[0].entries[0].completedTogether).toBe(true);
    });

    it('logged-in: joins on the link\'s target lesson, never the owner\'s recorded lesson', () => {
        // A completion of 'c' — the lesson the OWNER recorded — must not
        // feature or badge the entry; only completing the link's target ('d')
        // proves the visitor did the exchange.
        const viewer = { ...emptyViewer, friendCompletions: [{ courseId: 'friendchain', lessonId: 'c' }] };
        const view = buildVisitorPracticeView({ friendLinks: mixedLinks, nowMs: NOW, viewer });
        expect(recordedLessons(view)).toEqual(['a', 'c']);
        expect(view.groups.flatMap((g) => g.entries).every((e) => e.completedTogether === false)).toBe(true);
    });

    it('logged-in: an unrelated completion is never read as this owner\'s exchange', () => {
        // The pair-scoping itself happens in the API read: `friend_completions`
        // is filtered by BOTH actor_id and owner_id, so a lesson done with a
        // different friend never reaches this list. What must hold here is that
        // a completion that is not this entry's (course, lesson) pair is
        // ignored rather than fuzzy-matched — a lesson IS expected to be
        // repeated with different friends.
        const viewer = { ...emptyViewer, friendCompletions: [{ courseId: 'other-course', lessonId: 'b' }] };
        const view = buildVisitorPracticeView({ friendLinks: { 'friendchain:a': entryA }, nowMs: NOW, viewer });
        expect(recordedLessons(view)).toEqual(['a']);
        expect(view.groups[0].entries[0].completedTogether).toBe(false);
    });

    it('logged-in: an entry both featuring and already listed appears once, in the featuring group', () => {
        const viewer = { ...emptyViewer, friendCompletions: [{ courseId: 'friendchain', lessonId: 'b' }] };
        const view = buildVisitorPracticeView({
            friendLinks: { 'friendchain:a': entryA }, nowMs: NOW, viewer,
        });
        expect(recordedLessons(view)).toEqual(['a']);
        expect(view.groups.flatMap((g) => g.entries)).toHaveLength(1);
        expect(view.groups[0].entries[0].completedTogether).toBe(true);
    });

    it('logged-in with no featuring entries: the same list as the logged-out visitor', () => {
        const loggedIn = buildVisitorPracticeView({ friendLinks: mixedLinks, nowMs: NOW, viewer: emptyViewer });
        const loggedOut = buildVisitorPracticeView({ friendLinks: mixedLinks, nowMs: NOW, viewer: null });
        expect(recordedLessons(loggedIn)).toEqual(recordedLessons(loggedOut));
        const entries = loggedIn.groups.flatMap((g) => g.entries);
        expect(entries.every((e) => e.completedTogether === false)).toBe(true);
    });

    it('is expired with the unchanged shape for empty / expired input', () => {
        expect(buildVisitorPracticeView({ friendLinks: {}, nowMs: NOW, viewer: emptyViewer }))
            .toEqual({ mode: 'expired', groups: [], isTicking: false });
        expect(buildVisitorPracticeView({ friendLinks: null, nowMs: NOW, viewer: null }))
            .toEqual({ mode: 'expired', groups: [], isTicking: false });
        expect(buildVisitorPracticeView({
            friendLinks: { 'friendchain:a': { ...entryA, addedAt: iso(NOW - 48 * HOUR) } },
            nowMs: NOW, viewer: emptyViewer,
        })).toEqual({ mode: 'expired', groups: [], isTicking: false });
    });
});
