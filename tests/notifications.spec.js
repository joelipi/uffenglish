// @ts-check
import { test, expect } from '@playwright/test';

// Notification bell on the home screen. Boots '/home', lets the initial auth +
// profile queries settle, then injects fixtures through the app's own
// queryClient singleton (same pattern as tests/friend-lesson-link.spec.js).
// Supabase REST is stubbed statefully: the mark-read PATCH flips read_at, so the
// invalidation refetch returns read rows instead of emptying the panel.

const PROFILE = {
    $id: 'u1',
    auth_method: 'supabase',
    shareCode: 'me123',
    native_language: 'EN',
};

const NOTIFICATIONS = [
    {
        id: 'n1',
        type: 'friend_response',
        course_id: 'wouldyourather',
        lesson_id: 'b',
        payload: { actorShareCode: 'sam123', actorName: 'Sam' },
        created_at: '2026-09-24T11:00:00.000Z',
        read_at: null,
    },
    {
        id: 'n2',
        type: 'friend_response',
        course_id: 'wouldyourather',
        lesson_id: 'b',
        payload: { actorShareCode: 'lee456', actorName: 'Lee' },
        created_at: '2026-09-22T00:00:00.000Z',
        read_at: '2026-09-22T01:00:00.000Z',
    },
];

test.describe('home-screen notification bell', () => {
    /** @type {Array<Record<string, any>>} */
    let rows;

    test.beforeEach(async ({ page }) => {
        rows = NOTIFICATIONS.map((r) => ({ ...r }));

        // Unauthenticated by default; the injected fixtures drive the bell.
        await page.route('**/auth/v1/**', (route) =>
            route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
        );
        await page.route('**/rest/v1/**', (route) => {
            const request = route.request();
            if (request.url().includes('user_notifications')) {
                if (request.method() === 'PATCH') {
                    rows = rows.map((r) => ({ ...r, read_at: r.read_at || '2026-09-24T12:00:00.000Z' }));
                    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
                }
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
            }
            return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });
    });

    async function bootAndSettle(page) {
        await page.goto('/home');
        await page.waitForFunction(async () => {
            const { queryClient } = await import('/src/modules/api/api.js');
            return (
                queryClient.getQueryState(['auth', 'status'])?.status === 'success' &&
                queryClient.getQueryState(['user', 'profile'])?.status === 'success'
            );
        });
    }

    async function inject(page, { auth = true, profile = PROFILE, notifications } = {}) {
        await page.evaluate(async ({ auth, profile, notifications }) => {
            const { queryClient } = await import('/src/modules/api/api.js');
            queryClient.setQueryData(['auth', 'status'], auth);
            queryClient.setQueryData(['user', 'profile'], profile);
            if (notifications) queryClient.setQueryData(['notifications', profile.$id], notifications);
        }, { auth, profile, notifications });
    }

    test('shows the bell for a registered user, with nothing to show', async ({ page }) => {
        rows = [];
        await bootAndSettle(page);
        await inject(page, { notifications: [] });

        await expect(page.getByTestId('notification-bell')).toBeVisible();
        await expect(page.getByTestId('notification-badge')).toHaveCount(0);
        await expect(page.getByTestId('notification-panel')).toHaveCount(0);
    });

    test('opens the inbox by itself when a notification arrives, without a reload', async ({ page }) => {
        rows = [];
        await bootAndSettle(page);
        await inject(page, { notifications: [] });

        await expect(page.getByTestId('notification-bell')).toBeVisible();
        await expect(page.getByTestId('notification-panel')).toHaveCount(0);

        // A friend answers: the server-side row appears.
        rows = [NOTIFICATIONS[0]];

        // No reload and NO click: the inbox opens by itself and lists the
        // answer, linking to the friend's profile.
        await expect(page.getByTestId('notification-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId('notification-item')).toHaveCount(1);
        // The link is an IN-APP link, so it points at the host the page is
        // served from, never at a hard-coded apex: a cross-origin navigation
        // is what a webview wrapper refuses, and it silently teleports a
        // staging/preview visitor to production.
        const origin = new URL(page.url()).origin;
        await expect(page.getByTestId('notification-link').first()).toHaveAttribute(
            'href',
            `${origin}/sam123`
        );
        await expect(page.getByTestId('notification-deadline')).toHaveCount(1);
        await expect(page.getByTestId('notification-timestamp').first()).not.toBeEmpty();

        // The inbox is on screen, so the notification counts as viewed: the
        // badge clears (the mark-read PATCH flips read_at in the stub).
        await expect(page.getByTestId('notification-badge')).toHaveCount(0);
    });

    test('lists the notifications of an inbox that was already waiting', async ({ page }) => {
        // The rows arrived while the app was closed: the learner comes back to
        // an inbox that opens by itself.
        rows = NOTIFICATIONS.map((r) => ({ ...r }));
        await bootAndSettle(page);
        await inject(page, { notifications: NOTIFICATIONS });

        await expect(page.getByTestId('notification-panel')).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId('notification-item')).toHaveCount(2);
        // The link is an IN-APP link, so it points at the host the page is
        // served from, never at a hard-coded apex: a cross-origin navigation
        // is what a webview wrapper refuses, and it silently teleports a
        // staging/preview visitor to production.
        const origin = new URL(page.url()).origin;
        await expect(page.getByTestId('notification-link').first()).toHaveAttribute(
            'href',
            `${origin}/sam123`
        );
    });

    test('shows no bell for a logged-out guest', async ({ page }) => {
        await bootAndSettle(page);
        await expect(page.getByTestId('notification-bell')).toHaveCount(0);
    });
});
