// Regression: lesson intro must show a real thumbnail (poster) with the
// LQIP/gradient painted behind it — never a broken-image icon or empty rect.
import { test, expect } from '@playwright/test';

test('intro poster renders (no broken icon)', async ({ page }) => {
  await page.goto('/course/model/lesson/t');
  await page.waitForSelector('#intro-call-widget', { timeout: 20000 });
  const img = page.locator('#intro-call-widget .intro-video-container img');
  await img.waitFor({ state: 'visible', timeout: 15000 });
  const src = await img.getAttribute('src');
  expect(src).toContain('/assets/videos/do_you_have_rolls_too.jpg');
  const nw = await img.evaluate(el => el.naturalWidth);
  expect(nw).toBeGreaterThan(0);
  const bg = await page.locator('.intro-video-container').evaluate(el => getComputedStyle(el).backgroundImage);
  expect(bg).not.toBe('none');
  const complete = await img.evaluate(el => el.complete && el.naturalWidth > 0);
  expect(complete).toBe(true);
});

test('poster 404 -> LQIP/gradient, no broken icon', async ({ page }) => {
  await page.route('**/assets/videos/*.jpg', r => r.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/course/model/lesson/t');
  await page.waitForSelector('#intro-call-widget', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const imgCount = await page.locator('#intro-call-widget .intro-video-container img').count();
  if (imgCount > 0) {
    const opacity = await page.locator('#intro-call-widget .intro-video-container img').evaluate(el => getComputedStyle(el).opacity);
    expect(Number(opacity)).toBe(0);
  }
  const bg = await page.locator('.intro-video-container').evaluate(el => getComputedStyle(el).backgroundImage);
  expect(bg).not.toBe('none');
  await expect(page.locator('#appLoadingImageDiv')).toBeHidden({ timeout: 20000 });
});