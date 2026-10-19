// @ts-check
import { test, expect } from '@playwright/test';

// HomeScreen's top bar is a `justify-content: space-between` flex row: hamburger,
// logo, notification bell. The logo is a ~5.3:1 wordmark, and on a SHORT desktop
// window the 9:16 frame is only 9/16 of the viewport height, so the row runs out
// of space. Two separate bugs lived here:
//   1. the unshrinkable logo pushed the bell past the frame's right edge, where
//      `#root.video-frame` (overflow: hidden) clipped it to nothing;
//   2. capping only the logo's `maxWidth` while pinning `height` squeezed the
//      wordmark out of proportion, so the logo has to be clamped on BOTH axes
//      with `auto` width/height (which keeps the intrinsic ratio).

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
    // 500px-tall desktop window: the 9:16 frame is ~281px wide, the narrowest
    // the app gets on a non-phone viewport. 37.8 (hamburger) + 213 (logo) + 35
    // (bell) does not fit, so the row has to actually give somewhere.
    test.use({ viewport: { width: 1280, height: 500 } });

    test('the notification bell stays inside the phone frame', async ({ page }) => {
        await page.goto('/home');
        await signIn(page);

        const bell = page.locator('[data-testid="notification-bell"]');
        await expect(bell).toBeVisible();

        const frame = await page.locator('.video-frame').boundingBox();
        const bellBox = await bell.boundingBox();
        expect(frame).not.toBeNull();
        expect(bellBox).not.toBeNull();
        // "Visible" must mean fully inside the clipping frame, not merely that
        // the element has a box (a clipped element still reports one).
        expect(bellBox.x).toBeGreaterThanOrEqual(frame.x - 1);
        expect(bellBox.x + bellBox.width).toBeLessThanOrEqual(frame.x + frame.width + 1);

        // The top bar must not overflow: scrollWidth only exceeds clientWidth
        // when a child is actually pushed past the row's right edge.
        const overflow = await page.evaluate(() => {
            const bar = document.querySelector('[data-testid="home-logo"]')?.parentElement;
            return bar ? bar.scrollWidth - bar.clientWidth : null;
        });
        expect(overflow).toBe(0);
    });

    test('the logo is the elastic child and keeps its intrinsic aspect ratio', async ({ page }) => {
        await page.goto('/home');
        await signIn(page);

        const logo = page.locator('[data-testid="home-logo"]');
        await expect(page.locator('[data-testid="notification-bell"]')).toBeVisible();

        const measured = await logo.evaluate((el) => {
            const naturalRatio = el.naturalWidth / el.naturalHeight;
            const box = el.getBoundingClientRect();
            return {
                naturalWidthAtHeight40: (el.naturalWidth / el.naturalHeight) * 40,
                renderedWidth: box.width,
                ratioSkew: (box.width / box.height) / naturalRatio,
            };
        });
        // More than a pixel of slack, so sub-pixel rounding of the unsqueezed
        // wordmark (213.328 rendered vs 213.333 natural) cannot pass this.
        expect(measured.renderedWidth).toBeLessThan(measured.naturalWidthAtHeight40 - 1);
        // A `maxWidth`-only clamp with a pinned `height` renders 124x40 here,
        // i.e. a 1.4x skew; the logo must stay proportional to the source file.
        expect(measured.ratioSkew).toBeGreaterThan(0.98);
        expect(measured.ratioSkew).toBeLessThan(1.02);
    });
});