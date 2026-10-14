// Story Friends-page: pure unit tests for the Friends directory model. Every
// acceptance predicate lives in friends-logic.js (no React/store), so the
// directory, the badge, and the ordering are pinned here.
import { describe, it, expect } from 'vitest';
import {
    getFriendUserIds,
    getFriendDisplayName,
    getFriendShareCode,
    friendHasJointLessons,
    buildFriendsList,
} from './friends-logic.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

function activeLinks(code = 'aaa111') {
    return {
        'friendchain:a': {
            courseId: 'friendchain', courseName: 'Friend Chain',
            recordedLessonId: 'a', lessonId: 'b', shareCode: code,
            addedAt: iso(NOW - HOUR), lessonTitle: 'Ask',
        },
    };
}

function expiredLinks(code = 'aaa111') {
    return {
        'friendchain:a': {
            courseId: 'friendchain', courseName: 'Friend Chain',
            recordedLessonId: 'a', lessonId: 'b', shareCode: code,
            addedAt: iso(NOW - 49 * HOUR), lessonTitle: 'Ask',
        },
    };
}

describe('getFriendUserIds', () => {
    it('unions friends and friend_owners with friends first', () => {
        expect(getFriendUserIds({ $id: 'me', friends: ['a', 'b'], friend_owners: ['c'] }))
            .toEqual(['a', 'b', 'c']);
    });

    it('dedupes across both arrays and drops blanks and the self id', () => {
        expect(getFriendUserIds({ $id: 'me', friends: ['a', 'me', '', 'a'], friend_owners: ['a', 'b', null] }))
            .toEqual(['a', 'b']);
    });

    it('treats missing or malformed arrays as empty, never throws', () => {
        expect(getFriendUserIds(null)).toEqual([]);
        expect(getFriendUserIds({})).toEqual([]);
        expect(getFriendUserIds({ friends: 'a', friend_owners: {} })).toEqual([]);
    });
});

describe('getFriendDisplayName', () => {
    it('prefers display_name, else joins first and last name', () => {
        expect(getFriendDisplayName({ display_name: 'Sam S' })).toBe('Sam S');
        expect(getFriendDisplayName({ firstName: 'Sam', lastName: 'S' })).toBe('Sam S');
        expect(getFriendDisplayName({ first_name: 'Sam', last_name: '' })).toBe('Sam');
    });

    it('returns empty string for missing names or rows', () => {
        expect(getFriendDisplayName({})).toBe('');
        expect(getFriendDisplayName(null)).toBe('');
    });
});

describe('getFriendShareCode', () => {
    it('reads either column casing', () => {
        expect(getFriendShareCode({ share_code: 'aaa111' })).toBe('aaa111');
        expect(getFriendShareCode({ shareCode: 'bbb222' })).toBe('bbb222');
    });

    it('returns null when no usable code exists', () => {
        expect(getFriendShareCode({})).toBeNull();
        expect(getFriendShareCode({ share_code: '' })).toBeNull();
        expect(getFriendShareCode(null)).toBeNull();
    });
});

describe('friendHasJointLessons', () => {
    it('is true when the friend has an active link (reuses the 48h gate)', () => {
        expect(friendHasJointLessons(activeLinks(), NOW)).toBe(true);
    });

    it('is false when every link is expired, empty, or missing', () => {
        expect(friendHasJointLessons(expiredLinks(), NOW)).toBe(false);
        expect(friendHasJointLessons({}, NOW)).toBe(false);
        expect(friendHasJointLessons(null, NOW)).toBe(false);
    });
});

describe('buildFriendsList', () => {
    it('returns directory rows in friend order with profile links and the badge flag', () => {
        const rows = buildFriendsList({
            profile: { $id: 'me', friends: ['u1', 'u2'], friend_owners: [] },
            friendProfiles: [
                { id: 'u1', share_code: 'aaa111', display_name: 'Ann A', profile_picture_url: 'pic1', friend_links: activeLinks('aaa111') },
                { id: 'u2', share_code: 'bbb222', first_name: 'Bo', last_name: 'B', profile_picture_url: null, friend_links: expiredLinks('bbb222') },
            ],
            nowMs: NOW,
        });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ id: 'u1', shareCode: 'aaa111', displayName: 'Ann A', hasJointLessons: true });
        expect(rows[1]).toMatchObject({ id: 'u2', shareCode: 'bbb222', displayName: 'Bo B', hasJointLessons: false });
    });

    it('skips friends whose profile failed to load or has no share code', () => {
        const rows = buildFriendsList({
            profile: { $id: 'me', friends: ['u1', 'missing', 'nocode'], friend_owners: [] },
            friendProfiles: [
                { id: 'u1', share_code: 'aaa111', display_name: 'Ann' },
                { id: 'nocode', display_name: 'No Code' },
            ],
            nowMs: NOW,
        });
        expect(rows.map((r) => r.id)).toEqual(['u1']);
    });

    it('includes friend_owners ids and returns [] with no friends', () => {
        const rows = buildFriendsList({
            profile: { $id: 'me', friends: [], friend_owners: ['owner1'] },
            friendProfiles: [{ id: 'owner1', share_code: 'ccc333', display_name: 'Cam' }],
            nowMs: NOW,
        });
        expect(rows).toHaveLength(1);
        expect(buildFriendsList({ profile: { $id: 'me', friends: [], friend_owners: [] }, friendProfiles: [], nowMs: NOW }))
            .toEqual([]);
    });
});
