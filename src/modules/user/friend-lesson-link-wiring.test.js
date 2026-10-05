import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the export -> link wiring. The browser MediaRecorder/R2 and
// Supabase paths cannot run in vitest, so this locks the contract that the
// export reports its success count and the success handler only records a link
// after a real export (and keeps publish failures non-fatal).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

const webProcessor = read('../video/video-processor.web.js');
const nativeProcessor = read('../video/video-processor.native.jsx');
const successButtons = read('../../components/widgets/SuccessButtons.jsx');
const api = read('../api/api.js');

describe('exportSegmentsToR2 return contract', () => {
    it('returns { count, succeeded, askPublished } from every early return and the final return', () => {
        const early = webProcessor.match(/return \{ count: 0, succeeded: 0, askPublished: false \};/g) || [];
        expect(early.length).toBeGreaterThanOrEqual(3);
        expect(webProcessor).toContain('return { count: publishable.length, succeeded, askPublished };');
    });

    it('keeps the native stub contract consistent', () => {
        expect(nativeProcessor).toContain('return { count: 0, succeeded: 0, askPublished: false };');
    });
});

describe('exportSegmentsToR2 publish targets', () => {
    it('groups segments by target lesson via the pure helpers (no inline key template)', () => {
        expect(webProcessor).toContain('assignSegmentTargets(publishable, lessonId)');
        expect(webProcessor).toContain('buildUgcSegmentKey({ shareCode, courseId, lessonId: targetLessonId, index: segmentIndex })');
        expect(webProcessor).not.toContain('videos/${shareCode}');
    });

    it('sets askPublished when a clip publishes under a lesson other than the exported one', () => {
        expect(webProcessor).toContain('if (targetLessonId !== lessonId) askPublished = true;');
    });
});

describe('SuccessButtons wiring', () => {
    it('awaits the export and gates on its succeeded flag', () => {
        expect(successButtons).toContain('await exportSegmentsToR2(lessonId, result.segments, result.blob)');
        expect(successButtons).toContain('succeeded: exportResult?.succeeded');
        expect(successButtons).not.toContain('askPublished: exportResult?.askPublished');
    });

    it('keeps ready before the export (no publish gate is added)', () => {
        const readyAt = successButtons.indexOf("setVideoState('ready')");
        const exportAt = successButtons.indexOf('await exportSegmentsToR2(');
        expect(readyAt).toBeGreaterThan(-1);
        expect(exportAt).toBeGreaterThan(-1);
        expect(readyAt).toBeLessThan(exportAt);
    });

    it('records the link only through the resolver + mutation', () => {
        expect(successButtons).toContain('resolveFriendLessonLink({');
        expect(successButtons).toContain('friendLinkMutation.mutateAsync({');
    });

    it('calls the resolver with the chain payload shape (no askPublished)', () => {
        const start = successButtons.indexOf('resolveFriendLessonLink({');
        expect(start).toBeGreaterThan(-1);
        const end = successButtons.indexOf('});', start);
        expect(end).toBeGreaterThan(start);
        const block = successButtons.slice(start, end + 3);
        expect(block).toContain('configData');
        expect(block).toContain('lessonId');
        expect(block).toContain('courseId');
        expect(block).toContain('courseName: configData?.courseName');
        expect(block).toContain('shareCode: userData?.shareCode');
        expect(block).toContain('succeeded: exportResult?.succeeded');
        expect(block).not.toContain('askPublished');
    });

    it('treats a publish/link failure as non-fatal', () => {
        expect(successButtons).toContain('R2 publish / friend link failed (non-fatal)');
    });
});

describe('api.js public read + write plumbing', () => {
    it('exposes the friendLinks alias and the column in the safe fallback', () => {
        expect(api).toContain('friendLinks: row.friend_links');
        expect(api).toContain('account_status,friend_links');
    });

    it('merges through upsertFriendLinkMap', () => {
        expect(api).toContain('upsertFriendLinkMap(row?.friend_links, entry)');
    });
});
