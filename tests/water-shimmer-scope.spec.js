// @ts-check
// Story 050 — confine the water shimmer to visible water surfaces.
//
// The app shell is `<div id="root" class="video-frame water-surface ...">`. Its
// `.water-surface::before` sheen used to paint over static page content because
// it was an absolutely-positioned pseudo-element (z-index auto). Non-lesson
// pages render one opaque *static* container, so the whole page shimmered.
//
// To observe paint order deterministically (independent of the 7s animation),
// we force the pseudo-element to an opaque marker colour and read raw pixels
// back from a screenshot — decoded in-page with createImageBitmap/OffscreenCanvas
// so no PNG dependency is added.

import { test, expect } from '@playwright/test';

const MARKER_CSS = `.water-surface::before { background: rgb(255,0,255) !important; animation: none !important; }`;
const MARKER_R = 255;
const MARKER_G = 0;
const MARKER_B = 255;

/** Count pixels exactly equal to the marker colour in a screenshot clip. */
async function countMarkerPixels(page, clip) {
    const buf = await page.screenshot({ clip });
    return page.evaluate(async (bytes) => {
        const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
        const bmp = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 255) count++;
        }
        return count;
    }, [...buf]);
}

test.describe('Story 050 — water shimmer is scoped to visible water', () => {
    test.beforeEach(async ({ page }) => {
        // Below 576px `#root` fills the viewport; at wider widths `.video-frame`
        // is centred with `width: auto; aspect-ratio: 9/16`, so a fixed clip
        // could land on the black `.app-container` instead of the app frame.
        await page.setViewportSize({ width: 420, height: 900 });
    });

    test('the sheen does not paint over a non-lesson page (/)', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('share-code-input')).toBeVisible();

        // The frame fills the mobile viewport, so the clip below is inside #root.
        const rootBox = await page.locator('#root').boundingBox();
        expect(rootBox).not.toBeNull();
        expect(Math.round(rootBox.width)).toBe(420);

        await page.addStyleTag({ content: MARKER_CSS });
        await page.waitForTimeout(200);

        const markerPixels = await countMarkerPixels(page, { x: 4, y: 300, width: 12, height: 12 });
        expect(markerPixels).toBe(0);
    });

    test('the sheen is still visible on a water surface with visible blue', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('share-code-input')).toBeVisible();

        await page.addStyleTag({ content: MARKER_CSS });
        // A bare .water-surface whose blue is not covered by any content: the
        // sheen must still be visible (the glistening effect is kept). The real
        // lesson water band needs its <video> from R2, so a fixture pins the
        // retained-effect contract deterministically.
        await page.evaluate(() => {
            const fixture = document.createElement('div');
            fixture.className = 'water-surface';
            fixture.style.cssText =
                'position: fixed; left: 0; top: 0; width: 200px; height: 200px; z-index: 99999;';
            document.body.appendChild(fixture);
        });
        await page.waitForTimeout(200);

        const markerPixels = await countMarkerPixels(page, { x: 50, y: 50, width: 40, height: 40 });
        expect(markerPixels).toBeGreaterThan(0);
    });
});
