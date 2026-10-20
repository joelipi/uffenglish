// Unit tests for the topic pages' domain logic (the welcome page and a tag's
// course listing). Pure module: no React, no DOM.
import { describe, it, expect } from 'vitest';
import {
    WELCOME_PATH,
    TAG_PATH_PREFIX,
    normalizeTag,
    buildTagHref,
    configTags,
    startLessonIdFor,
    listTaggedCourses,
    collectCourseTags,
    listCoursesByTag,
    buildTagPageView,
} from './course-tags-logic.js';

// A config with a friend (shareCta) lesson, and one without — both are real
// courses a learner can start, so both belong on a tag page.
const FRIEND_CONFIG = {
    courseId: 'friendchain',
    courseName: 'Friend Challenge',
    tags: ['family', 'friends'],
    courseMission: { mission: { en: 'Talk about preferences.' } },
    lessons: [
        { lessonId: 'a', recapSources: 'none', recapOverlay: 'shareCta' },
        { lessonId: 'b', recapSources: 'friend', recapOverlay: 'shareCta' },
    ],
};

const PLAIN_CONFIG = {
    courseId: 'model',
    courseName: 'Grocery Shopping',
    tags: ['food'],
    lessons: [{ lessonId: 'm-t' }, { lessonId: 'm-g' }],
};

const ENTRIES = [
    { courseId: 'friendchain', config: FRIEND_CONFIG },
    { courseId: 'model', config: PLAIN_CONFIG },
];

describe('normalizeTag', () => {
    it('trims and lowercases', () => {
        expect(normalizeTag('  Travel ')).toBe('travel');
    });

    it('is empty for a non-string or a blank tag', () => {
        expect(normalizeTag(undefined)).toBe('');
        expect(normalizeTag(null)).toBe('');
        expect(normalizeTag(42)).toBe('');
        expect(normalizeTag('   ')).toBe('');
    });
});

describe('buildTagHref', () => {
    it('builds the in-app tag path from any casing', () => {
        expect(buildTagHref('Travel')).toBe('/tags/travel');
        expect(buildTagHref(' getting to know you ')).toBe('/tags/getting%20to%20know%20you');
    });

    it('falls back to the bare prefix when there is no tag', () => {
        expect(buildTagHref('')).toBe('/tags');
        expect(buildTagHref(undefined)).toBe('/tags');
    });

    it('owns the welcome path', () => {
        expect(WELCOME_PATH).toBe('/welcome');
        expect(TAG_PATH_PREFIX).toBe('/tags');
    });
});

describe('configTags', () => {
    it('returns the authored tags, trimmed', () => {
        expect(configTags({ tags: [' travel ', 'family'] })).toEqual(['travel', 'family']);
    });

    it('is empty when the config carries no tags', () => {
        expect(configTags({})).toEqual([]);
        expect(configTags(null)).toEqual([]);
        expect(configTags({ tags: 'travel' })).toEqual([]);
        expect(configTags({ tags: ['', '   ', 7] })).toEqual([]);
    });
});

describe('startLessonIdFor', () => {
    it('starts a friend course at its first shareCta lesson', () => {
        expect(startLessonIdFor(FRIEND_CONFIG)).toBe('a');
    });

    it('starts a course without a friend lesson at its first lesson', () => {
        expect(startLessonIdFor(PLAIN_CONFIG)).toBe('m-t');
    });

    it('is null when the course has no lesson at all', () => {
        expect(startLessonIdFor({ lessons: [] })).toBeNull();
        expect(startLessonIdFor({})).toBeNull();
        expect(startLessonIdFor(null)).toBeNull();
    });
});

