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
const successScreen = read('../../components/widgets/SuccessScreen.jsx');
const videoShare = read('../video/video-share.web.js');
const api = read('../api/api.js');
const friendLessonLinksSection = read('../../components/profile/FriendLessonLinksSection.jsx');
const notificationList = read('../../components/homescreen/NotificationList.web.jsx');
const rootLayout = read('../../routes/RootLayout.jsx');
const app = read('../../App.jsx');

describe('exportSegmentsToR2 return contract', () => {    it('returns { count, succeeded, askPublished } from every early return and the final return', () => {
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
        expect(webProcessor).toContain('buildUgcSegmentKey({ shareCode, inviterCode, courseId, lessonId: targetLessonId, index: segmentIndex })');
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

    it('hands the entry to the mutation (the owner is derived server-side)', () => {
        const start = successButtons.indexOf('friendLinkMutation.mutateAsync({');
        expect(start).toBeGreaterThan(-1);
        const end = successButtons.indexOf('});', start);
        const block = successButtons.slice(start, end + 3);
        expect(block).toContain('entry: payload');
        // The client no longer passes its own user id: the RPC derives the
        // owner from auth.uid(), so a stale/missing id cannot send the write
        // to the wrong row (or to no row at all).
        expect(block).not.toContain('userId');
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

    it('writes the link through the server-side RPC, not a client read-modify-write', () => {
        expect(api).toContain("supabase.rpc('record_friend_link'");
        expect(api).toContain('p_course_id: entry.courseId');
        expect(api).toContain('p_recorded_lesson_id: entry.recordedLessonId');
        expect(api).toContain('p_next_lesson_id: entry.lessonId');
        // A client-side read-modify-write of the whole map is what let the link
        // vanish silently (a zero-row UPDATE is not an error in PostgREST).
        expect(api).not.toContain('upsertFriendLinkMap(row?.friend_links, entry)');
        expect(api).not.toContain("from('user_profiles').update({ friend_links:");
    });

    it('retries the link write so one flaky round trip cannot lose it', () => {
        expect(api).toMatch(/retry:\s*2/);
        expect(api).toMatch(/retryDelay:/);
    });
});

describe('in-app links stay inside the app', () => {
    // The profile's lesson link used to be a plain <a href> with an absolute
    // URL, so the click was a DOCUMENT load. A document load is the only thing
    // in the app that can end in a browser-level "This site can't be reached /
    // ERR_FAILED" page (a cancelled or failed document navigation), and it
    // also threw the in-memory guest language away, so the lesson re-opened the
    // language modal on every visit.
    it('renders the profile lesson link as a client-side router link', () => {
        // The <Link> element itself, anchored on the testid so a comment
        // mentioning <Link> cannot satisfy the guard.
        expect(friendLessonLinksSection)
            .toMatch(/<Link\b[^>]*data-testid="friend-lesson-link"[^>]*\bto=\{path\}/);
        // The lesson link is NOT an anchor: an anchor is a document load.
        expect(friendLessonLinksSection)
            .not.toMatch(/<a\b[^>]*data-testid="friend-lesson-link"/);
        // No absolute URL is built for it any more, so the link cannot leave
        // the host the visitor is on either.
        expect(friendLessonLinksSection).not.toContain('buildFriendLessonLink(');
        expect(friendLessonLinksSection).not.toContain('toFriendLessonHref(');
        expect(friendLessonLinksSection).not.toContain('currentSiteOrigin');
    });

    it('builds the in-app path with the pure helper', () => {
        expect(friendLessonLinksSection).toContain('buildFriendLessonPath(');
    });

    it('builds the notification profile link from the current origin', () => {
        // The notification row is still a plain link to a profile URL, so it
        // must be built from the origin the page is served from — never a
        // hard-coded apex, which would send a staging/preview visitor to
        // production.
        expect(notificationList).toContain("import { currentSiteOrigin } from '../../modules/user/current-site-origin.webonly.js'");
        expect(notificationList).toContain('buildProfileHref(shareCode, { origin: currentSiteOrigin() })');
    });

    it('captures the share code on every location change, not once at start-up', () => {
        // The profile link is a client-side navigation, so the app is already
        // mounted when the visitor clicks it: a start-up-only capture would
        // miss the code and the lesson would play the wrong take.
        expect(rootLayout).toContain('useShareCodeFromLocation()');
        expect(app).not.toContain('Captured sharecode param');
    });
});

// The last chain lesson has nothing to answer, so its three copy surfaces must
// switch to the terminal copy. Terminality is derived (config order) and the
// share link is unchanged: it is the learner's PROFILE, where their other live
// lessons live. A config flag would change chain membership, which
// `recapOverlay` already defines.
describe('terminal chain lesson copy wiring', () => {
    it('picks the share message from the lesson, keeping the profile link', () => {
        const start = videoShare.indexOf('export function buildShareMessage');
        const end = videoShare.indexOf('\n}', start);
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        const block = videoShare.slice(start, end);
        expect(block).toContain('isTerminalFriendLesson(configData, successLessonId)');
        expect(block).toContain("'share_message_terminal'");
        expect(block).toContain("'share_message'");
        expect(block).toContain('buildShareUrl(userData?.shareCode)');
    });

    it('picks the success CTA from the lesson', () => {
        expect(successScreen).toContain('isTerminalFriendLesson(configData, lessonId)');
        expect(successScreen).toContain("'share_cta_success_terminal'");
        expect(successScreen).toContain("'share_cta_success'");
    });

    it('picks the burnt-card first line from the lesson', () => {
        const start = webProcessor.indexOf('const shareCta = isShareCtaEnabled');
        const end = webProcessor.indexOf(': null;', start);
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        const block = webProcessor.slice(start, end);
        expect(block).toContain('isTerminalFriendLesson(configData, lessonId)');
        expect(block).toContain("'share_cta_respond_now_terminal'");
        expect(block).toContain("'share_cta_respond_now'");
    });

    it('never keys terminal copy off the recapOverlay variant', () => {
        expect(webProcessor).not.toContain("isShareCtaEnabled('terminal')");
        expect(successScreen).not.toContain("=== 'terminal'");
    });
});

// The profile used to label a link with the lesson title stored on the entry,
// which is frozen at export time — a renamed lesson kept showing its old
// wording for the whole 48h window. The label is now the lesson's POSITION in
// the course chain, derived from the config at render time.
describe('profile lesson-position labels', () => {
    const publicProfile = read('../../components/profile/PublicProfile.jsx');
    const section = read('../../components/profile/FriendLessonLinksSection.jsx');

    it('reads the live course configs and derives the ordinals from them', () => {
        expect(publicProfile).toContain("queryKey: ['config-entries']");
        expect(publicProfile).toContain('buildRecordedLessonOrdinals(friendLinks, configEntries)');
        expect(publicProfile).toContain('lessonOrdinals={lessonOrdinals}');
    });

    it('falls back to the stored title when the config has not loaded', () => {
        expect(section).toContain('lessonOrdinals = {}');
        expect(section).toContain('ordinal={lessonOrdinals[`${entry.courseId}:${entry.recordedLessonId}`]}');
        // The fallback chain, in order: positional label, stored title, generic copy.
        const start = section.indexOf('const ordinalLabel = ordinal');
        const end = section.indexOf('Strings.get(\'profile_friend_lesson_link\', lang)', start);
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        const block = section.slice(start, end);
        expect(block).toContain("'profile_friend_lesson_number'");
        expect(block).toContain('entry.lessonTitle');
    });
});
