// src/modules/video/poster-avatar-wiring.test.js
// Source guards for the poster→profile-picture wiring
// (stories/019-use-poster-as-profile-picture). The full exportSegmentsToR2 path
// needs MediaRecorder/canvas/WebCodecs and cannot run headlessly, so the call
// site is asserted as text, like the existing UGC poster wiring test.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
function read(rel) {
    return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('video-processor.web.js poster→avatar wiring', () => {
    const source = read('src/modules/video/video-processor.web.js');
    // exportSegmentsToR2 is the last function in the module.
    const fnBody = source.slice(source.indexOf('export async function exportSegmentsToR2'));

    it('imports the poster-avatar helpers', () => {
        expect(source).toContain("from '../avatar/poster-avatar.js'");
        expect(source).toContain('applyPosterAsProfilePictureIfMissing');
        expect(source).toContain('pickAvatarThumb');
    });

    it('calls the helpers inside exportSegmentsToR2, gated on a successful publish', () => {
        expect(fnBody).toContain('pickAvatarThumb(publishable)');
        expect(fnBody).toContain('applyPosterAsProfilePictureIfMissing({');
        expect(fnBody).toMatch(/if\s*\(\s*succeeded\s*>\s*0\s*\)/);
    });

    it('passes the authenticated user id and current picture URL', () => {
        expect(fnBody).toContain('userId: userData?.$id');
        expect(fnBody).toContain('currentUrl: userData?.profilePictureUrl');
    });
});

describe('poster-avatar.js contract', () => {
    const source = read('src/modules/avatar/poster-avatar.js');

    it('claims an empty slot, cleans up orphans, and syncs the cache/store', () => {
        expect(source).toContain(".is('profile_picture_url', null)");
        expect(source).toContain('deleteAvatarFromStorage(');
        expect(source).toContain('setQueryData');
        expect(source).toContain('setCourseData');
    });
});
