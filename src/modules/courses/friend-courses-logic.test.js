import { describe, it, expect } from 'vitest';
import {
    EXCLUDED_FRIEND_COURSE_IDS,
    COURSE_LISTINGS_PATH,
    COURSE_MISSION_FALLBACK_KEYS,
    isFriendLesson,
    isFriendCourse,
    firstFriendLessonId,
    courseMissionFor,
    courseHeroImageFor,
    buildCourseStartHref,
    listFriendCourses,
    buildCourseListView,
} from './friend-courses-logic.js';
import friend from '../../config/friend.json';
import friendchain from '../../config/friendchain.json';
import wouldrather from '../../config/wouldrather.json';
import wouldyourather from '../../config/wouldyourather.json';
import model from '../../config/model.json';
import t from '../../config/t.json';
import gt2 from '../../config/gt2.json';
import testApi from '../../config/test-api.json';
import testConfig from '../../config/test.json';

const REAL_ENTRIES = [
    { courseId: 'friend', config: friend },
    { courseId: 'friendchain', config: friendchain },
    { courseId: 'wouldrather', config: wouldrather },
    { courseId: 'wouldyourather', config: wouldyourather },
    { courseId: 'model', config: model },
    { courseId: 't', config: t },
    { courseId: 'gt2', config: gt2 },
    { courseId: 'test-api', config: testApi },
    { courseId: 'test', config: testConfig },
];

describe('isFriendLesson', () => {
    it('is true only for shareCta lessons', () => {
        expect(isFriendLesson({ recapOverlay: 'shareCta' })).toBe(true);
    });

    it('is false for other or missing recapOverlay', () => {
        expect(isFriendLesson({ recapOverlay: 'fluency' })).toBe(false);
        expect(isFriendLesson({})).toBe(false);
        expect(isFriendLesson(null)).toBe(false);
        expect(isFriendLesson(undefined)).toBe(false);
    });
});

describe('isFriendCourse', () => {
    it('is true when at least one lesson is shareCta', () => {
        expect(isFriendCourse({ lessons: [{ recapOverlay: 'fluency' }, { recapOverlay: 'shareCta' }] })).toBe(true);
    });

    it('is false with no shareCta lesson, no lessons array, or null', () => {
        expect(isFriendCourse({ lessons: [{ recapOverlay: 'fluency' }] })).toBe(false);
        expect(isFriendCourse({ lessons: [] })).toBe(false);
        expect(isFriendCourse({})).toBe(false);
        expect(isFriendCourse(null)).toBe(false);
    });
});

describe('firstFriendLessonId', () => {
    it('returns the first shareCta lesson id, even when it is not the first lesson', () => {
        const config = {
            lessons: [
                { lessonId: 'intro' },
                { lessonId: 'a', recapOverlay: 'shareCta' },
                { lessonId: 'b', recapOverlay: 'shareCta' },
            ],
        };
        expect(firstFriendLessonId(config)).toBe('a');
    });

    it('returns null with no shareCta lesson or a blank lessonId', () => {
        expect(firstFriendLessonId({ lessons: [{ lessonId: 'x' }] })).toBeNull();
        expect(firstFriendLessonId({ lessons: [{ recapOverlay: 'shareCta', lessonId: '' }] })).toBeNull();
        expect(firstFriendLessonId(null)).toBeNull();
    });
});

describe('buildCourseStartHref', () => {
    it('builds the lesson route from the course id and lesson id', () => {
        expect(buildCourseStartHref('wouldrather', 'a')).toBe('/course/wouldrather/lesson/a');
    });
});

describe('COURSE_LISTINGS_PATH', () => {
    it('is the public course-listings route', () => {
        expect(COURSE_LISTINGS_PATH).toBe('/courses');
    });
});

