import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the export -> notification -> inbox wiring. The
// MediaRecorder/R2/Supabase paths cannot run in vitest, so this locks the
// contract in source text (mirroring friend-lesson-link-wiring.test.js for
// story 012). Assertions read raw source (docs/learnings.md:19-23).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

const api = read('../api/api.js');
const successButtons = read('../../components/widgets/SuccessButtons.jsx');
const nativeProcessor = read('../video/video-processor.native.jsx');
const notificationLogic = read('./notification-logic.js');
const notificationList = read('../../components/homescreen/NotificationList.web.jsx');
const notificationsBell = read('../../components/homescreen/NotificationsBell.web.jsx');
const homeScreen = read('../../components/homescreen/HomeScreen.jsx');

describe('api.js notification plumbing', () => {
    it('defines the inbox query scoped to the recipient', () => {
        expect(api).toContain("queryKey: ['notifications', userId]");
        expect(api).toContain("enabled: !!userId && userId !== 'guest'");
        expect(api).toContain(".from('user_notifications')");
        expect(api).toContain(".eq('recipient_id', userId)");
    });

    it('defines mark-read and records the friend response through the RPC', () => {
        expect(api).toContain('export function useMarkNotificationsRead()');
        expect(api).toContain('read_at: new Date().toISOString()');
        expect(api).toContain("queryClientHook.invalidateQueries({ queryKey: ['notifications', variables.userId] })");
        expect(api).toContain('export function useRecordFriendResponseMutation()');
        expect(api).toContain("supabase.rpc('record_friend_response'");
        expect(api).toContain('p_recipient_share_code: recipientShareCode');
        expect(api).toContain('p_course_id: courseId');
        expect(api).toContain('p_lesson_id: lessonId');
    });
});

describe('SuccessButtons export trigger wiring', () => {
    it('imports and calls the resolver + record mutation', () => {
        expect(successButtons).toContain('resolveFriendResponseNotification(');
        expect(successButtons).toContain('useRecordFriendResponseMutation(');
        expect(successButtons).toContain('friendResponseMutation.mutateAsync(responsePayload)');
    });

    it('gates on a real export and the captured friend code', () => {
        expect(successButtons).toContain('succeeded: exportResult?.succeeded');
        expect(successButtons).toContain('recipientShareCode: appStore.getState().friendCode');
    });

    it('keeps the notification failure non-fatal', () => {
        expect(successButtons).toContain('R2 publish / friend link failed (non-fatal)');
    });
});

describe('native export contract untouched', () => {
    it('keeps the exportSegmentsToR2 stub returning the unchanged shape', () => {
        expect(nativeProcessor).toContain('return { count: 0, succeeded: 0 };');
    });
});

// Platform separation (React Native–portable): rules must stay in the pure
// logic module; the web list must not reach the data layer; the container wires
// hooks to the view; HomeScreen only mounts the bell for a registered user.
describe('logic / presentation separation', () => {
    it('keeps notification-logic.js free of React / React Native / DOM imports', () => {
        expect(notificationLogic).not.toMatch(/from ['"]react['"]/);
        expect(notificationLogic).not.toMatch(/from ['"]react-native['"]/);
        expect(notificationLogic).not.toMatch(/\bwindow\./);
        expect(notificationLogic).not.toMatch(/\bdocument\./);
    });

    it('routes NotificationList.web rules through notification-logic and imports no data layer', () => {
        expect(notificationList).toContain("from '../../modules/notifications/notification-logic.js'");
        expect(notificationList).not.toContain('modules/api/api.js');
        expect(notificationList).not.toContain('supabase');
        for (const fn of [
            'listNotifications',
            'buildProfileHref',
            'formatNotificationDate',
            'getNotificationActorName',
            'getNotificationActorShareCode',
        ]) {
            expect(notificationList).toContain(fn);
        }
    });

    it('wires the data hooks to the view only in the bell container', () => {
        expect(notificationsBell).toContain("from '../../modules/api/api.js'");
        expect(notificationsBell).toContain("from './NotificationList.web.jsx'");
        expect(notificationsBell).toContain('useNotifications(userId)');
        expect(notificationsBell).toContain('useMarkNotificationsRead()');
    });

    it('mounts the bell in HomeScreen only for a registered user', () => {
        expect(homeScreen).toContain("from './NotificationsBell.web.jsx'");
        expect(homeScreen).toContain('<NotificationsBell userId={viewerId} lang={lang} />');
        expect(homeScreen).toContain("viewerId !== 'guest'");
        expect(homeScreen).toContain("width: '44px'");
    });
});
