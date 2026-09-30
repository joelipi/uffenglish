// @ts-check
// Story 034 — hide the pre-video signup modal's "Not now" button and align the
// first/last name fields with the other fields.
//
// Two layers of coverage:
//   1. Real-app: open SaveClipsModal and assert the "Not now" button is present
//      in the DOM but not visible, while the signup/login actions remain.
//   2. Stylesheet-injected: render the signup markup with the real app.css and
//      assert the rendered geometry (name inputs line up with the email input).
//   3. Source guards: the CSS rules and the JSX element/handler still exist.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const APP_CSS = readFileSync(path.join(ROOT, 'src', 'assets', 'css', 'app.css'), 'utf8');
const SAVE_CLIPS_MODAL_SRC = readFileSync(
    path.join(ROOT, 'src', 'components', 'modals', 'SaveClipsModal.web.jsx'),
    'utf8'
);

const LESSON_URL = '/course/model/lesson/g';

// Markup mirroring SaveClipsSignupForm (col-6 name row + full-width email).
const MODAL_FORM_MARKUP = `
  <div id="saveClipsModal">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-body">
          <form>
            <div class="row mb-3">
              <div class="col-6">
                <label class="form-label" for="save-clips-first-name">First</label>
                <input type="text" class="form-control" id="save-clips-first-name" />
              </div>
              <div class="col-6">
                <label class="form-label" for="save-clips-last-name">Last</label>
                <input type="text" class="form-control" id="save-clips-last-name" />
              </div>
            </div>
            <div class="mb-3">
              <label class="form-label" for="save-clips-email">Email</label>
              <input type="email" class="form-control" id="save-clips-email" />
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>`;

// Markup mirroring SignupForm.web.jsx (col-md-6 name row + full-width email).
const SIGNUP_PAGE_MARKUP = `
  <div style="width: 420px">
    <form>
      <div class="row mb-3">
        <div class="col-md-6">
          <label class="form-label" for="first-name">First</label>
          <input type="text" class="form-control" id="first-name" />
        </div>
        <div class="col-md-6 mt-3 mt-md-0">
          <label class="form-label" for="last-name">Last</label>
          <input type="text" class="form-control" id="last-name" />
        </div>
      </div>
      <div class="mb-3">
        <label class="form-label" for="email">Email</label>
        <input type="email" class="form-control" id="email" />
      </div>
    </form>
  </div>`;

/** Edge geometry of an element, in viewport coordinates. */
async function edges(page, selector) {
    return page.locator(selector).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, width: r.width };
    });
}

test.describe('Story 034 — pre-video signup modal', () => {
    test('"Not now" is present but hidden; signup and login actions remain', async ({ page }) => {
        await page.goto(LESSON_URL);
        // Clear the guest-language gate so the app boots.
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

        // Open the pre-video signup modal directly.
        await page.evaluate(() => {
            window.appStore.getState().setSaveClipsModalOpen(true);
        });

        const notNow = page.locator('#saveClipsNotNowBtn');
        // Present in the DOM (hidden, not removed).
        await expect(notNow).toHaveCount(1);
        await expect(notNow).toBeHidden();
        expect(await notNow.evaluate((el) => getComputedStyle(el).display)).toBe('none');

        // The signup submit button and the log-in link are still visible.
        await expect(page.locator('#saveClipsModal form button[type="submit"]')).toBeVisible();
        await expect(page.locator('#saveClipsLoginLink')).toBeVisible();
    });

    test('modal name fields align with the email field at >=768px', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 900 });
        await page.setContent(`<style>${APP_CSS}</style>${MODAL_FORM_MARKUP}`);

        const first = await edges(page, '#save-clips-first-name');
        const last = await edges(page, '#save-clips-last-name');
        const email = await edges(page, '#save-clips-email');

        expect(Math.abs(first.left - email.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(last.right - email.right)).toBeLessThanOrEqual(1);
        expect(Math.abs(first.width - last.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(first.top - last.top)).toBeLessThanOrEqual(1);
    });

    test('modal name fields stay side by side below 768px (col-6 applies at all widths)', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 800 });
        await page.setContent(`<style>${APP_CSS}</style>${MODAL_FORM_MARKUP}`);

        const first = await edges(page, '#save-clips-first-name');
        const last = await edges(page, '#save-clips-last-name');

        // Side by side: same row, last starts to the right of first.
        expect(Math.abs(first.top - last.top)).toBeLessThanOrEqual(1);
        expect(last.left).toBeGreaterThan(first.right - 1);
    });
});

test.describe('Story 034 — standalone signup page', () => {
    test('name fields align with the email field at >=768px', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 900 });
        await page.setContent(`<style>${APP_CSS}</style>${SIGNUP_PAGE_MARKUP}`);

        const first = await edges(page, '#first-name');
        const last = await edges(page, '#last-name');
        const email = await edges(page, '#email');

        expect(Math.abs(first.left - email.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(last.right - email.right)).toBeLessThanOrEqual(1);
        expect(Math.abs(first.width - last.width)).toBeLessThanOrEqual(1);
        // mt-md-0 cancels mt-3 so both name inputs sit on the same row.
        expect(Math.abs(first.top - last.top)).toBeLessThanOrEqual(1);
    });

    test('name fields stack below 768px with a top margin on the last name', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 800 });
        await page.setContent(`<style>${APP_CSS}</style>${SIGNUP_PAGE_MARKUP}`);

        const first = await edges(page, '#first-name');
        const last = await edges(page, '#last-name');

        // Stacked: last name is below the first name.
        expect(last.top).toBeGreaterThan(first.top + first.width * 0 + 1);
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
        expect(APP_CSS).toMatch(/\.col-6\s*\{[^}]*width:\s*50%/);
        expect(APP_CSS).toMatch(/\.col-md-6\s*\{[^}]*width:\s*50%/);
        expect(APP_CSS).toMatch(/\.mt-md-0\s*\{[^}]*margin-top:\s*0/);
    });

    test('SaveClipsModal still renders the button and keeps handleNotNow', () => {
        expect(SAVE_CLIPS_MODAL_SRC).toContain('saveClipsNotNowBtn');
        expect(SAVE_CLIPS_MODAL_SRC).toContain('handleNotNow');
    });
});
