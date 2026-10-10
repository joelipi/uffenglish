// success-lesson-logic.test.js
// Unit tests for the share-filename builder: the learner-facing file must
// carry the same share code / course / lesson identity as the R2
// concatenated object, with the timestamped local name as fallback.
import { describe, it, expect } from 'vitest';
import { buildShareFilename, generateVideoFilename } from './success-lesson-logic.js';

describe('buildShareFilename', () => {
    it('uses the R2 complete-key basename when all parts are present', () => {
        expect(buildShareFilename({
            shareCode: 'gs5i8',
            courseId: 'wouldyourather',
            lessonId: 'a',
            fileExtension: 'mp4',
        })).toBe('gs5i8-wouldyourather-a-complete.mp4');
    });

    it('ignores the recorder extension for the R2-backed name (always mp4)', () => {
        expect(buildShareFilename({
            shareCode: 'gs5i8',
            courseId: 'wouldyourather',
            lessonId: 'a',
            fileExtension: 'webm',
        })).toBe('gs5i8-wouldyourather-a-complete.mp4');
    });

    it('embeds both contributors when a pair code is resolved', () => {
        expect(buildShareFilename({
            shareCode: 'q9uki',
            pairShareCode: 'gs5i8',
            courseId: 'wouldyourather',
            lessonId: 'b',
            fileExtension: 'mp4',
        })).toBe('q9uki-gs5i8-wouldyourather-b-complete.mp4');
    });

    it('drops a pair code equal to the exporter', () => {
        expect(buildShareFilename({
            shareCode: 'gs5i8',
            pairShareCode: 'GS5I8',
            courseId: 'wouldyourather',
            lessonId: 'b',
        })).toBe('gs5i8-wouldyourather-b-complete.mp4');
    });

    it('falls back to the timestamped local name when the share code is missing', () => {
        const name = buildShareFilename({
            shareCode: null,
            courseId: 'wouldyourather',
            lessonId: 'a',
            fileExtension: 'webm',
        });
        expect(name).toMatch(/^uff-a-\d{14}\.webm$/);
    });

    it('falls back when course or lesson is missing', () => {
        expect(buildShareFilename({ shareCode: 'x', courseId: null, lessonId: 'a' }))
            .toMatch(/^uff-a-\d{14}\.webm$/);
        expect(buildShareFilename({ shareCode: 'x', courseId: 'c', lessonId: null }))
            .toMatch(/^uff-null-\d{14}\.webm$/);
    });

    it('keeps the legacy timestamped generator intact', () => {
        expect(generateVideoFilename('a')).toMatch(/^uff-a-\d{14}$/);
    });
});
