// @ts-check
import { test, expect } from '@playwright/test';
import {
    collectConsole,
    blockSentinelAutoplay,
    confirmGuestLanguage,
    waitForLessonReady,
} from './helpers/lesson-e2e.js';

// Lesson top bar: the notification bell sits with the trophy/streak icons.
const LESSON_URL = '/course/model/lesson/m-g';

test.describe('Lesson top bar bell', () => {
    let observed = { errors: [], transitionWarnings: [] };

    test.beforeEach(async ({ page }) => {
        observed = collectConsole(page);
        await blockSentinelAutoplay(page);
    });

    async function setupLesson(page, { loggedIn = false } = {}) {
        await page.goto(LESSON_URL);
        await confirmGuestLanguage(page);
        await waitForLessonReady(page, 'm-g');
        await page.evaluate((loggedIn) => {
            const s = window.appStore.getState();
            s.setGuestModalOpen(false);
            s.setGuestModalShownThisSession(true);
            if (loggedIn) {
                window.appStore.setState({
                    isLoggedIn: true,
                    userData: { native_language: 'en', auth_method: 'supabase', $id: 'test-user' },
                });
            }
        }, loggedIn);
    }

    test('logged-in lesson shows bell inline with trophy and streak', async ({ page }) => {
        await setupLesson(page, { loggedIn: true });

        const bell = page.locator('[data-testid="notification-bell"]');
        await expect(bell).toBeVisible();
        const bellIcon = bell.locator('i');
        await expect(bellIcon).toHaveClass(/bi-bell-fill/);

        // Same size as the stats icons (1.1rem) and on the same line: the
        // three icons' vertical bands all overlap.
        const trophy = page.locator('.bi-trophy-fill');
        const fire = page.locator('.bi-fire');
        const [tBox, fBox, bBox] = await Promise.all([
            trophy.boundingBox(), fire.boundingBox(), bellIcon.boundingBox(),
        ]);
        for (const box of [tBox, fBox, bBox]) expect(box).not.toBeNull();
        const bandsOverlap = (a, b) => a.y < b.y + b.height && b.y < a.y + a.height;
        expect(bandsOverlap(tBox, bBox)).toBe(true);
        expect(bandsOverlap(fBox, bBox)).toBe(true);
        // Same icon size: identical computed font-size on all three icons
        // (box heights differ by line-height context, not glyph size).
        const fontSizeOf = (locator) => locator.evaluate((el) => getComputedStyle(el).fontSize);
        expect(await fontSizeOf(bellIcon)).toBe(await fontSizeOf(page.locator('.bi-trophy-fill')));
        expect(await fontSizeOf(bellIcon)).toBe(await fontSizeOf(page.locator('.bi-fire')));

        expect(observed.errors).toEqual([]);
    });

    test('guest lesson shows no bell', async ({ page }) => {
        await setupLesson(page, { loggedIn: false });

        await expect(page.locator('[data-testid="notification-bell"]')).toHaveCount(0);
        await expect(page.locator('.bi-trophy-fill')).toBeVisible();

        expect(observed.errors).toEqual([]);
    });
});
