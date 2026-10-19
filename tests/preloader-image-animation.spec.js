import { test, expect } from '@playwright/test';

/**
 * The preloader image animation.
 *
 * Two phases, not one fixed-length timeline: `preloaderImageIn` grows and fades
 * the image in on mount, and `preloaderImageOut` fades it out when the reveal
 * gate fires. The exit has to be triggered by the reveal — a single fixed-length
 * animation was cut off by `display: none` while still holding opacity 1, so
 * the image popped away instead of fading.
 *
 * The timeline is sampled on a **fresh probe element** carrying the same class,
 * not the live one. `display: none` cancels CSS animations and the gate hides the
 * real overlay as soon as the exit finishes, so whether the live element still
 * has a running animation depends on load timing — that made live-element
 * sampling fail roughly half the time. A newly inserted element always gets a
 * fresh animation starting at 0.
 */

const makeProbe = (page) =>
    page.evaluateHandle(() => {
        const el = document.createElement('div');
        el.className = 'appLoadingImage';
        document.body.appendChild(el);
        return el;
    });

/** Opacity + scale of the probe at a given animation time. */
const sampleAt = (handle, ms, animationName) =>
    handle.evaluate((el, [time, name]) => {
        const anim = el.getAnimations().find((a) => a.animationName === name);
        if (!anim) throw new Error(`${name} is not running on the probe`);
        anim.pause();
        anim.currentTime = time;
        const cs = getComputedStyle(el);
        // Under prefers-reduced-motion there is no transform at all, so
        // `transform` is the string 'none' and DOMMatrixReadOnly may reject it.
        const scale = cs.transform && cs.transform !== 'none'
            ? Number(new DOMMatrixReadOnly(cs.transform).a.toFixed(3))
            : 1;
        return {
            opacity: Number(Number(cs.opacity).toFixed(3)),
            scale,
        };
    }, [ms, animationName]);

test.describe('preloader image animation', () => {
    test('grows and fades in on mount', async ({ page }) => {
        await page.goto('/');
        const probe = await makeProbe(page);

        const at0 = await sampleAt(probe, 0, 'preloaderImageIn');
        const end = await sampleAt(probe, 350, 'preloaderImageIn');
        console.log('IN ' + JSON.stringify({ at0, end }));

        // Opens invisible and scaled down …
        expect(at0.opacity).toBeLessThan(0.1);
        expect(at0.scale).toBeLessThan(0.9);
        // … and arrives fully opaque at full size, holding there.
        expect(end.opacity).toBeGreaterThan(0.95);
        expect(end.scale).toBeCloseTo(1, 2);
    });

    test('fades out when the reveal fires, leaving the gradient', async ({ page }) => {
        await page.goto('/');
        const probe = await makeProbe(page);
        await probe.evaluate((el) => {
            document.documentElement.classList.add('app-revealing');
        });

        const at0 = await sampleAt(probe, 0, 'preloaderImageOut');
        const end = await sampleAt(probe, 250, 'preloaderImageOut');
        console.log('OUT ' + JSON.stringify({ at0, end }));

        // Starts from fully visible and fades to nothing, without growing.
        expect(at0.opacity).toBeGreaterThan(0.95);
        expect(end.opacity).toBeLessThan(0.05);
        expect(at0.scale).toBeCloseTo(1, 2);
    });

    test('the live overlay is still visible while the exit fade plays', async ({ page }) => {
        // The regression this guards: the gate used to set display:none in the
        // same frame as the reveal, so the fade never got to play.
        await page.goto('/');
        const overlay = page.locator('#appLoadingImageDiv');
        const image = page.locator('.appLoadingImage');

        // Catch it mid-fade: the overlay must still be in the tree and painting
        // while `app-revealing` is set.
        await page.evaluate(() => document.documentElement.classList.add('app-revealing'));
        await expect(overlay).toBeVisible();
        const midOpacity = await image.evaluate((el) => {
            const anim = el.getAnimations().find((a) => a.animationName === 'preloaderImageOut');
            if (!anim) return null;
            anim.pause();
            anim.currentTime = 125;
            return Number(getComputedStyle(el).opacity);
        });
        expect(midOpacity, 'exit animation not running on the live element').not.toBeNull();
        expect(midOpacity).toBeGreaterThan(0);
        expect(midOpacity).toBeLessThan(1);
    });

    test('the gradient behind the transparent PNG is never transformed', async ({ page }) => {
        await page.goto('/');
        const transform = await page
            .locator('#appLoadingImageDiv')
            .evaluate((el) => getComputedStyle(el).transform);
        // `none` (or the identity matrix) — the gradient must stay put while the
        // image box above it scales.
        expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(transform);
    });

    test('drops the scale under prefers-reduced-motion but keeps both fades', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/');
        const probe = await makeProbe(page);

        const inStart = await sampleAt(probe, 0, 'preloaderImageIn');
        const inEnd = await sampleAt(probe, 350, 'preloaderImageIn');
        console.log('REDUCED ' + JSON.stringify({ inStart, inEnd }));

        // No growth at any point …
        expect(inStart.scale).toBeCloseTo(1, 2);
        expect(inEnd.scale).toBeCloseTo(1, 2);
        // … but the fade in still runs, or the cover would appear unexplained.
        expect(inStart.opacity).toBeLessThan(0.1);
        expect(inEnd.opacity).toBeGreaterThan(0.95);
    });
});
