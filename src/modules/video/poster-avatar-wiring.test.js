// src/modules/video/poster-avatar-wiring.test.js
// Minimal source guard for the poster→profile-picture call site
// (stories/019-use-poster-as-profile-picture). The gating and assignment logic
// is unit-tested behaviorally in src/modules/avatar/poster-avatar.test.js; this
// only asserts the browser-only export path actually invokes it, since
// exportSegmentsToR2 needs MediaRecorder/canvas/WebCodecs and cannot run
// headlessly. Comments are stripped so a commented-out call cannot pass.
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

describe('video-processor.web.js poster→avatar wiring', () => {
    const source = stripComments(readFileSync(path.join(ROOT, 'src/modules/video/video-processor.web.js'), 'utf8'));
    // Slice to the next top-level export so the guard cannot pass on strings in
    // a later function (uploadCompleteVideoToR2 is appended after this one).
    const fnBody = source.slice(
        source.indexOf('export async function exportSegmentsToR2'),
        source.indexOf('export const MAX_R2_UPLOAD_BYTES'),
    );

    it('imports and calls maybeAssignPosterAvatar inside exportSegmentsToR2', () => {
        expect(source).toContain("from '../avatar/poster-avatar.js'");
        expect(fnBody).toContain('maybeAssignPosterAvatar({');
        expect(fnBody).toContain('publishable');
        expect(fnBody).toContain('succeeded');
    });
});
