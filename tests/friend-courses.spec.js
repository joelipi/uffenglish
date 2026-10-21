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
        expect(hrefs).toContain('/course/wouldyourather/lesson/a');
        for (const href of hrefs) {
            expect(href).toMatch(/^\/course\/[^/]+\/lesson\/a$/);
        }
    });

    test('excludes the test fixture and the non-friend courses', async ({ page }) => {
        await page.goto('/courses');
        await expect(page.getByTestId('friend-course-card').first()).toBeVisible();

        const ids = await cardCourseIds(page);
        for (const id of ['wouldyourather-test', 'model']) {
            expect(ids).not.toContain(id);
        }
        expect(ids).toContain('wouldyourather');
    });

    test('does not open the guest modal on the public route', async ({ page }) => {
        await page.goto('/courses');
        await expect(page.getByTestId('friend-courses-heading')).toBeVisible();
        await expect(page.locator('#guestLoginModal')).not.toBeVisible();
    });

    test('the course list scrolls and the way out stays reachable (story 063)', async ({ page }) => {
        // The list lives in a scroll region. The course card carries a hero
        // image, so it is taller than the region: the list must scroll.
        //
        // The page has no back button of its own any more — the app shell's
        // header (outside the scroll region) is the way out, so it has to stay
        // visible while the list is scrolled.
        await page.setViewportSize({ width: 390, height: 600 });
        await page.goto('/courses');

        await expect(page.getByTestId('friend-course-card').first()).toBeVisible();

        const scroll = page.getByTestId('friend-courses-scroll');
        const box = await scroll.evaluate((el) => ({
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
        }));
        expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);

        await scroll.hover();
        await page.mouse.wheel(0, 1000);
        await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

        // The header is outside the scroll region, so the way out never scrolls
        // away with the list.
        await expect(page.getByTestId('app-header')).toBeVisible();
    });
});
