// @ts-check
import { test, expect } from '@playwright/test';
import {
    collectConsole,
    blockSentinelAutoplay,
    confirmGuestLanguage,
    waitForLessonReady,
} from './helpers/lesson-e2e.js';

// Lesson top bar: the notification bell sits with the streak icon.
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

    test('logged-in lesson shows the bell inline with the streak', async ({ page }) => {
        await setupLesson(page, { loggedIn: true });

        const bell = page.locator('[data-testid="notification-bell"]');
        await expect(bell).toBeVisible();
        const bellIcon = bell.locator('i');
        await expect(bellIcon).toHaveClass(/bi-bell-fill/);

        // The trophy + total-days counter is gone from the lesson top bar.
        await expect(page.locator('.bi-trophy-fill')).toHaveCount(0);
        await expect(page.locator('#dayCountSpan')).toHaveCount(0);

        // The bell sits on the same line as the streak icon: their vertical
        // bands overlap and both render at the stats icon size (1.1rem).
        const fire = page.locator('.bi-fire');
        const [fBox, bBox] = await Promise.all([fire.boundingBox(), bellIcon.boundingBox()]);
        for (const box of [fBox, bBox]) expect(box).not.toBeNull();
        const bandsOverlap = (a, b) => a.y < b.y + b.height && b.y < a.y + a.height;
        expect(bandsOverlap(fBox, bBox)).toBe(true);
        const fontSizeOf = (locator) => locator.evaluate((el) => getComputedStyle(el).fontSize);
        expect(await fontSizeOf(bellIcon)).toBe(await fontSizeOf(fire));

        expect(observed.errors).toEqual([]);
    });

    test('guest lesson shows no bell', async ({ page }) => {
        await setupLesson(page, { loggedIn: false });

        await expect(page.locator('[data-testid="notification-bell"]')).toHaveCount(0);
        await expect(page.locator('.bi-fire')).toBeVisible();
        await expect(page.locator('.bi-trophy-fill')).toHaveCount(0);

        expect(observed.errors).toEqual([]);
    });
});

test.describe('narrow frame panel fit', () => {
    // Short viewport -> narrow 9:16 frame (~281px): the 320px panel used to
    // overflow the frame's left edge and get clipped by overflow: hidden.
    test.use({ viewport: { width: 800, height: 500 } });

    let narrowObserved = { errors: [], transitionWarnings: [] };

    test.beforeEach(async ({ page }) => {
        narrowObserved = collectConsole(page);
        await blockSentinelAutoplay(page);
    });

    test('open panel stays fully inside the frame', async ({ page }) => {
        await page.goto(LESSON_URL);
        await confirmGuestLanguage(page);
        await waitForLessonReady(page, 'm-g');
        await page.evaluate(() => {
            const s = window.appStore.getState();
            s.setGuestModalOpen(false);
            s.setGuestModalShownThisSession(true);
            window.appStore.setState({
                isLoggedIn: true,
                userData: { native_language: 'en', auth_method: 'supabase', $id: 'test-user' },
            });
        });

        await page.locator('[data-testid="notification-bell"]').click({ force: true });
        const panel = page.locator('[data-testid="notification-panel"]');
        await expect(panel).toBeVisible();

        const frame = await page.locator('.video-frame').boundingBox();
        const box = await panel.boundingBox();
        expect(frame).not.toBeNull();
        expect(box).not.toBeNull();
        expect(box.x).toBeGreaterThanOrEqual(frame.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 1);

        expect(narrowObserved.errors).toEqual([]);
    });
});
