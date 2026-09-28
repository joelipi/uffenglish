// src/modules/video/complete-video-wiring.test.js
// Source guard for the concatenated-recap R2 upload wiring
// (stories/021-upload-concatenated-videos-to-r2). The full runProcessing path
// needs MediaRecorder/canvas/WebCodecs and cannot run headlessly, so the call
// site is asserted as text (comments stripped), like poster-avatar-wiring.test.js.
//
// This guard proves presence/shape only (the call exists, is inside the publish
// block, and is not awaited). The "never fails the publish" guarantee rests on
// the unit tests' never-throws contract in complete-video-upload.test.js, not on
// this text guard.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('SuccessButtons complete-video wiring', () => {
    const source = stripComments(readFileSync(path.join(ROOT, 'src/components/widgets/SuccessButtons.jsx'), 'utf8'));
    const publishBlock = source.slice(source.indexOf('if (publishSegments)'));

    it('imports uploadCompleteVideoToR2 from the video processor', () => {
        // Assert on the raw source: the comment-stripper treats the `//` in the
        // relative import path as a comment start, so the path must not be
        // matched against stripped text.
        const raw = readFileSync(path.join(ROOT, 'src/components/widgets/SuccessButtons.jsx'), 'utf8');
        expect(raw).toContain('uploadCompleteVideoToR2');
        expect(raw).toContain("await import('../../modules/video/video-processor.js')");
    });

    it('calls it with the recap blob inside the publishSegments block', () => {
        expect(publishBlock).toContain('uploadCompleteVideoToR2(result.blob, lessonId)');
    });

    it('is fire-and-forget (not awaited)', () => {
        expect(publishBlock).not.toMatch(/await\s+uploadCompleteVideoToR2/);
        expect(publishBlock).toMatch(/uploadCompleteVideoToR2\(result\.blob, lessonId\)\s*\.catch\(/);
    });
});

describe('video-processor.web.js complete-video export', () => {
    const source = readFileSync(path.join(ROOT, 'src/modules/video/video-processor.web.js'), 'utf8');

    it('exports the upload function and the size cap', () => {
        expect(source).toContain('export async function uploadCompleteVideoToR2');
        expect(source).toContain('export const MAX_R2_UPLOAD_BYTES');
    });

    it('is defined after exportSegmentsToR2 (preserves the renderStepToBlob slice guard)', () => {
        expect(source.indexOf('export async function uploadCompleteVideoToR2'))
            .toBeGreaterThan(source.indexOf('export async function exportSegmentsToR2'));
    });

    it('uses the complete key builder and mp4 content type', () => {
        expect(source).toContain('getCompleteVideoKey(');
        expect(source).toContain("contentType: 'video/mp4'");
    });
});
