// @ts-check
import { test, expect } from '@playwright/test';
import { confirmGuestLanguage } from './helpers/lesson-e2e.js';

// A DEAD LINK on the lesson route: the course was retired, or the lesson id
// is gone from the regenerated course config. The answer must be the app's
// real not-found page ("the link may no longer be active", with the course
// list and the homepage as ways out) — NOT the critical-error screen, whose
// "check your internet connection" message sends the visitor hunting for a
// network problem that does not exist.
//
// The critical-error screen used to be the only answer, which is what a
// visitor clicking a stale friend link on a profile saw.

const DEAD_COURSE = 'no-such-course';
const LIVE_COURSE = 'wouldyourather-test';

test.describe('dead lesson links', () => {
    test('a course that no longer exists shows the not-found page', async ({ page }) => {
        await page.goto(`/course/${DEAD_COURSE}/lesson/b?shareCode=k9gy`);

        // The guest modal sits over the page; the config never arrives for a
        // course that is gone, so the shared helper (which waits for it) cannot
        // be used here.
        const dismiss = page.locator('#guestEnglishOnlyBtn');
        if (await dismiss.count()) {
            await dismiss.click().catch(() => {});
        }
        await page.locator('#guestContinueBtn').waitFor({ state: 'visible', timeout: 5000 })
            .then((btn) => btn.click()).catch(() => {});

        const notFound = page.getByTestId('not-found-route');
        await expect(notFound).toBeVisible({ timeout: 20000 });
        await expect(page.getByTestId('not-found-heading')).toHaveText('Page not found');
        await expect(page.getByTestId('not-found-body')).toContainText('no longer active');

        // The critical-error screen must not be on top of it: it blames the
        // visitor's connection, which is not what went wrong.
        await expect(page.locator('#criticalErrorContainer')).toHaveCount(0);
        await expect(page.getByText('Lesson Load Error')).toHaveCount(0);
    });

    test('a lesson that is gone from the course shows the not-found page', async ({ page }) => {
        await page.goto(`/course/${LIVE_COURSE}/lesson/zz-not-a-lesson?shareCode=k9gy`);

        // The config loads here, so the shared helper can clear the gate.
        await confirmGuestLanguage(page);

        const notFound = page.getByTestId('not-found-route');
        await expect(notFound).toBeVisible({ timeout: 20000 });
        await expect(page.getByTestId('not-found-heading')).toHaveText('Page not found');
        await expect(page.locator('#criticalErrorContainer')).toHaveCount(0);
        await expect(page.getByText('Lesson Load Error')).toHaveCount(0);
    });

    test('the not-found page offers the course list and the homepage', async ({ page }) => {
        await page.goto(`/course/${DEAD_COURSE}/lesson/b`);
        await expect(page.getByTestId('not-found-courses-link')).toHaveAttribute('href', '/courses');
        await expect(page.getByTestId('not-found-home-link')).toHaveAttribute('href', '/');
    });

    test('a live lesson is not mistaken for a dead link', async ({ page }) => {
        await page.goto(`/course/${LIVE_COURSE}/lesson/a`);
        await confirmGuestLanguage(page);
        await expect(page.getByTestId('not-found-route')).toHaveCount(0);
        await expect(page.locator('#criticalErrorContainer')).toHaveCount(0);
    });
});
