// Unit tests for the cloud pipeline's shared key rules (story 040, Task 1).
// These constants are the contract between the Pages Functions, the R2 keys and
// docs/video-pipeline/pipeline_lib.py, so every boundary is pinned here.

import { describe, it, expect } from 'vitest';
import {
    PIPELINE_SLUG_PATTERN,
    PIPELINE_JOB_ID_PATTERN,
    isValidPipelineSlug,
    rawTakeKey,
    statusKey,
    publishedVideoKey,
    publishedPosterKey,
    pipelineAssetKey,
} from './pipeline-keys.js';

describe('pipeline-keys — slug validation', () => {
    it('accepts bare alphanumeric/underscore/hyphen slugs', () => {
        expect(isValidPipelineSlug('lesson_01')).toBe(true);
        expect(isValidPipelineSlug('Take-3')).toBe(true);
        expect(isValidPipelineSlug('a')).toBe(true);
    });

    it('rejects traversal, separators, leading dots, empty, extensions and >100 chars', () => {
        for (const bad of ['../evil', 'a/b', '.hidden', '', 'a.mp4', 'x'.repeat(101)]) {
            expect(isValidPipelineSlug(bad), bad).toBe(false);
        }
    });

    it('rejects non-strings without throwing', () => {
        expect(isValidPipelineSlug(null)).toBe(false);
        expect(isValidPipelineSlug(undefined)).toBe(false);
        expect(isValidPipelineSlug(42)).toBe(false);
    });

    it('exports the exact pattern the Python mirror must match', () => {
        expect(PIPELINE_SLUG_PATTERN.source).toBe('^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$');
    });
});

describe('pipeline-keys — object keys', () => {
    it('maps a slug to its raw take key, never under videos/assets', () => {
        expect(rawTakeKey('lesson_01')).toBe('raw/lesson_01.mp4');
        const key = rawTakeKey('lesson_01');
        expect(key.startsWith('videos/')).toBe(false);
        expect(key.startsWith('assets/')).toBe(false);
    });

    it('maps a job id to the status marker key and rejects bad ids', () => {
        expect(statusKey('job-abc12345')).toBe('raw/status/job-abc12345.json');
        expect(statusKey('bad/id')).toBe(null);
        expect(statusKey('short')).toBe(null);
    });

    it('maps a slug to its published video/poster pair', () => {
        expect(publishedVideoKey('lesson_01')).toBe('assets/videos/lesson_01.mp4');
        expect(publishedPosterKey('lesson_01')).toBe('assets/videos/lesson_01.jpg');
    });

    it('maps a relative asset path into pipeline-assets/', () => {
        expect(pipelineAssetKey('fonts/Kalam-Bold.ttf')).toBe('pipeline-assets/fonts/Kalam-Bold.ttf');
    });

    it('normalizes Windows separators in asset paths', () => {
        expect(pipelineAssetKey('fonts\\Kalam-Bold.ttf')).toBe('pipeline-assets/fonts/Kalam-Bold.ttf');
    });

    it('exposes the job-id pattern used by the render/status Functions', () => {
        expect(PIPELINE_JOB_ID_PATTERN.test('job-abc12345')).toBe(true);
        expect(PIPELINE_JOB_ID_PATTERN.test('bad/id')).toBe(false);
    });
});
