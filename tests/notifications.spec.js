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
        course_id: 'friend',
        lesson_id: 'b',
        payload: { actorShareCode: 'sam123', actorName: 'Sam' },
        created_at: '2026-09-24T11:00:00.000Z',
        read_at: null,
    },
    {
        id: 'n2',
        type: 'friend_response',
        course_id: 'friend',
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

    async function closeGuestModalIfOpen(page) {
        await page.evaluate(() => {
            const dialog = document.getElementById('guestLoginModal');
            if (dialog && dialog.open) dialog.close();
        });
    }

    test('shows the unread badge for a registered user', async ({ page }) => {
        await bootAndSettle(page);
        await inject(page, { notifications: NOTIFICATIONS });

        await expect(page.getByTestId('notification-bell')).toBeVisible();
        await expect(page.getByTestId('notification-badge')).toHaveText('1');
    });

    test('lists the notifications, links to the friend profile, and clears the badge on open', async ({ page }) => {
        await bootAndSettle(page);
        await inject(page, { notifications: NOTIFICATIONS });

        await closeGuestModalIfOpen(page);
        await expect(page.getByTestId('notification-badge')).toHaveText('1');
        await page.getByTestId('notification-bell').click();

        await expect(page.getByTestId('notification-panel')).toBeVisible();
        await expect(page.getByTestId('notification-item')).toHaveCount(2);
        await expect(page.getByTestId('notification-link').first()).toHaveAttribute(
            'href',
            'https://ultrafastfluency.com/sam123'
        );
        await expect(page.getByTestId('notification-deadline')).toHaveCount(2);
        await expect(page.getByTestId('notification-timestamp').first()).not.toBeEmpty();

        // Mark-read PATCH + stateful refetch: badge clears, rows remain listed.
        await expect(page.getByTestId('notification-badge')).toHaveCount(0);
        await expect(page.getByTestId('notification-item')).toHaveCount(2);
    });

    test('shows the bell with no badge when the inbox is empty', async ({ page }) => {
        await bootAndSettle(page);
        await inject(page, { notifications: [] });

        await expect(page.getByTestId('notification-bell')).toBeVisible();
        await expect(page.getByTestId('notification-badge')).toHaveCount(0);
    });

    test('shows no bell for a logged-out guest', async ({ page }) => {
        await bootAndSettle(page);
        await expect(page.getByTestId('notification-bell')).toHaveCount(0);
    });
});
