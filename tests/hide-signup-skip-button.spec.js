// @ts-check
// Story 034 — hide the pre-video signup modal's "Not now" button and align the
// first/last name fields with the other fields.
//
// Coverage is against the REAL components (not hand-copied markup):
//   1. Real-app modal: open SaveClipsModal and assert the "Not now" button is
//      present in the DOM but not visible, while the signup/login actions
//      remain; measure the real name/email inputs for alignment.
//   2. Real-app standalone signup page: navigate to /signup and measure the
//      real name/email inputs.
//   3. Source guards: the CSS rules exist, and the real component files still
//      carry the grid classes / button element the tests depend on.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const read = (...segments) => readFileSync(path.join(ROOT, ...segments), 'utf8');

const APP_CSS = read('src', 'assets', 'css', 'app.css');
const SAVE_CLIPS_MODAL_SRC = read('src', 'components', 'modals', 'SaveClipsModal.web.jsx');
const SAVE_CLIPS_FORM_SRC = read('src', 'components', 'modals', 'SaveClipsSignupForm.jsx');
const SIGNUP_FORM_SRC = read('src', 'components', 'auth', 'SignupForm.web.jsx');

const LESSON_URL = '/course/model/lesson/m-g';
const SIGNUP_URL = '/signup';

/** Edge geometry of an element, in viewport coordinates. */
async function edges(page, selector) {
    return page.locator(selector).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, width: r.width };
    });
}

/** Boot the app on a lesson and clear the guest-language gate. */
async function bootApp(page) {
    await page.goto(LESSON_URL);
    await page.waitForFunction(
        () => window.appStore?.getState()?.configData || document.querySelector('#guestEnglishOnlyBtn'),
        null,
        { timeout: 30000 }
    );
    if (await page.locator('#guestEnglishOnlyBtn').count()) {
        await page.click('#guestEnglishOnlyBtn').catch(() => {});
        const cont = page.locator('#guestContinueBtn');
        await cont.waitFor({ state: 'visible', timeout: 3000 }).then(() => cont.click()).catch(() => {});
    }
    await page.waitForFunction(() => window.appStore?.getState()?.configData, null, { timeout: 20000 });
}

/** Open the real pre-video signup modal. */
async function openSaveClipsModal(page) {
    await page.evaluate(() => {
        window.appStore.getState().setSaveClipsModalOpen(true);
    });
    await expect(page.locator('#saveClipsModal')).toBeVisible();
}

test.describe('Story 034 — pre-video signup modal (real component)', () => {
    test('"Not now" is present but hidden; signup and login actions remain', async ({ page }) => {
        await bootApp(page);
        await openSaveClipsModal(page);

        const notNow = page.locator('#saveClipsNotNowBtn');
        // Present in the DOM (hidden, not removed).
        await expect(notNow).toHaveCount(1);
        await expect(notNow).toBeHidden();
        expect(await notNow.evaluate((el) => getComputedStyle(el).display)).toBe('none');

        // The signup submit button and the log-in link are still visible.
        await expect(page.locator('#saveClipsModal form button[type="submit"]')).toBeVisible();
        await expect(page.locator('#saveClipsLoginLink')).toBeVisible();
    });

    test('real name fields align with the email field at >=768px', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 900 });
        await bootApp(page);
        await openSaveClipsModal(page);

        const first = await edges(page, '#save-clips-first-name');
        const last = await edges(page, '#save-clips-last-name');
        const email = await edges(page, '#save-clips-email');

        expect(Math.abs(first.left - email.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(last.right - email.right)).toBeLessThanOrEqual(1);
        expect(Math.abs(first.width - last.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(first.top - last.top)).toBeLessThanOrEqual(1);
    });

    test('real name fields stay side by side below 768px (col-6 applies at all widths)', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 800 });
        await bootApp(page);
        await openSaveClipsModal(page);

        const first = await edges(page, '#save-clips-first-name');
        const last = await edges(page, '#save-clips-last-name');

        // Side by side: same row, last starts to the right of first.
        expect(Math.abs(first.top - last.top)).toBeLessThanOrEqual(1);
        expect(last.left).toBeGreaterThan(first.right - 1);
    });
});

test.describe('Story 034 — standalone signup page (real component)', () => {
    test('real name fields align with the email field at >=768px', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 900 });
        await page.goto(SIGNUP_URL);
        await expect(page.locator('#first-name')).toBeVisible();

        const first = await edges(page, '#first-name');
        const last = await edges(page, '#last-name');
        const email = await edges(page, '#email');

        expect(Math.abs(first.left - email.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(last.right - email.right)).toBeLessThanOrEqual(1);
        expect(Math.abs(first.width - last.width)).toBeLessThanOrEqual(1);
        // mt-md-0 cancels mt-3 so both name inputs sit on the same row.
        expect(Math.abs(first.top - last.top)).toBeLessThanOrEqual(1);
    });

    test('real name fields stack full-width below 768px with a top margin on the last name', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 800 });
        await page.goto(SIGNUP_URL);
        await expect(page.locator('#first-name')).toBeVisible();

        const first = await edges(page, '#first-name');
        const last = await edges(page, '#last-name');
        const email = await edges(page, '#email');

        // Stacked: last name is below the first name.
        expect(last.top).toBeGreaterThan(first.top + 1);
        // Full width: each name input spans the same width as the email input.
        expect(Math.abs(first.width - email.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(last.width - email.width)).toBeLessThanOrEqual(1);
        // mt-3 applies below 768px.
        const marginTop = await page.locator('#last-name').evaluate((el) => {
            const col = el.closest('.col-md-6');
            return parseFloat(getComputedStyle(col).marginTop);
        });
        expect(marginTop).toBeGreaterThan(0);
    });
});

test.describe('Story 034 — source guards', () => {
    test('app.css hides #saveClipsNotNowBtn and defines the grid classes', () => {
        expect(APP_CSS).toMatch(/#saveClipsNotNowBtn\s*\{[^}]*display:\s*none/);
        expect(APP_CSS).toMatch(/\.row\s*>\s*\*\s*\{[^}]*width:\s*100%/);
        expect(APP_CSS).toMatch(/\.col-6\s*\{[^}]*width:\s*50%/);
        expect(APP_CSS).toMatch(/\.col-md-6\s*\{[^}]*width:\s*50%/);
        expect(APP_CSS).toMatch(/\.mt-md-0\s*\{[^}]*margin-top:\s*0/);
    });

    test('SaveClipsModal still renders the button wired to handleNotNow', () => {
        // Structural: the button element with the id and its onClick handler.
        expect(SAVE_CLIPS_MODAL_SRC).toMatch(
            /id="saveClipsNotNowBtn"[\s\S]*?onClick=\{handleNotNow\}/
        );
        expect(SAVE_CLIPS_MODAL_SRC).toMatch(/const handleNotNow\s*=/);
    });

    test('the real signup forms still carry the grid classes the tests measure', () => {
        // SaveClipsSignupForm uses col-6 for both name columns.
        expect(SAVE_CLIPS_FORM_SRC).toMatch(/className="col-6"/);
        // SignupForm.web.jsx uses col-md-6 + mt-3 mt-md-0.
        expect(SIGNUP_FORM_SRC).toMatch(/className="col-md-6"/);
        expect(SIGNUP_FORM_SRC).toMatch(/className="col-md-6 mt-3 mt-md-0"/);
    });
});
