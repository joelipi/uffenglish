// @ts-check
import { test, expect } from '@playwright/test';

// HomeScreen's top bar is a `justify-content: space-between` flex row: hamburger,
// logo, notification bell. The logo is a ~5.3:1 wordmark pinned to a 40px
// height, so on a SHORT desktop viewport the 9:16 frame is narrow (9/16 of the
// capped viewport height) and the unshrinkable logo pushed the bell past the
// frame's right edge — `#root.video-frame` is `overflow: hidden`, so the bell
// was clipped away entirely and simply vanished.

/** Inject a signed-in viewer into the app's own query cache (see AGENTS.md). */
async function signIn(page) {
    await page.evaluate(async () => {
        const { queryClient } = await import('/src/modules/api/api.js');
        queryClient.setQueryData(['auth', 'status'], true);
        queryClient.setQueryData(['user', 'profile'], { $id: 'viewer-1' });
        queryClient.setQueryData(['notifications', 'viewer-1'], []);
    });
}

test.describe('HomeScreen bell fits the frame', () => {
    // Short desktop window: the frame is the narrowest the app ever gets while
    // still being wider than the phone layout (>=576px takes the 9:16 frame).
    test.use({ viewport: { width: 1280, height: 600 } });

    test('the notification bell stays inside the phone frame', async ({ page }) => {
        await page.goto('/home');
        await signIn(page);

        const bell = page.locator('[data-testid="notification-bell"]');
        await expect(bell).toBeVisible();

        const frame = await page.locator('.video-frame').boundingBox();
        const bellBox = await bell.boundingBox();
        expect(frame).not.toBeNull();
        expect(bellBox).not.toBeNull();
        // Visible means fully inside the clipping frame, not just "has a box".
        expect(bellBox.x).toBeGreaterThanOrEqual(frame.x - 1);
        expect(bellBox.x + bellBox.width).toBeLessThanOrEqual(frame.x + frame.width + 1);

        // The top bar itself must not overflow: `scrollWidth` only exceeds
        // `clientWidth` when a child is actually pushed past the row.
        const overflow = await page.evaluate(() => {
            const bar = document.querySelector('[data-testid="home-logo"]')?.parentElement;
            return bar ? bar.scrollWidth - bar.clientWidth : null;
        });
        expect(overflow).toBe(0);
    });

    test('the logo is the elastic child, so it shrinks before the bell does', async ({ page }) => {
        await page.goto('/home');
        await signIn(page);

        const logo = page.locator('[data-testid="home-logo"]');
        const bell = page.locator('[data-testid="notification-bell"]');
        await expect(bell).toBeVisible();

        // On this ~287px-wide frame the natural 40px-high wordmark is ~213px
        // wide, which does not leave room for the bell. The logo — the only
        // elastic child — must therefore render narrower than its intrinsic
        // size instead of pushing the bell out of the frame.
        const measured = await logo.evaluate((el) => {
            const natural = (el.naturalWidth / el.naturalHeight) * 40; // 40px height
            return { rendered: el.getBoundingClientRect().width, natural };
        });
        // More than a pixel of slack, so sub-pixel rounding of the unsqueezed
        // wordmark (rendered 213.328 vs natural 213.333) cannot pass this.
        expect(measured.rendered).toBeLessThan(measured.natural - 1);
    });
});