describe('listTaggedCourses', () => {
    it('lists every course a learner can start, friend courses included', () => {
        const courses = listTaggedCourses(ENTRIES);
        expect(courses.map((c) => c.courseId)).toEqual(['friendchain', 'model']);
        expect(courses[0].firstLessonId).toBe('a');
        expect(courses[1].firstLessonId).toBe('m-t');
        expect(courses[1].lessonCount).toBe(2);
        expect(courses[1].courseName).toBe('Grocery Shopping');
        expect(courses[1].tags).toEqual(['food']);
    });

    it('never lists the reserved fixtures', () => {
        const courses = listTaggedCourses([
            ...ENTRIES,
            { courseId: 'test', config: { courseName: 'Fixture', tags: ['sports'], lessons: [{ lessonId: 'a' }] } },
            { courseId: 'wouldyourather-test', config: { courseName: 'Fixture', tags: ['sports'], lessons: [{ lessonId: 'a' }] } },
        ]);
        expect(courses.map((c) => c.courseId)).toEqual(['friendchain', 'model']);
    });

    it('carries the mission and hero metadata of the course', () => {
        const [friend] = listTaggedCourses(ENTRIES);
        expect(friend.mission).toEqual({ mission: { en: 'Talk about preferences.' } });
        expect(friend.heroImage).toBeNull();
    });

    it('falls back to the course id when the config has no name', () => {
        const courses = listTaggedCourses([{ courseId: 'x', config: { lessons: [{ lessonId: 'a' }] } }]);
        expect(courses[0].courseName).toBe('x');
    });

    it('is empty for a missing or malformed entry list', () => {
        expect(listTaggedCourses(undefined)).toEqual([]);
        expect(listTaggedCourses([{ courseId: '', config: {} }])).toEqual([]);
        expect(listTaggedCourses([{ courseId: 'x', config: { lessons: [] } }])).toEqual([]);
    });
});

describe('collectCourseTags', () => {
    it('lists every tag the courses carry, once each', () => {
        const tags = collectCourseTags(ENTRIES);
        expect(tags.map((t) => t.tag)).toEqual(['family', 'food', 'friends']);
        expect(tags.find((t) => t.tag === 'family').courseIds).toEqual(['friendchain']);
        expect(tags.find((t) => t.tag === 'friends').courseIds).toEqual(['friendchain']);
    });

    it('merges the same tag written with a different casing', () => {
        const tags = collectCourseTags([
            { courseId: 'a', config: { tags: ['Travel'], lessons: [{ lessonId: 'x' }] } },
            { courseId: 'b', config: { tags: ['travel'], lessons: [{ lessonId: 'x' }] } },
        ]);
        expect(tags).toHaveLength(1);
        expect(tags[0].courseIds).toEqual(['a', 'b']);
    });

    it('ignores the reserved fixtures, so no tag points at nothing', () => {
        const tags = collectCourseTags([
            { courseId: 'test', config: { tags: ['sports'], lessons: [{ lessonId: 'a' }] } },
        ]);
        expect(tags).toEqual([]);
    });

    it('is empty when no course carries a tag', () => {
        expect(collectCourseTags([{ courseId: 'a', config: { lessons: [{ lessonId: 'x' }] } }])).toEqual([]);
    });
});

describe('listCoursesByTag', () => {
    it('returns the courses that carry the tag', () => {
        expect(listCoursesByTag(ENTRIES, 'family').map((c) => c.courseId)).toEqual(['friendchain']);
    });

    it('matches case-insensitively', () => {
        expect(listCoursesByTag(ENTRIES, 'FAMILY').map((c) => c.courseId)).toEqual(['friendchain']);
    });

    it('is empty for an unknown or blank tag', () => {
        expect(listCoursesByTag(ENTRIES, 'sports')).toEqual([]);
        expect(listCoursesByTag(ENTRIES, '')).toEqual([]);
        expect(listCoursesByTag(ENTRIES, undefined)).toEqual([]);
    });
});

describe('buildTagPageView', () => {
    const courses = [{ courseId: 'a' }];

    it('reports loading, error and empty before the courses arrive', () => {
        expect(buildTagPageView({ tag: 'travel', isLoading: true })).toEqual({ state: 'loading', courses: [] });
        expect(buildTagPageView({ tag: 'travel', isError: true })).toEqual({ state: 'error', courses: [] });
        expect(buildTagPageView({ tag: 'travel', courses: [] })).toEqual({ state: 'empty', courses: [] });
    });

    it('is empty for a tag that is not there at all', () => {
        expect(buildTagPageView({ tag: '', courses })).toEqual({ state: 'empty', courses: [] });
    });

    it('reports ready with the courses', () => {
        expect(buildTagPageView({ tag: 'travel', courses })).toEqual({ state: 'ready', courses });
    });
});