describe('listFriendCourses', () => {
    it('keeps only shareCta courses (except the test fixture) from the real configs', () => {
        const courses = listFriendCourses(REAL_ENTRIES);
        expect(courses.map((c) => c.courseId)).toEqual(['friend', 'friendchain', 'wouldrather', 'wouldyourather']);
    });

    it('lists the Would You Rather course under its own name (not "Friend Challenge")', () => {
        const courses = listFriendCourses(REAL_ENTRIES);
        const wouldratherCourse = courses.find((c) => c.courseId === 'wouldrather');
        expect(wouldratherCourse).toEqual({
            courseId: 'wouldrather',
            courseName: 'Would You Rather',
            lessonCount: 6,
            firstLessonId: 'a',
            mission: {
                mission: {
                    en: 'Talk about preferences with WOULD RATHER.',
                    es: 'Hablar de preferencias con WOULD RATHER',
                    pt: 'Falar de preferencias com WOULD RATHER',
                    bn: 'WOULD RATHER ব্যবহার করে নিজের পছন্দ বা অগ্রাধিকার প্রকাশ করা।',
                },
            },
            heroImage: null,
        });
    });

    it('drops the test fixture even though it has shareCta lessons', () => {
        const courses = listFriendCourses(REAL_ENTRIES);
        expect(EXCLUDED_FRIEND_COURSE_IDS).toContain('test');
        expect(courses.some((c) => c.courseId === 'test')).toBe(false);
        // Sanity: the fixture really would qualify otherwise.
        expect(isFriendCourse(testConfig)).toBe(true);
    });

    it('shapes each course with basename, name, lesson count, first lesson, mission and hero', () => {
        const friendchainCourse = listFriendCourses(REAL_ENTRIES).find((c) => c.courseId === 'friendchain');
        expect(friendchainCourse).toEqual({
            courseId: 'friendchain',
            courseName: 'Friend Challenge',
            lessonCount: 8,
            firstLessonId: 'a',
            mission: {
                mission: {
                    en: 'Talk about preferences with WOULD RATHER.',
                    es: 'Hablar de preferencias con WOULD RATHER',
                    pt: 'Falar de preferencias com WOULD RATHER',
                    bn: 'WOULD RATHER ব্যবহার করে নিজের পছন্দ বা অগ্রাধিকার প্রকাশ করা।',
                },
            },
            heroImage: null,
        });
    });

    it('uses the file basename, not config.courseId (friend.json carries a non-file id)', () => {
        const friendCourse = listFriendCourses(REAL_ENTRIES).find((c) => c.courseId === 'friend');
        expect(friendCourse.courseId).toBe('friend');
        expect(friendCourse.firstLessonId).toBe('a');
        expect(buildCourseStartHref(friendCourse.courseId, friendCourse.firstLessonId))
            .toBe('/course/friend/lesson/a');
    });

    it('drops a course whose only shareCta lesson has no lessonId', () => {
        const courses = listFriendCourses([
            { courseId: 'broken', config: { lessons: [{ recapOverlay: 'shareCta' }] } },
        ]);
        expect(courses).toEqual([]);
    });

    it('drops entries with a non-string or blank courseId, and null items', () => {
        const courses = listFriendCourses([
            null,
            { courseId: '', config: { lessons: [{ recapOverlay: 'shareCta', lessonId: 'a' }] } },
            { courseId: 42, config: { lessons: [{ recapOverlay: 'shareCta', lessonId: 'a' }] } },
            { courseId: 'ok', config: { lessons: [{ recapOverlay: 'shareCta', lessonId: 'a' }] } },
        ]);
        expect(courses.map((c) => c.courseId)).toEqual(['ok']);
    });

    it('returns [] for non-array input', () => {
        expect(listFriendCourses(null)).toEqual([]);
        expect(listFriendCourses(undefined)).toEqual([]);
        expect(listFriendCourses({})).toEqual([]);
    });

    it('sorts deterministically by courseId regardless of input order', () => {
        const a = { courseId: 'zeta', config: { lessons: [{ recapOverlay: 'shareCta', lessonId: 'a' }] } };
        const b = { courseId: 'alpha', config: { lessons: [{ recapOverlay: 'shareCta', lessonId: 'a' }] } };
        expect(listFriendCourses([a, b]).map((c) => c.courseId)).toEqual(['alpha', 'zeta']);
        expect(listFriendCourses([b, a]).map((c) => c.courseId)).toEqual(['alpha', 'zeta']);
    });

    it('falls back to the courseId as the display name when courseName is missing', () => {
        const courses = listFriendCourses([
            { courseId: 'noname', config: { lessons: [{ recapOverlay: 'shareCta', lessonId: 'a' }] } },
        ]);
        expect(courses[0].courseName).toBe('noname');
    });
});

