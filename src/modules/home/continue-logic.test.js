// continue-logic.test.js
// Unit tests for the /home Continue-target resolver (story 061). Pure
// function tests with a fixed clock and injected randomness — no store,
// no network, no timers.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    EXCLUDED_CONTINUE_COURSE_IDS,
    parseCourseProgress,
    startedCourseBasenames,
    findConfigEntry,
    isFriendCourseId,
    friendCourseEntries,
    collectFriendActorCodes,
    buildFriendLinksMaps,
    oldestActiveFriendEntry,
    pickRandomId,
    mostRecentStartedNonFriend,
    buildFriendContinuePath,
    resolveContinueTarget,
} from './continue-logic.js';

const NOW = Date.parse('2026-09-24T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 60 * 60 * 1000).toISOString();

function friendConfig(lessons = ['a', 'b', 'c']) {
    return { lessons: lessons.map((lessonId) => ({ lessonId, recapOverlay: 'shareCta' })) };
}

function plainConfig(lessons = ['m-g', 'm-t']) {
    return { lessons: lessons.map((lessonId) => ({ lessonId })) };
}

// `friend.json` carries a non-file inner courseId on disk; entries are
// keyed by file basename, so the fixture mirrors that shape.
const ENTRIES = [
    { courseId: 'friend', config: { ...friendConfig(['a', 'b']), courseId: '20260921' } },
    { courseId: 'wouldrather', config: friendConfig(['a', 'b', 'c', 'd', 'e', 'f']) },
    { courseId: 'model', config: plainConfig(['m-g', 'm-t']) },
    { courseId: 'gt2', config: plainConfig(['g-a']) },
    { courseId: 'test', config: friendConfig(['a', 'b']) },
    { courseId: 'test-api', config: plainConfig(['ta-t']) },
];

function linkEntry(overrides = {}) {
    return {
        courseId: 'wouldrather',
        courseName: 'Would You Rather',
        recordedLessonId: 'b',
        lessonId: 'c',
        shareCode: 'ab12',
        lessonTitle: 'Ask',
        addedAt: hoursAgo(5),
        ...overrides,
    };
}

const baseArgs = {
    configEntries: ENTRIES,
    courseProgressText: null,
    countedLessons: [],
    friendLinksMaps: [],
    nowMs: NOW,
    rand: () => 0,
};

describe('parseCourseProgress', () => {
    it('parses the progress map and fails open on corrupt input', () => {
        expect(parseCourseProgress('{"model":{"current_lesson":"m-g"}}')).toEqual({ model: { current_lesson: 'm-g' } });
        expect(parseCourseProgress('{oops')).toEqual({});
        expect(parseCourseProgress(null)).toEqual({});
        expect(parseCourseProgress('')).toEqual({});
        expect(parseCourseProgress('[1,2]')).toEqual({});
    });
});

describe('startedCourseBasenames', () => {
    it('unions progress keys and counted_lessons prefixes', () => {
        const started = startedCourseBasenames({
            courseProgressText: '{"model":{"current_lesson":"m-g"}}',
            countedLessons: ['wouldrather_a', 'friend_b'],
        });
        expect([...started].sort()).toEqual(['friend', 'model', 'wouldrather']);
    });

    it('ignores non-string counted entries', () => {
        expect([...startedCourseBasenames({ countedLessons: [null, 42, 'model_m-g'] })]).toEqual(['model']);
    });
});

describe('isFriendCourseId', () => {
    it('classifies friend, non-friend, and unknown', () => {
        expect(isFriendCourseId('wouldrather', ENTRIES)).toBe(true);
        expect(isFriendCourseId('model', ENTRIES)).toBe(false);
        expect(isFriendCourseId('model', null)).toBeNull();
        expect(isFriendCourseId('nope', ENTRIES)).toBeNull();
        expect(isFriendCourseId('test', ENTRIES)).toBeNull();
        expect(isFriendCourseId('test-api', ENTRIES)).toBeNull();
        expect(isFriendCourseId(null, ENTRIES)).toBeNull();
    });

    it('matches the file basename, never the inner courseId', () => {
        expect(findConfigEntry(ENTRIES, 'friend')?.courseId).toBe('friend');
        expect(findConfigEntry(ENTRIES, '20260921')).toBeNull();
        expect(isFriendCourseId('friend', ENTRIES)).toBe(true);
    });
});

describe('friendCourseEntries', () => {
    it('returns real friend courses, never fixtures', () => {
        expect(friendCourseEntries(ENTRIES).map((e) => e.courseId).sort())
            .toEqual(['friend', 'wouldrather']);
        expect(EXCLUDED_CONTINUE_COURSE_IDS).toEqual(expect.arrayContaining(['test', 'test-api']));
    });
});

describe('collectFriendActorCodes', () => {
    const note = (code, name = 'A') => ({
        id: `n-${code}`, type: 'friend_response', payload: { actorShareCode: code, actorName: name },
    });

    it('dedupes, normalizes, and skips blanks and self', () => {
        expect(collectFriendActorCodes(
            [note('AB12'), note('ab12', 'A2'), note('  '), note(null), note('cd34'), null],
            'zz99',
        )).toEqual(['ab12', 'cd34']);
        expect(collectFriendActorCodes([note('ZZ99')], 'zz99')).toEqual([]);
        expect(collectFriendActorCodes(null, 'zz99')).toEqual([]);
    });

    it('ignores non-friend_response notification types', () => {
        const other = { id: 'n-x', type: 'other_type', payload: { actorShareCode: 'ab12', actorName: 'A' } };
        const typeless = { id: 'n-y', payload: { actorShareCode: 'cd34', actorName: 'C' } };
        expect(collectFriendActorCodes([other, typeless, note('ef56')], 'zz99')).toEqual(['ef56']);
    });
});

describe('buildFriendLinksMaps', () => {
    it('pairs rows to codes and drops failures and unusable maps', () => {
        expect(buildFriendLinksMaps(
            ['ab12', 'cd34', 'ef56'],
            [{ friendLinks: { 'w:b': linkEntry() } }, null, { friendLinks: [1, 2] }],
        )).toEqual([{ shareCode: 'ab12', friendLinks: { 'w:b': linkEntry() } }]);
        expect(buildFriendLinksMaps(null, [])).toEqual([]);
    });

    it('accepts the snake_case alias', () => {
        const maps = buildFriendLinksMaps(['ab12'], [{ friend_links: {} }]);
        expect(maps).toHaveLength(1);
    });
});

describe('oldestActiveFriendEntry', () => {
    it('picks the oldest active entry across friends', () => {
        const best = oldestActiveFriendEntry([
            { shareCode: 'ab12', friendLinks: { a: linkEntry({ addedAt: hoursAgo(2), lessonId: 'c' }) } },
            { shareCode: 'cd34', friendLinks: { b: linkEntry({ addedAt: hoursAgo(20), lessonId: 'd', shareCode: 'cd34' }) } },
        ], NOW);
        expect(best?.lessonId).toBe('d');
        expect(best?.shareCode).toBe('cd34');
    });

    it('ignores expired and malformed entries', () => {
        expect(oldestActiveFriendEntry([
            { shareCode: 'ab12', friendLinks: { a: linkEntry({ addedAt: hoursAgo(49) }) } },
            { shareCode: 'cd34', friendLinks: { b: linkEntry({ lessonId: '', shareCode: '' }) } },
        ], NOW)).toBeNull();
        expect(oldestActiveFriendEntry(null, NOW)).toBeNull();
    });

    it('honors the 48h boundary to the minute', () => {
        const justInside = linkEntry({ addedAt: new Date(NOW - (48 * 60 * 60 * 1000 - 60 * 1000)).toISOString() });
        const justOutside = linkEntry({ addedAt: new Date(NOW - (48 * 60 * 60 * 1000 + 60 * 1000)).toISOString() });
        expect(oldestActiveFriendEntry([{ shareCode: 'ab12', friendLinks: { a: justInside } }], NOW))
            ?.toBe(justInside);
        expect(oldestActiveFriendEntry([{ shareCode: 'ab12', friendLinks: { a: justOutside } }], NOW))
            .toBeNull();
    });
});

describe('pickRandomId', () => {
    it('is deterministic for an injected rand', () => {
        expect(pickRandomId(['a', 'b', 'c'], () => 0)).toBe('a');
        expect(pickRandomId(['a', 'b', 'c'], () => 0.999)).toBe('c');
        expect(pickRandomId([], () => 0)).toBeNull();
    });
});

describe('mostRecentStartedNonFriend', () => {
    it('orders by progress timestamp, missing timestamps last', () => {
        const progress = JSON.stringify({
            gt2: { current_lesson: 'g-a', lesson_timestamp: hoursAgo(1) },
            model: { current_lesson: 'm-g', lesson_timestamp: hoursAgo(50) },
        });
        expect(mostRecentStartedNonFriend({
            courseProgressText: progress, countedLessons: [], configEntries: ENTRIES,
        })).toBe('gt2');
    });

    it('falls back to counted_lessons without timestamps, basename tie-break', () => {
        expect(mostRecentStartedNonFriend({
            courseProgressText: null, countedLessons: ['model_m-g', 'gt2_g-a'], configEntries: ENTRIES,
        })).toBe('gt2');
    });

    it('returns null when only friend courses started', () => {
        expect(mostRecentStartedNonFriend({
            courseProgressText: null, countedLessons: ['wouldrather_a'], configEntries: ENTRIES,
        })).toBeNull();
    });
});

describe('buildFriendContinuePath', () => {
    it('builds the in-app path with an encoded share code', () => {
        expect(buildFriendContinuePath({ courseId: 'wouldrather', lessonId: 'c', shareCode: 'ab12' }))
            .toBe('/course/wouldrather/lesson/c?shareCode=ab12');
        expect(buildFriendContinuePath({ courseId: 'wouldrather', lessonId: '', shareCode: 'ab12' })).toBeNull();
    });
});

describe('resolveContinueTarget', () => {
    it('keeps the exact solo link for a non-friend resume, ignoring friend data', () => {
        expect(resolveContinueTarget({
            ...baseArgs, courseId: 'model', activeLessonId: 'm-g',
            friendLinksMaps: [{ shareCode: 'ab12', friendLinks: { a: linkEntry() } }],
        })).toBe('/course/model/lesson/m-g');
    });

    it('returns null for a non-friend resume missing either id (legacy gate)', () => {
        expect(resolveContinueTarget({ ...baseArgs, courseId: 'model', activeLessonId: null })).toBeNull();
        expect(resolveContinueTarget({ ...baseArgs, courseId: null, activeLessonId: 'm-g' })).toBeNull();
    });

    it('links the oldest active friend entry with its own lesson and code', () => {
        expect(resolveContinueTarget({
            ...baseArgs,
            courseId: 'wouldrather',
            activeLessonId: 'b',
            friendLinksMaps: [
                { shareCode: 'zz99', friendLinks: {} },
                { shareCode: 'ab12', friendLinks: { a: linkEntry({ addedAt: hoursAgo(2), lessonId: 'c', shareCode: 'ab12' }) } },
                { shareCode: 'cd34', friendLinks: { b: linkEntry({ addedAt: hoursAgo(20), lessonId: 'd', shareCode: 'cd34', courseId: 'friend' }) } },
            ],
        })).toBe('/course/friend/lesson/d?shareCode=cd34');
    });

    it('falls through expired entries to a random unstarted friend course', () => {
        expect(resolveContinueTarget({
            ...baseArgs,
            courseId: 'wouldrather',
            activeLessonId: 'b',
            countedLessons: ['wouldrather_a'],
            friendLinksMaps: [{ shareCode: 'ab12', friendLinks: { a: linkEntry({ addedAt: hoursAgo(49) }) } }],
        })).toBe('/course/friend/lesson/a');
    });

    it('picks the deterministic random unstarted friend course', () => {
        const entries = [
            { courseId: 'friendchain', config: friendConfig(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) },
            { courseId: 'wouldrather', config: friendConfig(['a', 'b', 'c', 'd', 'e', 'f']) },
        ];
        expect(resolveContinueTarget({
            ...baseArgs, configEntries: entries, courseId: 'wouldrather', activeLessonId: 'b',
        })).toBe('/course/friendchain/lesson/a');
    });

    it('resumes the most-recent started non-friend course when friends are exhausted', () => {
        expect(resolveContinueTarget({
            ...baseArgs,
            courseId: 'wouldrather',
            activeLessonId: 'b',
            countedLessons: ['friend_a', 'wouldrather_a', 'wouldrather_b'],
            courseProgressText: JSON.stringify({ model: { current_lesson: 'm-g', lesson_timestamp: hoursAgo(3) } }),
        })).toBe('/course/model/lesson/m-g');
    });

    it('falls back to the first config lesson when progress has no current lesson', () => {
        expect(resolveContinueTarget({
            ...baseArgs,
            courseId: 'wouldrather',
            activeLessonId: 'b',
            countedLessons: ['friend_a', 'wouldrather_a'],
            courseProgressText: JSON.stringify({ model: {} }),
        })).toBe('/course/model/lesson/m-g');
    });

    it('returns null when friends are exhausted and no non-friend course started', () => {
        expect(resolveContinueTarget({
            ...baseArgs,
            courseId: 'wouldrather',
            activeLessonId: 'b',
            countedLessons: ['friend_a', 'wouldrather_a'],
        })).toBeNull();
    });

    it('falls back when the active entry names a fixture, unknown, or non-friend course', () => {
        for (const courseId of ['test', 'nope', 'model']) {
            expect(resolveContinueTarget({
                ...baseArgs,
                courseId: 'wouldrather',
                activeLessonId: 'b',
                countedLessons: ['wouldrather_a'],
                friendLinksMaps: [{
                    shareCode: 'ab12',
                    friendLinks: { a: linkEntry({ courseId, lessonId: 'b', shareCode: 'ab12' }) },
                }],
            })).toBe('/course/friend/lesson/a');
        }
    });

    it('never recommends fixtures', () => {
        const target = resolveContinueTarget({
            ...baseArgs, courseId: 'friend', activeLessonId: 'b', rand: () => 0.999,
        });
        expect(target).not.toContain('test');
        expect(target).not.toContain('test-api');
    });

    it('never emits the inner fixture courseId', () => {
        const target = resolveContinueTarget({ ...baseArgs, courseId: 'friend', activeLessonId: 'b' });
        expect(target).not.toContain('20260921');
    });

    it('returns null while entries load or the course is unknown', () => {
        expect(resolveContinueTarget({ ...baseArgs, courseId: 'model', activeLessonId: 'm-g', configEntries: null }))
            .toBeNull();
        expect(resolveContinueTarget({ ...baseArgs, courseId: 'nope', activeLessonId: 'x' })).toBeNull();
    });

    it('is pure: identical inputs give identical output and it never throws', () => {
        const args = {
            ...baseArgs,
            courseId: 'wouldrather',
            activeLessonId: 'b',
            courseProgressText: '{oops',
            friendLinksMaps: [{ shareCode: 'ab12', friendLinks: null }, null],
        };
        expect(() => resolveContinueTarget(args)).not.toThrow();
        expect(resolveContinueTarget(args)).toEqual(resolveContinueTarget({ ...args }));
    });
});

describe('continue-logic source hygiene', () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(__dirname, 'continue-logic.js'), 'utf8');

    it('imports no React, touches no DOM, and reads no backend', () => {
        expect(src).not.toContain("from 'react'");
        expect(src).not.toContain('require(\'react\')');
        expect(src).not.toContain('window');
        expect(src).not.toContain('document');
        expect(src).not.toContain('supabase');
    });
});
