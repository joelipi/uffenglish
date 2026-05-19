import { describe, it, expect } from 'vitest';
import { recommend } from './courseRecommender.js';

describe('courseRecommender', () => {
    const manifest = [
        { courseId: 'c1', languageLevel: 'B1', tags: ['food'], focus: ['speaking'], recommendedNextCourseId: 'c2' },
        { courseId: 'c2', languageLevel: 'B1', tags: ['travel'], focus: ['listening'] },
        { courseId: 'c3', languageLevel: 'B1', tags: ['food'], focus: ['speaking'] },
        { courseId: 'c4', languageLevel: 'B2', tags: ['work'], focus: ['grammar'] }
    ];

    it('should prioritize recommendedNextCourseId if available', () => {
        const user = { lastCompletedCourseId: 'c1', level: 'B1' };
        const result = recommend({ user, manifest });
        expect(result.status).toBe('presenting_next_course');
        expect(result.nextCourse.courseId).toBe('c2');
    });

    it('should prioritize resumable courses over fresh ones', () => {
        const user = { level: 'B1', startedUnitIds: ['c3'] };
        const result = recommend({ user, manifest });
        expect(result.status).toBe('resumable');
        expect(result.courses[0].courseId).toBe('c3');
    });

    it('should return fresh courses matching tags and focus', () => {
        const user = { level: 'B1', tags: ['food'], focus: 'speaking' };
        const result = recommend({ user, manifest });
        expect(result.status).toBe('fresh');
        expect(result.courses.map(c => c.courseId)).toEqual(['c1', 'c3']);
    });

    it('should run fallback wider level', () => {
        const user = { level: 'B1', completedUnitIds: ['c1', 'c2', 'c3'] };
        const result = recommend({ user, manifest });
        expect(result.status).toBe('fallback');
        expect(result.reason).toBe('widened_level');
        expect(result.courses[0].courseId).toBe('c4');
    });
});
