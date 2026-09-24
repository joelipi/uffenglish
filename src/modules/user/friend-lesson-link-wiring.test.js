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
    it('returns { count, succeeded } from every early return and the final return', () => {
        const early = webProcessor.match(/return \{ count: 0, succeeded: 0 \};/g) || [];
        expect(early.length).toBeGreaterThanOrEqual(3);
        expect(webProcessor).toContain('return { count: publishable.length, succeeded };');
    });

    it('keeps the native stub contract consistent', () => {
        expect(nativeProcessor).toContain('return { count: 0, succeeded: 0 };');
    });
});

describe('SuccessButtons wiring', () => {
    it('awaits the export and gates on its succeeded count', () => {
        expect(successButtons).toContain('await exportSegmentsToR2(lessonId)');
        expect(successButtons).toContain('succeeded: exportResult?.succeeded');
    });

    it('records the link only through the resolver + mutation', () => {
        expect(successButtons).toContain('resolveFriendLessonLink({');
        expect(successButtons).toContain('friendLinkMutation.mutateAsync({');
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
