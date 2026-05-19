import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveCurrentLessonId, resolveCurrentCourseId, getNextStep } from './lesson-router.js';
import { appStore } from './store.js';

describe('Lesson Router', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        appStore.setState({ activeLessonId: null });
    });

    describe('resolveCurrentLessonId', () => {
        it('should throw if configData is invalid', () => {
            expect(() => resolveCurrentLessonId(null, {}, 'course')).toThrow('Invalid or missing course configuration.');
        });

        it('should use persisted state if valid', () => {
            appStore.setState({ activeLessonId: 'lesson1' });
            const config = { lessons: [{ lessonId: 'lesson1' }] };
            expect(resolveCurrentLessonId(config, {}, 'course')).toBe('lesson1');
        });

        it('should use URL param if provided', () => {
            const config = { lessons: [{ lessonId: 'lesson1' }] };
            expect(resolveCurrentLessonId(config, {}, 'course', { urlLessonId: 'lesson-url' })).toBe('lesson-url');
        });

        it('should fallback to first config lesson if no other inputs', () => {
            const config = { lessons: [{ lessonId: 'lesson-first' }] };
            expect(resolveCurrentLessonId(config, {}, 'course')).toBe('lesson-first');
        });

        it('should throw if no lessons in config and no other valid sources', () => {
            const config = { lessons: [] };
            expect(() => resolveCurrentLessonId(config, {}, 'course')).toThrow('No lessons found');
        });
    });

    describe('resolveCurrentCourseId', () => {
        it('should prioritize URL course ID', () => {
            expect(resolveCurrentCourseId({}, { urlCourseId: 'url-course' })).toBe('url-course');
        });

        it('should fallback to default if no inputs', () => {
            expect(resolveCurrentCourseId(null)).toBe('tutorial');
        });
    });

    describe('getNextStep', () => {
        const configData = {
            lessons: [{
                steps: [
                    { step: 'Step 1', cue: 'cue1' },
                    { step: 'Step 2', cue: 'cue2' }
                ]
            }]
        };

        it('should return next step', () => {
            const currentStep = { step: 'Step 1', cue: 'cue1' };
            const next = getNextStep(currentStep, configData, 0);
            expect(next).toEqual({ step: 'Step 2', cue: 'cue2' });
        });

        it('should return null if at end of lesson', () => {
            const currentStep = { step: 'Step 2', cue: 'cue2' };
            const next = getNextStep(currentStep, configData, 0);
            expect(next).toBeNull();
        });

        it('should fallback to first step if current step not found', () => {
            const currentStep = { step: 'Unknown', cue: 'unk' };
            const next = getNextStep(currentStep, configData, 0);
            expect(next).toEqual({ step: 'Step 1', cue: 'cue1' });
        });
    });
});
