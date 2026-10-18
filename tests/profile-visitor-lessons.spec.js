// @ts-check
import { test, expect } from '@playwright/test';

// Public-profile visitor awareness (story 064). Logged-out visitors see only
// chain-head (`a`) links plus the login/guest banner; a logged-in visitor with
// overlapping history sees featuring lessons first with a completed-together
// badge. Same fixture pattern as friend-lesson-link.spec.js: settle the
// owner's initial query, inject fixtures through the app's queryClient
// singleton, fix the clock so the 48h countdown is deterministic. Viewer
// profile, auth status and inbox are injected the same way.

const FIXED_NOW = '2026-09-24T12:00:00.000Z';
// Must satisfy isShareCodeSegment: the owner is opened as the /:shareCode
// path segment, which renders the 404 page for a malformed code.
const OWNER = 'wg7d';
const VIEWER = 'viewer1';

const OWNER_PROFILE = {
    id: 'u1',
    first_name: 'Owner',
    last_name: 'User',
    native_language: 'EN',
    english_level: 'B1',
    join_date: '2026-01-01T00:00:00Z',
    share_code: OWNER,
    profile_picture_url: null,
    completed_dates: [],
    lessons_completed: 3,
};

const entry = (recordedLessonId, lessonId, lessonTitle, addedAt) => ({
    courseId: 'friendchain', courseName: 'Friend Chain',
    recordedLessonId, lessonId, lessonTitle, shareCode: OWNER, addedAt,
});

const LINKS = {
    'friendchain:a': entry('a', 'b', 'Ask', '2026-09-24T11:00:00.000Z'),
    'friendchain:c': entry('c', 'd', 'Follow Up', '2026-09-24T10:00:00.000Z'),
};

async function seedOwner(page, friendLinks) {
    await page.goto(`/${OWNER}`);
    await expect(page.getByText('User not found')).toBeVisible();
    await page.evaluate(async ({ key, profile }) => {
        const { queryClient } = await import('/src/modules/api/api.js');
        queryClient.setQueryData(['user', 'profile', 'shareCode', key], profile);
    }, { key: OWNER, profile: { ...OWNER_PROFILE, friendLinks } });
}

async function seedViewer(page, { countedLessons = [], inbox = [] } = {}) {
    await page.evaluate(async ({ viewer, authed, counted, rows }) => {
        const { queryClient } = await import('/src/modules/api/api.js');
        queryClient.setQueryData(['auth', 'status'], authed);
        queryClient.setQueryData(['user', 'profile'], {
            $id: viewer,
            shareCode: viewer,
            counted_lessons: counted,
            native_language: 'EN',
        });
        queryClient.setQueryData(['notifications', viewer], rows);
    }, {
        viewer: VIEWER,
        authed: true,
        counted: countedLessons,
        rows: inbox,
    });
}

const inboxRow = (lessonId) => ({
    id: `n-${lessonId}`,
    type: 'friend_response',
    course_id: 'friendchain',
    lesson_id: lessonId,
    payload: { actorShareCode: OWNER },
    created_at: '2026-09-24T11:30:00.000Z',
    read_at: null,
});

test.describe('public-profile visitor awareness', () => {
    test.beforeEach(async ({ page }) => {
        await page.clock.setFixedTime(new Date(FIXED_NOW));
        await page.route('**/rest/v1/**', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        );
    });

    test('logged-out visitor sees only the chain-head link plus the banner', async ({ page }) => {
        await seedOwner(page, LINKS);

        const links = page.getByTestId('friend-lesson-link');
        await expect(links).toHaveCount(1);
        await expect(links.nth(0)).toHaveText('Ask');

        await expect(page.getByTestId('visitor-login-banner')).toBeVisible();
        await expect(page.getByTestId('visitor-login-link')).toHaveText(
            "Log in to see lessons you've done together."
        );
        await expect(page.getByTestId('visitor-login-link')).toHaveAttribute(
            'href', `/login?redirect=${encodeURIComponent(`/${OWNER}`)}`
        );
        await expect(page.getByTestId('visitor-guest-link')).toHaveText(
            'No account yet? You can start practicing free.'
        );
        await expect(page.getByTestId('visitor-guest-link')).toHaveAttribute('href', '#friend-lesson-links');
        await expect(page.getByTestId('friend-lesson-link-completed')).toHaveCount(0);
    });

    test('logged-in visitor sees featuring lessons first, badged when done together', async ({ page }) => {
        await seedOwner(page, LINKS);
        await seedViewer(page, {
            countedLessons: ['friendchain_c'],
            inbox: [inboxRow('c')],
        });

        // Featuring entry (c: inbox + counted) ahead of the chain head (a).
        const links = page.getByTestId('friend-lesson-link');
        await expect(links).toHaveCount(2);
        await expect(links.nth(0)).toHaveText('Follow Up');
        await expect(links.nth(1)).toHaveText('Ask');

        const badges = page.getByTestId('friend-lesson-link-completed');
        await expect(badges).toHaveCount(1);
        await expect(badges.nth(0)).toHaveText('You did this together');

        await expect(page.getByTestId('visitor-login-banner')).toHaveCount(0);
    });

    test('logged-in visitor with no overlap sees the chain-head list and no banner', async ({ page }) => {
        await seedOwner(page, LINKS);
        await seedViewer(page, { countedLessons: [], inbox: [] });

        const links = page.getByTestId('friend-lesson-link');
        await expect(links).toHaveCount(1);
        await expect(links.nth(0)).toHaveText('Ask');
        await expect(page.getByTestId('visitor-login-banner')).toHaveCount(0);
        await expect(page.getByTestId('friend-lesson-link-completed')).toHaveCount(0);
    });
});
