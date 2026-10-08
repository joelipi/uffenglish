import { describe, it, expect } from 'vitest';
import { configCourseId, loadConfigEntries } from './friend-course-configs.js';
import { listFriendCourses } from './friend-courses-logic.js';

// Pinned guard list: the loader glob must see every config, so a new
// `src/config/*.json` added by another story intentionally fails this test
// until it is listed here (the repo's pinned-list convention).
const REAL_COURSE_IDS = [
    'friend', 'friendchain', 'gt2', 'model', 't', 'test', 'test-api', 'wouldrather', 'wouldyourather',
];

describe('configCourseId', () => {
    it('strips the directory and .json extension', () => {
        expect(configCourseId('./config/friendchain.json')).toBe('friendchain');
        expect(configCourseId('../../config/wouldyourather.json')).toBe('wouldyourather');
    });
});

describe('loadConfigEntries', () => {
    it('loads every real config via the Vite glob', async () => {
        const entries = await loadConfigEntries();
        expect(entries.map((e) => e.courseId).sort()).toEqual(REAL_COURSE_IDS);
    });

    it('parses the JSON (friendchain has all 8 lessons)', async () => {
        const entries = await loadConfigEntries();
        const friendchain = entries.find((e) => e.courseId === 'friendchain');
        expect(Array.isArray(friendchain.config.lessons)).toBe(true);
        expect(friendchain.config.lessons).toHaveLength(8);
    });

    it('skips a module whose loader rejects instead of rejecting the whole call', async () => {
        const entries = await loadConfigEntries({
            './a.json': async () => ({ default: { lessons: [] } }),
            './b.json': async () => { throw new Error('boom'); },
        });
        expect(entries).toEqual([{ courseId: 'a', config: { lessons: [] } }]);
    });

    it('feeds listFriendCourses to the expected friend courses', async () => {
        const courses = listFriendCourses(await loadConfigEntries());
        expect(courses.map((c) => c.courseId)).toEqual(['friend', 'friendchain', 'wouldrather', 'wouldyourather']);
        for (const course of courses) {
            expect(course.firstLessonId).toBe('a');
        }
    });
});
