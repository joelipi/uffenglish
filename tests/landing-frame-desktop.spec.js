// @ts-check
import { test, expect } from '@playwright/test';

// Desktop landing page layout regression.
//
// The desktop landing page is the ONE route that lifts the 9:16 phone frame: it
// renders full-bleed and owns its own internal scroll
// (`#root:has(> .uff-home-bs)` in home-landing.css sets the frame to
// `height: 100dvh; width: 100%`, and the `.uff-home-bs` shell scrolls).
//
// Capping the frame height for "screen real estate" on desktop (e.g.
// `max-height: 85vh` on `.video-frame`) silently broke exactly that: the shell
// stayed 100dvh tall inside a shorter clipping frame, so
//   * the document showed the frame as a band above and below, and
//   * the bottom of the page — the footer with Privacy Policy / Terms of
//     Service — was cut off behind the frame edge.
// These tests pin the geometry so that regression cannot come back silently.

test.describe('desktop landing page frame', () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    test('the frame fills the viewport: no bars, nothing clipped', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.uff-home-bs')).toBeVisible();

        const frame = await page.locator('#root').boundingBox();
        const size = page.viewportSize();
        expect(frame).not.toBeNull();
        expect(size).not.toBeNull();
        // A gap above or below is the band the whole page used to sit in.
        expect(frame.y).toBeLessThanOrEqual(1);
        expect(frame.height).toBeGreaterThanOrEqual(size.height - 1);
    });

    test('the exposed container paints black, not the preloader gradient', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.uff-home-bs')).toBeVisible();

        // index.html paints the preloader gradient onto .app-container for the
        // first frame; app.css sets its background-COLOR to #000 but used to
        // leave the gradient image in place underneath, so any exposed strip
        // came out blue.
        const bg = await page.evaluate(() => {
            const cs = getComputedStyle(document.querySelector('.app-container'));
            return { color: cs.backgroundColor, image: cs.backgroundImage };
        });
        expect(bg.image).toBe('none');
        expect(bg.color).toBe('rgb(0, 0, 0)');
    });

    test('the page scrolls in one place and the footer policy links are reachable', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.uff-home-bs')).toBeVisible();

        // Exactly one scroller: the shell. If the document itself scrolls as
        // well the page behaves like a page inside a scrolled iframe.
        const scrollers = await page.evaluate(() => {
            const doc = document.documentElement;
            return {
                docScrolls: doc.scrollHeight > doc.clientHeight,
                shellScrolls: (() => {
                    const s = document.querySelector('.uff-home-bs');
                    return s.scrollHeight > s.clientHeight;
                })(),
            };
        });
        expect(scrollers.docScrolls).toBe(false);
        expect(scrollers.shellScrolls).toBe(true);

        // Scroll it like a user does (assigning scrollTop is not enough — the
        // shell is inside a flex column with a sticky navbar). Wheel until the
        // shell stops moving rather than assuming a fixed number of steps.
        const atBottom = () => page.evaluate(() => {
            const s = document.querySelector('.uff-home-bs');
            return s.scrollTop >= s.scrollHeight - s.clientHeight - 1;
        });
        for (let i = 0; i < 10 && !(await atBottom()); i++) {
            await page.mouse.wheel(0, 900);
            await page.waitForTimeout(150);
        }
        expect(await atBottom()).toBe(true);

        const links = await page.evaluate(() => {
            const h = window.innerHeight;
            return [...document.querySelectorAll('.uff-footer a')].map((a) => {
                const r = a.getBoundingClientRect();
                return { text: a.textContent.trim(), top: r.top, bottom: r.bottom, inViewport: r.top >= 0 && r.bottom <= h };
            });
        });
        expect(links.length).toBeGreaterThan(0);
        expect(links.map((l) => l.text)).toContain('Privacy Policy');
        expect(links.map((l) => l.text)).toContain('Terms of Service');
        // The reported symptom: the footer links sat below the frame's bottom
        // edge, permanently hidden behind the clipping frame.
        for (const link of links) expect(link.inViewport).toBe(true);
    });
});