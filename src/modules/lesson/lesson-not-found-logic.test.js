import { describe, it, expect } from 'vitest';
import {
    COURSE_CONFIG_OUTCOME,
    NOT_FOUND_FLAG,
    classifyCourseConfigResponse,
    isLessonMissingFromConfig,
    isNotFoundError,
    markNotFoundError,
} from './lesson-not-found-logic.js';

describe('classifyCourseConfigResponse', () => {
    it('reads a JSON content-type as the course being there', () => {
        expect(classifyCourseConfigResponse({ ok: true, contentType: 'application/json' }))
            .toBe(COURSE_CONFIG_OUTCOME.ready);
    });

    it('reads a JSON content-type with a charset as the course being there', () => {
        expect(classifyCourseConfigResponse({ ok: true, contentType: 'application/json; charset=utf-8' }))
            .toBe(COURSE_CONFIG_OUTCOME.ready);
    });

    it('reads the SPA shell (text/html) as a course that is gone', () => {
        // Cloudflare Pages rewrites every path to index.html, so a retired
        // course answers 200 with the app shell, not with a config.
        expect(classifyCourseConfigResponse({ ok: true, contentType: 'text/html; charset=utf-8' }))
            .toBe(COURSE_CONFIG_OUTCOME.missing);
    });

    it('reads a 404 as a course that is gone', () => {
        expect(classifyCourseConfigResponse({ ok: false, contentType: 'text/html' }))
            .toBe(COURSE_CONFIG_OUTCOME.missing);
    });

    it('reads a JSON body with no content-type as the course being there', () => {
        expect(classifyCourseConfigResponse({ ok: true, contentType: '', body: '{"courseId":"model"}' }))
            .toBe(COURSE_CONFIG_OUTCOME.ready);
    });

    it('reads an HTML body with no content-type as a course that is gone', () => {
        expect(classifyCourseConfigResponse({ ok: true, contentType: '', body: '<!DOCTYPE html><html></html>' }))
            .toBe(COURSE_CONFIG_OUTCOME.missing);
    });

    it('reads a missing response as a course that is gone', () => {
        expect(classifyCourseConfigResponse()).toBe(COURSE_CONFIG_OUTCOME.missing);
    });
});

describe('isLessonMissingFromConfig', () => {
    const config = { lessons: [{ lessonId: 'a' }, { lessonId: 'b' }] };

    it('finds a lesson the course still has', () => {
        expect(isLessonMissingFromConfig(config, 'b')).toBe(false);
    });

    it('reports a lesson the course no longer has as missing', () => {
        // The config bot regenerates the course configs, so a recorded friend
        // link can name a lesson that is gone.
        expect(isLessonMissingFromConfig(config, 'z')).toBe(true);
    });

    it('gives no verdict without a config', () => {
        expect(isLessonMissingFromConfig(null, 'a')).toBe(false);
        expect(isLessonMissingFromConfig({}, 'a')).toBe(false);
    });

    it('gives no verdict without a lesson id', () => {
        expect(isLessonMissingFromConfig(config, '')).toBe(false);
        expect(isLessonMissingFromConfig(config, undefined)).toBe(false);
    });
});

describe('not-found error tagging', () => {
    it('does not treat a plain error as a dead link', () => {
        expect(isNotFoundError(new Error('boom'))).toBe(false);
        expect(isNotFoundError(null)).toBe(false);
        expect(isNotFoundError(undefined)).toBe(false);
    });

    it('treats a tagged error as a dead link', () => {
        const error = markNotFoundError(new Error('Lesson z not found'));
        expect(isNotFoundError(error)).toBe(true);
    });

    it('keeps the message of a tagged error', () => {
        const error = markNotFoundError(new Error('Course config not found: friend'));
        expect(error.message).toBe('Course config not found: friend');
    });

    it('tags the error with the shared flag', () => {
        const error = markNotFoundError(new Error('boom'));
        expect(error[NOT_FOUND_FLAG]).toBe(true);
    });

    it('survives a non-object error', () => {
        expect(markNotFoundError(null)).toBeNull();
        expect(isNotFoundError(markNotFoundError('boom'))).toBe(false);
    });
});
