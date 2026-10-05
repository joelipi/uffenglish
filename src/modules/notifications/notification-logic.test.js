import { describe, it, expect } from 'vitest';
import {
    NOTIFICATION_TYPE_FRIEND_RESPONSE,
    normalizeShareCode,
    buildProfileHref,
    getUnreadCount,
    listNotifications,
    getNotificationActorName,
    getNotificationActorShareCode,
    formatNotificationDate,
    resolveFriendResponseNotification,
} from './notification-logic.js';

const ISO = '2026-09-24T11:00:00.000Z';

describe('normalizeShareCode', () => {
    it('trims and lowercases', () => {
        expect(normalizeShareCode(' Ab12 ')).toBe('ab12');
        expect(normalizeShareCode('AB12')).toBe('ab12');
    });

    it('returns null for empty/non-string', () => {
        expect(normalizeShareCode('')).toBeNull();
        expect(normalizeShareCode('   ')).toBeNull();
        expect(normalizeShareCode(null)).toBeNull();
        expect(normalizeShareCode(undefined)).toBeNull();
        expect(normalizeShareCode(42)).toBeNull();
    });
});

describe('buildProfileHref', () => {
    it('builds the https profile URL', () => {
        expect(buildProfileHref('sam123')).toBe('https://ultrafastfluency.com/sam123');
    });

    it('falls back to the bare host for an empty code', () => {
        expect(buildProfileHref('')).toBe('https://ultrafastfluency.com');
        expect(buildProfileHref(null)).toBe('https://ultrafastfluency.com');
    });

    it('does not double the scheme', () => {
        expect(buildProfileHref('https://x/y')).toBe('https://x/y');
    });
});

describe('getUnreadCount', () => {
    it('counts rows with no read_at', () => {
        expect(getUnreadCount([
            { read_at: null },
            { read_at: '2026-01-01T00:00:00Z' },
            { read_at: null },
        ])).toBe(2);
    });

    it('returns 0 for non-arrays', () => {
        expect(getUnreadCount([])).toBe(0);
        expect(getUnreadCount(null)).toBe(0);
        expect(getUnreadCount(undefined)).toBe(0);
        expect(getUnreadCount('x')).toBe(0);
    });
});

describe('listNotifications', () => {
    it('sorts newest first', () => {
        const older = { id: 'a', created_at: '2026-09-20T00:00:00Z' };
        const newer = { id: 'b', created_at: '2026-09-24T00:00:00Z' };
        expect(listNotifications([older, newer]).map((n) => n.id)).toEqual(['b', 'a']);
    });

    it('returns [] for junk', () => {
        expect(listNotifications(null)).toEqual([]);
        expect(listNotifications(undefined)).toEqual([]);
        expect(listNotifications('x')).toEqual([]);
        expect(listNotifications([null, 0, {}])).toEqual([]);
    });

    it('does not mutate the input array order', () => {
        const older = { id: 'a', created_at: '2026-09-20T00:00:00Z' };
        const newer = { id: 'b', created_at: '2026-09-24T00:00:00Z' };
        const input = [older, newer];
        listNotifications(input);
        expect(input.map((n) => n.id)).toEqual(['a', 'b']);
    });
});

describe('actor name / share code accessors', () => {
    it('reads and trims the actor name', () => {
        expect(getNotificationActorName({ payload: { actorName: ' Sam ' } })).toBe('Sam');
    });

    it('returns empty string when the actor name is absent/invalid', () => {
        expect(getNotificationActorName({ payload: {} })).toBe('');
        expect(getNotificationActorName({})).toBe('');
        expect(getNotificationActorName(null)).toBe('');
        expect(getNotificationActorName({ payload: { actorName: 42 } })).toBe('');
    });

    it('reads and normalizes the actor share code', () => {
        expect(getNotificationActorShareCode({ payload: { actorShareCode: 'SAM123' } })).toBe('sam123');
    });

    it('returns null when the actor share code is absent', () => {
        expect(getNotificationActorShareCode({ payload: {} })).toBeNull();
        expect(getNotificationActorShareCode({})).toBeNull();
        expect(getNotificationActorShareCode(null)).toBeNull();
    });
});

