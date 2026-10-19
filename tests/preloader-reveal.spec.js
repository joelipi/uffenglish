import { test, expect } from '@playwright/test';

/**
 * The preloader reveal gate (index.html).
 *
 * The brand fonts load non-render-blocking so the Whisper model download can
 * start early, which means the first paint can land before the webfonts do.
 * Rather than show the fallback stack and swap, the preloader cover is held
 * until the first-paint faces resolve — hard-capped, because a slow or blocked
 * font CDN must never hold the app.
 *
 * These are timing/integration properties (an inline script, document.fonts and
 * a CSS animation) that no unit test can cover, so they are asserted in a real
 * browser. Note the clock is deliberately NOT faked here: the gate runs on real
 * timers, and freezing them would stop it from ever revealing.
 */

// The gate's CAP_MS is 2000; allow slack for a loaded CI box.
const CAP_MS = 2000;
const REVEAL_BUDGET_MS = CAP_MS + 1500;

test.describe('preloader reveal gate', () => {
    test('covers the first paint, then reveals without interaction', async ({ page }) => {
        await page.goto('/');

        // Assert the pre-reveal state via the class rather than visibility:
        // `toBeVisible()` before awaiting goto could attach after the class was
        // added on a fast reveal and flake.
        const revealing = await page.evaluate(() =>
            document.documentElement.classList.contains('app-ready')
        );
        expect(revealing, 'cover was already lifted at first paint').toBe(false);

        await expect(page.locator('#appLoadingImageDiv')).toBeHidden({
            timeout: REVEAL_BUDGET_MS,
        });
    });

    test('reveals within the cap when the font CDN never responds', async ({ page }) => {
        // The property that matters most on a phone: a blocked or hanging font
        // CDN must not strand the user behind an image.
        await page.route('**://fonts.googleapis.com/**', (route) => route.abort());
        await page.route('**://fonts.gstatic.com/**', (route) => route.abort());

        // Record when the cover actually lifted, relative to navigation start.
        // Measured inside the page rather than around page.goto(), which on a
        // cold dev server can itself take ~1s and would eat the budget.
        await page.addInitScript(() => {
            window.__navAt = performance.now();
            window.__revealAt = null;
            const obs = new MutationObserver(() => {
                if (document.documentElement.classList.contains('app-ready') && window.__revealAt === null) {
                    window.__revealAt = performance.now();
                }
            });
            document.addEventListener('readystatechange', () => {
                obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
            });
        });

        await page.goto('/');
        await expect(page.locator('#appLoadingImageDiv')).toBeHidden({
            timeout: REVEAL_BUDGET_MS,
        });

        const elapsed = await page.evaluate(() => window.__revealAt - window.__navAt);
        console.log('REVEALED_AFTER ' + Math.round(elapsed) + 'ms');
        // Not merely "eventually": it must not have had to wait out the 4s CSS
        // failsafe, so this is the JS cap doing the work.
        expect(elapsed).toBeLessThan(CAP_MS + 1000);
    });

    test('the cover is the large brand preloader image', async ({ page }) => {
        await page.goto('/');
        const image = page.locator('.appLoadingImage');
        await expect(image).toHaveCSS('background-image', /u-f-f\.png/);

        // The stylesheet sizes it `80vw x 80vh` with an 800px cap, so on a
        // desktop viewport it saturates at the cap in one axis and scales in
        // the other. Assert the CSS-derived size exactly rather than a hard
        // pixel floor — the default viewport is 1280x720, so the height is
        // 80vh = 576, not 700.
        const box = await image.boundingBox();
        const viewport = page.viewportSize();
        expect(box.width).toBe(Math.min(viewport.width * 0.8, 800));
        expect(box.height).toBe(Math.min(viewport.height * 0.8, 800));

        // …and it is genuinely a large cover, not a spinner. On the default
        // 1280x720 viewport the 800px cap clamps the width while the height
        // stays at 80vh, giving exactly half the viewport.
        const covered = (box.width * box.height) / (viewport.width * viewport.height);
        expect(covered).toBeGreaterThanOrEqual(0.5);
    });

    test('the reveal does not depend on the app finishing a lesson load', async ({ page }) => {
        // The gate must be about fonts and first paint only — it must not wait
        // on lesson media, or the user would sit behind the image for the whole
        // lesson preload. Revealing at all (above) on a bare "/" already proves
        // this; assert the cap holds even with every other asset failing.
        await page.route('**/assets/videos/**', (route) => route.abort());
        await page.route('**/whisper/**', (route) => route.abort());
        await page.goto('/');
        await expect(page.locator('#appLoadingImageDiv')).toBeHidden({
            timeout: REVEAL_BUDGET_MS,
        });
    });
});
