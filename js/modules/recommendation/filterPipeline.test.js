import { describe, it, expect } from 'vitest';
import {
    removeNeverRecommend,
    removeCompleted,
    removeWrongLevel,
    splitResumableAndFresh,
    filterByTagsAndFocus,
    fallbackDropTags,
    fallbackDropFocus,
    fallbackWiderLevel
} from './filterPipeline.js';

describe('filterPipeline', () => {
    const courses = [
        { courseId: 'c1', languageLevel: 'A1', tags: ['food'], focus: ['speaking'] },
        { courseId: 'c2', languageLevel: 'B1', tags: ['travel'], focus: ['listening'] },
        { courseId: 'c3', languageLevel: 'B1', tags: ['food'], focus: ['speaking'] },
        { courseId: 'c4', languageLevel: 'B2', tags: ['work'], focus: ['grammar'] }
    ];

    it('removeNeverRecommend should filter out never recommended courses', () => {
        const result = removeNeverRecommend(courses, ['c2']);
        expect(result.length).toBe(3);
        expect(result.find(c => c.courseId === 'c2')).toBeUndefined();
    });

    it('removeCompleted should filter out completed courses', () => {
        const result = removeCompleted(courses, ['c1', 'c4']);
        expect(result.length).toBe(2);
        expect(result.map(c => c.courseId)).toEqual(['c2', 'c3']);
    });

    it('removeWrongLevel should filter courses by level', () => {
        const result = removeWrongLevel(courses, 'B1');
        expect(result.length).toBe(2);
        expect(result.map(c => c.courseId)).toEqual(['c2', 'c3']);
    });

    it('splitResumableAndFresh should split courses correctly', () => {
        const { resumable, fresh } = splitResumableAndFresh(courses, ['c2']);
        expect(resumable.length).toBe(1);
        expect(resumable[0].courseId).toBe('c2');
        expect(fresh.length).toBe(3);
        expect(fresh.map(c => c.courseId)).toEqual(['c1', 'c3', 'c4']);
    });

    it('filterByTagsAndFocus should filter correctly', () => {
        const result = filterByTagsAndFocus(courses, ['food'], 'speaking');
        expect(result.length).toBe(2);
        expect(result.map(c => c.courseId)).toEqual(['c1', 'c3']);
    });

    it('fallbackDropTags should drop tags and filter by level and focus', () => {
        const result = fallbackDropTags(courses, 'B1', 'listening');
        expect(result.length).toBe(1);
        expect(result[0].courseId).toBe('c2');
    });

    it('fallbackDropFocus should drop focus and filter by level', () => {
        const result = fallbackDropFocus(courses, 'B2');
        expect(result.length).toBe(1);
        expect(result[0].courseId).toBe('c4');
    });

    it('fallbackWiderLevel should widen the level', () => {
        const result = fallbackWiderLevel(courses, 'B1');
        expect(result.length).toBe(1);
        expect(result[0].courseId).toBe('c4');
    });
});
