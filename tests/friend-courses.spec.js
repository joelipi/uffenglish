// @ts-check
import { test, expect } from '@playwright/test';

// Public course-listings page (story 056). `/courses` is a public route, so no
// guest modal opens. The page loads every config through Vite's lazy glob and
// lists the shareCta friend courses, excluding the test fixture.

async function cardCourseIds(page) {
    const hrefs = await page.getByTestId('friend-course-card').evaluateAll(
        (els) => els.map((el) => el.getAttribute('href'))
    );
    return hrefs.map((href) => /\/course\/([^/]+)\/lesson\//.exec(href)[1]);
}

test.describe('public course listings', () => {
    test('lists the friend courses and starts them at the first lesson', async ({ page }) => {
        await page.goto('/courses');

        await expect(page.getByTestId('friend-courses-heading')).toBeVisible();
        await expect(page.getByTestId('friend-courses-heading'))
            .toHaveText('Choose a conversation to have with your friends and practice English with them free.');

        const steps = page.getByTestId('friend-courses-steps').locator('li');
        await expect(steps).toHaveCount(2);

        await expect(page.getByTestId('friend-course-card').first()).toBeVisible();

        const hrefs = await page.getByTestId('friend-course-card').evaluateAll(
            (els) => els.map((el) => el.getAttribute('href'))
        );
        expect(hrefs).toContain('/course/friendchain/lesson/a');
        expect(hrefs).toContain('/course/wouldrather/lesson/a');
        expect(hrefs).toContain('/course/wouldyourather/lesson/a');
        for (const href of hrefs) {
            expect(href).toMatch(/^\/course\/[^/]+\/lesson\/a$/);
        }
    });

    test('excludes the test fixture and the non-friend courses', async ({ page }) => {
        await page.goto('/courses');
        await expect(page.getByTestId('friend-course-card').first()).toBeVisible();

        const ids = await cardCourseIds(page);
        for (const id of ['test', 'test-api', 'model', 't', 'gt2']) {
            expect(ids).not.toContain(id);
        }
        expect(ids).toContain('friendchain');
    });

    test('does not open the guest modal on the public route', async ({ page }) => {
        await page.goto('/courses');
        await expect(page.getByTestId('friend-courses-heading')).toBeVisible();
        await expect(page.locator('#guestLoginModal')).not.toBeVisible();
    });
});
