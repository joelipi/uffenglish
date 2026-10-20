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
import wouldyourather from '../../config/wouldyourather.json';
import model from '../../config/model.json';
import wouldyouratherTest from '../../config/wouldyourather-test.json';

const REAL_ENTRIES = [
    { courseId: 'wouldyourather', config: wouldyourather },
    { courseId: 'wouldyourather-test', config: wouldyouratherTest },
    { courseId: 'model', config: model },
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
        expect(buildCourseStartHref('wouldyourather', 'a')).toBe('/course/wouldyourather/lesson/a');
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
        expect(courses.map((c) => c.courseId)).toEqual(['wouldyourather']);
    });

    it('lists the Would You Rather course under its own name (not "Friend Challenge")', () => {
        const courses = listFriendCourses(REAL_ENTRIES);
        const wyr = courses.find((c) => c.courseId === 'wouldyourather');
        expect(wyr.courseId).toBe('wouldyourather');
        expect(wyr.courseName).toBe('Get $1 million or $5 million?');
        expect(wyr.lessonCount).toBe(6);
        expect(wyr.firstLessonId).toBe('a');
        expect(wyr.mission.mission.en).toBe('talk about preferences');
        expect(wyr.heroImage).toBe('src/assets/img/wouldyouratherhero.jpg');
    });

    it('drops the test fixture even though it has shareCta lessons', () => {
        const courses = listFriendCourses(REAL_ENTRIES);
        expect(EXCLUDED_FRIEND_COURSE_IDS).toContain('wouldyourather-test');
        expect(courses.some((c) => c.courseId === 'wouldyourather-test')).toBe(false);
        // Sanity: the dev twin really would qualify otherwise.
        expect(isFriendCourse(wouldyouratherTest)).toBe(true);
    });

    it('shapes each course with basename, name, lesson count, first lesson, mission and hero', () => {
        const wyr = listFriendCourses(REAL_ENTRIES).find((c) => c.courseId === 'wouldyourather');
        expect(wyr).toEqual({
            courseId: 'wouldyourather',
            courseName: 'Get $1 million or $5 million?',
            lessonCount: 6,
            firstLessonId: 'a',
            mission: {
                mission: {
                    en: 'talk about preferences',
                    es: 'hablar sobre preferencias',
                    pt: 'falar sobre preferências',
                    bn: 'পছন্দ সম্পর্কে কথা বলুন',
                    fr: 'parler de préférences',
                    hi: 'पसंद के बारे में बात करें',
                },
                A1: { en: 'X or Y' },
                A2: { en: 'which is better, noun X or noun Y' },
                B1: { en: 'would rather + [verb stem X] or [verb stem Y]' },
                B2: { en: 'given the choice between [gerund verb X] and [gerund verb Y]' },
                C1: { en: 'if I had to choose between [gerund verb X] and [gerund verb Y], my preference would be to [infinitive verb]' },
            },
            heroImage: 'src/assets/img/wouldyouratherhero.jpg',
        });
    });

    it('uses the file basename, not config.courseId', () => {
        // The loader passes the file basename as the course id, so a config
        // whose own courseId field says otherwise is still addressed by its
        // file name.
        const courses = listFriendCourses([
            { courseId: 'somefile', config: { courseId: 'other', lessons: [{ lessonId: 'a', recapOverlay: 'shareCta' }] } },
        ]);
        expect(courses[0].courseId).toBe('somefile');
        expect(buildCourseStartHref(courses[0].courseId, courses[0].firstLessonId))
            .toBe('/course/somefile/lesson/a');
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
        expect(courseMissionFor(wouldyourather).mission.en)
            .toBe('talk about preferences');
    });

    it('reads the wouldyourather top-level mission with its CEFR levels', () => {
        expect(courseMissionFor(wouldyourather)).toEqual({
            mission: { en: 'talk about preferences', es: 'hablar sobre preferencias', pt: 'falar sobre preferências', bn: 'পছন্দ সম্পর্কে কথা বলুন', fr: 'parler de préférences', hi: 'पसंद के बारे में बात करें' },
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
    const courses = [{ courseId: 'wouldyourather', courseName: 'Would You Rather', lessonCount: 6, firstLessonId: 'a' }];

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
