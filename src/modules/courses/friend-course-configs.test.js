import { describe, it, expect } from 'vitest';
import { configCourseId, loadConfigEntries, resolveCourseHeroImage } from './friend-course-configs.js';
import { listFriendCourses } from './friend-courses-logic.js';

// Derived from the actual config directory so adding a new `src/config/*.json`
// never breaks this guard (multi-course authoring). The loader glob must still
// see every config; a missing file would make the count drop.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_COURSE_IDS = readdirSync(path.join(__dirname, '../../config'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();

describe('configCourseId', () => {
    it('strips the directory and .json extension', () => {
        expect(configCourseId('./config/wouldyourather.json')).toBe('wouldyourather');
        expect(configCourseId('../../config/wouldyourather.json')).toBe('wouldyourather');
    });
});

describe('loadConfigEntries', () => {
    it('loads every real config via the Vite glob', async () => {
        const entries = await loadConfigEntries();
        expect(entries.map((e) => e.courseId).sort()).toEqual(REAL_COURSE_IDS);
    });

    it('parses the JSON (the friend course has all 7 lessons)', async () => {
        const entries = await loadConfigEntries();
        const wyr = entries.find((e) => e.courseId === 'wouldyourather');
        expect(Array.isArray(wyr.config.lessons)).toBe(true);
        expect(wyr.config.lessons).toHaveLength(7);
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
        // The listed courses: every config that is a friend course and is not
        // one of the reserved fixtures (`test`, `wouldyourather-test`). The
        // health course is the second ABABAB course, so it is listed too; the
        // cartoon course is the third.
        expect(courses.map((c) => c.courseId))
            .toEqual(['cartoon-preferences', 'health', 'wouldyourather']);
        for (const course of courses) {
            expect(course.firstLessonId).toBe('a');
        }
    });

    it('carries the wouldyourather hero and leveled mission end to end', async () => {
        const courses = listFriendCourses(await loadConfigEntries());
        const course = courses.find((c) => c.courseId === 'wouldyourather');
        expect(course.heroImage).toBe('src/assets/img/wouldyouratherhero.jpg');
        expect(Object.keys(course.mission).sort()).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'mission']);
        expect(course.mission.A1).toEqual({ en: 'X or Y' });
    });

    it('carries the health hero, topics and leveled mission end to end', async () => {
        const courses = listFriendCourses(await loadConfigEntries());
        const course = courses.find((c) => c.courseId === 'health');
        expect(course.heroImage).toBe('src/assets/img/healthhero.svg');
        expect(course.tags).toEqual(['health']);
        expect(course.lessonCount).toBe(7);
        expect(Object.keys(course.mission).sort()).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'mission']);
        expect(course.mission.A1).toEqual({ en: 'X or Y' });
    });

    it('resolves the health hero to a renderable image URL', () => {
        const url = resolveCourseHeroImage('src/assets/img/healthhero.svg');
        expect(typeof url).toBe('string');
        expect(url.length).toBeGreaterThan(0);
        // Vite inlines a small asset as a data URI and emits a file URL for a
        // large one; both are renderable, and neither may be null.
        expect(url.startsWith('data:image/svg+xml') || url.includes('healthhero.svg')).toBe(true);
    });
});

describe('resolveCourseHeroImage', () => {
    it('passes absolute and root-path URLs through', () => {
        expect(resolveCourseHeroImage('https://cdn/x.jpg')).toBe('https://cdn/x.jpg');
        expect(resolveCourseHeroImage('/img/x.jpg')).toBe('/img/x.jpg');
    });

    it('resolves a source-tree reference by basename to a bundled URL', () => {
        const url = resolveCourseHeroImage('src/assets/img/wouldyouratherhero.jpg');
        expect(typeof url).toBe('string');
        expect(url).toContain('wouldyouratherhero.jpg');
    });

    it('resolves regardless of the directory prefix in the reference', () => {
        expect(resolveCourseHeroImage('src/img/wouldyouratherhero.jpg'))
            .toBe(resolveCourseHeroImage('src/assets/img/wouldyouratherhero.jpg'));
    });

    it('returns null for unknown basenames and blank values', () => {
        expect(resolveCourseHeroImage('nope/missing.jpg')).toBeNull();
        expect(resolveCourseHeroImage('')).toBeNull();
        expect(resolveCourseHeroImage(null)).toBeNull();
        expect(resolveCourseHeroImage(42)).toBeNull();
    });
});
