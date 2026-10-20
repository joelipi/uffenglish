// @ts-check
// Browser-real coverage for the mobile landscape recording warning.
// Uses explicit context options (not the whole device descriptor) so
// `defaultBrowserType` never leaks into `test.use`.
import { test, expect, devices } from '@playwright/test';
import { confirmGuestLanguage } from './helpers/lesson-e2e.js';

const LESSON_G = '/course/model/lesson/m-g';
const IPHONE_UA = devices['iPhone 13'].userAgent;
const LANDSCAPE = { width: 844, height: 390 };
const PORTRAIT = { width: 390, height: 844 };
const ROTATE_EN =
    'Recording in landscape will mess up your video. Rotate your device to portrait before you record.';

const waitForLesson = (page) =>
    page.waitForFunction(() => window.appStore?.getState()?.configData, null, { timeout: 30000 });

test.describe('mobile landscape warning', () => {
    test.use({
        userAgent: IPHONE_UA,
        isMobile: true,
        hasTouch: true,
        viewport: LANDSCAPE,
    });

    test('shows the warning with the localized copy in landscape', async ({ page }) => {
        await page.goto(LESSON_G);
        await confirmGuestLanguage(page);

        const warning = page.locator('#landscape-warning');
        await expect(warning).toBeVisible({ timeout: 30000 });
        await expect(page.locator('.landscape-warning-text')).toHaveText(ROTATE_EN);
    });

    test('dismiss hides the warning', async ({ page }) => {
        await page.goto(LESSON_G);
        await confirmGuestLanguage(page);

        const warning = page.locator('#landscape-warning');
        await expect(warning).toBeVisible({ timeout: 30000 });

        await page.locator('#landscape-warning-dismiss').click();
        await expect(warning).toBeHidden();
    });

    test('warns again after portrait then landscape', async ({ page }) => {
        await page.goto(LESSON_G);
        await confirmGuestLanguage(page);

        const warning = page.locator('#landscape-warning');
        await expect(warning).toBeVisible({ timeout: 30000 });

        await page.locator('#landscape-warning-dismiss').click();
        await expect(warning).toBeHidden();

        await page.setViewportSize(PORTRAIT);
        await expect(warning).toBeHidden();

        await page.setViewportSize(LANDSCAPE);
        await expect(warning).toBeVisible();
    });

    test('does not show in portrait', async ({ page }) => {
        await page.setViewportSize(PORTRAIT);
        await page.goto(LESSON_G);
        await confirmGuestLanguage(page);
        await waitForLesson(page);

        await expect(page.locator('#landscape-warning')).toHaveCount(0);
    });
});

test.describe('desktop landscape never warns', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('does not show for a desktop UA in landscape', async ({ page }) => {
        await page.goto(LESSON_G);
        await confirmGuestLanguage(page);
        await waitForLesson(page);

        await expect(page.locator('#landscape-warning')).toHaveCount(0);
    });
});