describe('courseMissionFor', () => {
    it('prefers the top-level courseMission block, dropping blank values', () => {
        expect(courseMissionFor({
            courseMission: { mission: { en: 'Top' }, setting: '', extra: { en: 'Future' } },
            lessons: [{ lessonId: 'a', recapOverlay: 'shareCta', mission: { en: 'Lesson' } }],
        })).toEqual({ mission: { en: 'Top' }, extra: { en: 'Future' } });
    });

    it('passes future course-metadata keys through untouched', () => {
        const mission = courseMissionFor({ courseMission: { mission: { en: 'M' }, voice: { en: 'V' } } });
        expect(Object.keys(mission)).toEqual(['mission', 'voice']);
    });

    it('falls back to the first shareCta lesson mission, setting and roles', () => {
        expect(courseMissionFor({
            lessons: [
                { lessonId: 'intro' },
                {
                    lessonId: 'a',
                    recapOverlay: 'shareCta',
                    mission: { en: 'Ask' },
                    setting: { en: 'Park' },
                    roleUser: { en: 'You' },
                    roleOther: { en: 'Friend' },
                },
            ],
        })).toEqual({
            mission: { en: 'Ask' },
            setting: { en: 'Park' },
            roleUser: { en: 'You' },
            roleOther: { en: 'Friend' },
        });
    });

    it('falls back to only the lesson keys that are present', () => {
        expect(courseMissionFor({
            lessons: [{ lessonId: 'a', recapOverlay: 'shareCta', mission: { en: 'Ask' } }],
        })).toEqual({ mission: { en: 'Ask' } });
    });

    it('returns null with no usable mission anywhere', () => {
        expect(courseMissionFor({ lessons: [{ lessonId: 'a', recapOverlay: 'shareCta' }] })).toBeNull();
        expect(courseMissionFor({ lessons: [{ lessonId: 'x' }] })).toBeNull();
        expect(courseMissionFor({ courseMission: {} })).toBeNull();
        expect(courseMissionFor({ courseMission: 'nope' })).toBeNull();
        expect(courseMissionFor(null)).toBeNull();
    });

    it('falls back through the real friend config to its first lesson mission', () => {
        expect(courseMissionFor(friendchain).mission.en)
            .toBe('Talk about preferences with WOULD RATHER.');
    });

    it('reads the wouldyourather top-level mission with its CEFR levels', () => {
        expect(courseMissionFor(wouldyourather)).toEqual({
            mission: { en: 'talk about preferences' },
            A1: { en: 'X or Y' },
            A2: { en: 'which is better, noun X or noun Y' },
            B1: { en: 'would rather + [verb stem X] or [verb stem Y]' },
            B2: { en: 'given the choice between [gerund verb X] and [gerund verb Y]' },
            C1: { en: 'if I had to choose between [gerund verb X] and [gerund verb Y], my preference would be to [infinitive verb]' },
        });
    });
});

describe('courseHeroImageFor', () => {
    it('passes a top-level hero URL through', () => {
        expect(courseHeroImageFor({ courseHeroImage: 'https://img/u.jpg' })).toBe('https://img/u.jpg');
    });

    it('returns null for a missing, blank or non-string hero', () => {
        expect(courseHeroImageFor({})).toBeNull();
        expect(courseHeroImageFor({ courseHeroImage: '' })).toBeNull();
        expect(courseHeroImageFor({ courseHeroImage: '   ' })).toBeNull();
        expect(courseHeroImageFor({ courseHeroImage: 42 })).toBeNull();
        expect(courseHeroImageFor(null)).toBeNull();
    });
});

describe('COURSE_MISSION_FALLBACK_KEYS', () => {
    it('covers the live lesson mission rows in order', () => {
        expect(COURSE_MISSION_FALLBACK_KEYS).toEqual(['mission', 'setting', 'roleUser', 'roleOther']);
    });
});

describe('buildCourseListView', () => {
    const courses = [{ courseId: 'friendchain', courseName: 'Friend Chain', lessonCount: 8, firstLessonId: 'a' }];

    it('reports loading first (even if courses are already present)', () => {
        expect(buildCourseListView({ courses, isLoading: true })).toEqual({ state: 'loading', courses: [] });
    });

    it('reports error before empty/ready', () => {
        expect(buildCourseListView({ courses, isError: true })).toEqual({ state: 'error', courses: [] });
        expect(buildCourseListView({ isError: true })).toEqual({ state: 'error', courses: [] });
    });

    it('reports empty for a missing or empty course list', () => {
        expect(buildCourseListView({ courses: [] })).toEqual({ state: 'empty', courses: [] });
        expect(buildCourseListView({ courses: undefined })).toEqual({ state: 'empty', courses: [] });
        expect(buildCourseListView()).toEqual({ state: 'empty', courses: [] });
    });

    it('reports ready with the courses when present', () => {
        expect(buildCourseListView({ courses })).toEqual({ state: 'ready', courses });
    });
});
