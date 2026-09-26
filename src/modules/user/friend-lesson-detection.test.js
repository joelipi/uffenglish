import { describe, it, expect } from 'vitest';
import {
    FRIEND_LESSON_IDS,
    getShareCodeFromSearch,
    getLessonIdFromPathname,
    isFriendLesson,
} from './friend-lesson-detection.js';

describe('FRIEND_LESSON_IDS', () => {
    it('pins the ask/answer lesson ids', () => {
        expect(FRIEND_LESSON_IDS).toEqual(['a', 'b']);
    });
});

describe('getShareCodeFromSearch', () => {
    it('reads the shareCode param regardless of case', () => {
        expect(getShareCodeFromSearch('?shareCode=Ab12')).toBe('ab12');
        expect(getShareCodeFromSearch('?SHARECODE=Ab12')).toBe('ab12');
        expect(getShareCodeFromSearch('shareCode=Ab12')).toBe('ab12');
    });

    it('returns null for empty / unrelated / missing search strings', () => {
        expect(getShareCodeFromSearch('?shareCode=')).toBeNull();
        expect(getShareCodeFromSearch('?other=1')).toBeNull();
        expect(getShareCodeFromSearch('')).toBeNull();
        expect(getShareCodeFromSearch(null)).toBeNull();
        expect(getShareCodeFromSearch(undefined)).toBeNull();
    });
});

describe('getLessonIdFromPathname', () => {
    it('extracts the lesson id from a course lesson path (trailing slash ok)', () => {
        expect(getLessonIdFromPathname('/course/friend/lesson/b')).toBe('b');
        expect(getLessonIdFromPathname('/course/friend/lesson/b/')).toBe('b');
        expect(getLessonIdFromPathname('/course/model/lesson/wa')).toBe('wa');
    });

    it('returns null for non-lesson paths', () => {
        expect(getLessonIdFromPathname('/')).toBeNull();
        expect(getLessonIdFromPathname('/profile')).toBeNull();
        expect(getLessonIdFromPathname('/course/model/lesson')).toBeNull();
        expect(getLessonIdFromPathname('/course/model/lesson/g/extra')).toBeNull();
        expect(getLessonIdFromPathname(null)).toBeNull();
    });
});

describe('isFriendLesson', () => {
    it('is true for friend-challenge lesson ids in any course', () => {
        expect(isFriendLesson({ pathname: '/course/friend/lesson/b' })).toBe(true);
        expect(isFriendLesson({ pathname: '/course/model/lesson/a' })).toBe(true);
        expect(isFriendLesson({ pathname: '/course/gt2/lesson/a' })).toBe(true);
    });

    it('is true when a shareCode is present, regardless of lesson id', () => {
        expect(isFriendLesson({ search: '?shareCode=x', pathname: '/course/model/lesson/wa' })).toBe(true);
        expect(isFriendLesson({ search: '?SHARECODE=x', pathname: '/course/gt2/lesson/2-0' })).toBe(true);
    });

    it('is false for ordinary lessons and missing input', () => {
        expect(isFriendLesson({ pathname: '/course/model/lesson/g' })).toBe(false);
        expect(isFriendLesson({ pathname: '/course/model/lesson/wa' })).toBe(false);
        expect(isFriendLesson({ pathname: '/' })).toBe(false);
        expect(isFriendLesson({})).toBe(false);
        expect(isFriendLesson()).toBe(false);
    });
});
