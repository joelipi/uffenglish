// @ts-check
// Story 034 — hide the pre-video signup modal's "Not now" button and align the
// first/last name fields with the other fields.
//
// Coverage is against the REAL components (not hand-copied markup):
//   1. Real-app modal: open SaveClipsModal and assert the "Not now" button is
//      present in the DOM but not visible, while the signup/login actions
//      remain; measure the real name/email inputs for alignment.
//   2. Story 070 — the standalone signup page is closed, so /signup redirects to
//      the course list in a real browser and shows no form.
//   3. Source guards: the CSS rules exist, and the real component files still
//      carry the grid classes / button element the tests depend on.
//
// On the removed standalone-page geometry tests: story 070 made /signup
// unreachable, so there is no longer a real page to measure. The contract they
// protected — "the signup form's name fields are grid-aligned with the email
// field" — is still measured in a real browser above, on the modal form, which
// is now the only reachable signup form; and the standalone form's classes are
// still pinned by the source guards at the bottom of this file. Measuring
// geometry on a page that is deliberately closed would assert that the closure
// does not work.
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

// Story 070 — the standalone signup page is closed by redirect, not deleted.
test.describe('Story 070 — /signup is unreachable (real browser)', () => {
    test('redirects to the course list and renders no signup form', async ({ page }) => {
        await page.goto(SIGNUP_URL);

        // A stale ?redirect= link must land on the funnel, never on a form.
        await expect(page).toHaveURL(/\/courses(\?.*)?$/);
        await expect(page.locator('#first-name')).toHaveCount(0);
        await expect(page.locator('#email')).toHaveCount(0);
        await expect(page.locator('form button[type="submit"]:visible')).toHaveCount(0);

        // …and the landing explains where an account comes from instead.
        const notice = page.locator('[data-testid="courses-guest-notice"]');
        await expect(notice).toBeVisible();
        await expect(notice).toContainText('not signed in');
        await expect(page.locator('[data-testid="courses-guest-signin"]'))
            .toHaveAttribute('href', '/login?redirect=%2Fcourses');
    });

    test('a stale /signup?redirect=… deep link also lands on the funnel', async ({ page }) => {
        await page.goto('/signup?redirect=%2Fhome');
        await expect(page).toHaveURL(/\/courses(\?.*)?$/);
        await expect(page.locator('#first-name')).toHaveCount(0);
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