describe('formatNotificationDate', () => {
    it('formats a valid date with the year', () => {
        const out = formatNotificationDate(ISO, 'en');
        expect(out).not.toBe('');
        expect(out).toContain('2026');
    });

    it('normalizes language case and full locales', () => {
        expect(formatNotificationDate(ISO, 'EN')).toBe(formatNotificationDate(ISO, 'en'));
        expect(formatNotificationDate(ISO, 'en-US')).toBe(formatNotificationDate(ISO, 'en'));
    });

    it('does not throw for the localized languages', () => {
        for (const lang of ['es', 'fr', 'hi', 'bn']) {
            expect(formatNotificationDate(ISO, lang)).not.toBe('');
        }
    });

    it('falls back to English for a code absent from LOCALE_MAP', () => {
        const out = formatNotificationDate(ISO, 'XX');
        expect(out).not.toBe('');
        expect(out).toContain('2026');
    });

    it('returns "" for invalid/missing dates', () => {
        expect(formatNotificationDate(null, 'en')).toBe('');
        expect(formatNotificationDate('', 'en')).toBe('');
        expect(formatNotificationDate('not-a-date', 'en')).toBe('');
        expect(formatNotificationDate(undefined, 'en')).toBe('');
    });
});

describe('resolveFriendResponseNotification', () => {
    const chain = {
        lessons: [
            { lessonId: 'a', recapOverlay: 'shareCta' },
            { lessonId: 'b', recapOverlay: 'shareCta' },
            { lessonId: 'c', recapOverlay: 'shareCta' },
        ],
    };
    const base = {
        configData: chain,
        lessonId: 'c',
        courseId: 'friendchain',
        recipientShareCode: 'A1',
        actorShareCode: 'B2',
        succeeded: 3,
    };

    it('returns the normalized RPC payload for a chain lesson with an earlier shareCta lesson', () => {
        expect(resolveFriendResponseNotification(base)).toEqual({
            recipientShareCode: 'a1',
            courseId: 'friendchain',
            lessonId: 'c',
        });
    });

    it('fires for any answer-side chain lesson, not just the second', () => {
        expect(resolveFriendResponseNotification({ ...base, lessonId: 'b' })).toEqual({
            recipientShareCode: 'a1',
            courseId: 'friendchain',
            lessonId: 'b',
        });
    });

    it('rejects the first chain lesson (no earlier shareCta)', () => {
        expect(resolveFriendResponseNotification({ ...base, lessonId: 'a' })).toBeNull();
    });

    it('rejects a non-shareCta lesson that merely follows a shareCta lesson', () => {
        const config = {
            lessons: [
                { lessonId: 'a', recapOverlay: 'shareCta' },
                { lessonId: 'x', recapOverlay: 'videoOnly' },
            ],
        };
        expect(resolveFriendResponseNotification({
            ...base, configData: config, lessonId: 'x',
        })).toBeNull();
    });

    it('rejects a lesson with no earlier shareCta lesson', () => {
        const noEarlier = {
            lessons: [
                { lessonId: 'x', recapOverlay: 'videoOnly' },
                { lessonId: 'a', recapOverlay: 'shareCta' },
            ],
        };
        expect(resolveFriendResponseNotification({
            ...base, configData: noEarlier, lessonId: 'a',
        })).toBeNull();
    });

    it('requires a real export', () => {
        expect(resolveFriendResponseNotification({ ...base, succeeded: 0 })).toBeNull();
    });

    it('requires a recipient share code', () => {
        expect(resolveFriendResponseNotification({ ...base, recipientShareCode: '' })).toBeNull();
        expect(resolveFriendResponseNotification({ ...base, recipientShareCode: undefined })).toBeNull();
    });

    it('rejects self-notification case-insensitively', () => {
        expect(resolveFriendResponseNotification({
            ...base,
            recipientShareCode: 'B2',
            actorShareCode: 'b2',
        })).toBeNull();
    });

    it('requires a course id', () => {
        expect(resolveFriendResponseNotification({ ...base, courseId: '' })).toBeNull();
        expect(resolveFriendResponseNotification({ ...base, courseId: undefined })).toBeNull();
    });

    it('requires the course config to contain the lesson', () => {
        expect(resolveFriendResponseNotification({
            ...base,
            lessonId: 'zz',
        })).toBeNull();
    });

    it('handles a missing config', () => {
        expect(resolveFriendResponseNotification({ ...base, configData: null })).toBeNull();
        expect(resolveFriendResponseNotification({ ...base, configData: undefined })).toBeNull();
    });

    it('normalizes the recipient in the returned payload', () => {
        expect(resolveFriendResponseNotification({ ...base, recipientShareCode: ' A1 ' }).recipientShareCode).toBe('a1');
    });

    it('exposes the friend_response type constant', () => {
        expect(NOTIFICATION_TYPE_FRIEND_RESPONSE).toBe('friend_response');
    });
});
