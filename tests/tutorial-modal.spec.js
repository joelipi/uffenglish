// @ts-check
// Tutorial modal spec — the three decision rows open a full-screen, scrollable
// tutorial takeover with a corner X, a portrait step-type video, localized
// subtitles and a localized Continue; X, Continue, backdrop and Escape all
// dismiss it.
//
// Runs on REAL Chrome: `npx playwright install chrome` is a prerequisite
// (`channel: 'chrome'` is set below). Playwright's bundled Chromium lacks
// H.264/AAC, so it cannot validate the video element's playback behavior.
//
// The tutorial clips themselves are the operator-uploaded R2 assets
// (`node scripts/generate-tutorial-placeholders.mjs` then `wrangler r2 object
// put`), so this spec asserts the wiring, the resolved src, portrait geometry
// and no-autoplay — never that the remote bytes decode.
import { test, expect } from '@playwright/test';
import {
    SENTINEL_SRC,
    blockSentinelAutoplay,
    confirmGuestLanguage,
    waitForLessonReady,
} from './helpers/lesson-e2e.js';

test.use({ channel: 'chrome' });

const LESSON_URL = '/course/model/lesson/m-g';

test.describe('tutorial modal', () => {
    test.beforeEach(async ({ page }) => {
        await blockSentinelAutoplay(page);
        // The tutorial clips are operator-uploaded R2 assets; until they are
        // uploaded, keep the requests from turning into 404 noise. Nothing in
        // this spec depends on the remote bytes (no playback assertions).
        await page.route('**/assets/videos/tutorial-*.mp4', (route) => route.abort());
    });

    /**
     * Mount one of the three tutorial-bearing decision rows with the given
     * step type, without waiting out any video.
     */
    async function openDecisionRow(page, { responseType, phase }) {
        await page.goto(LESSON_URL);
        await confirmGuestLanguage(page);
        await waitForLessonReady(page, 'm-g');
        await page.evaluate(({ sentinel, responseType, phase }) => {
            const s = window.appStore.getState();
            s.setGuestModalOpen(false);
            s.setGuestModalShownThisSession(true);
            window.appStore.setState({
                isLoggedIn: true,
                userData: { native_language: 'en', auth_method: 'supabase', $id: 'test-user' },
            });
            s.setCurrentVideo({
                type: 'simple',
                responseType,
                url: sentinel,
                config: { subtitles: 'Follow along.' },
            });
            s.setMediaVisible(true);
            s.transitionTo('simpleVideo', {}, { fromStepLoad: true });
            s.transitionTo(phase, {}, { fromStepLoad: true });
        }, { sentinel: SENTINEL_SRC, responseType, phase });
    }

    const overlay = (page) => page.locator('.tutorial-modal-overlay');
    const video = (page) => page.locator('#tutorialVideo');

    test('the view-and-continue row opens its own step-type tutorial', async ({ page }) => {
        await openDecisionRow(page, { responseType: 'viewAndContinue', phase: 'simpleVideo-decisionTime-viewAndContinue' });

        await expect(overlay(page)).toHaveCount(0);
        await page.locator('#tutorialBtn').click({ force: true });

        await expect(overlay(page)).toBeVisible();
        await expect(video(page)).toHaveAttribute('src', /assets\/videos\/tutorial-viewAndContinue\.mp4$/);
    });

    test('the branching row opens the branching tutorial', async ({ page }) => {
        await openDecisionRow(page, { responseType: 'branching', phase: 'simpleVideo-decisionTime-branching' });

        await page.locator('#branchTutorialBtn').click({ force: true });

        await expect(overlay(page)).toBeVisible();
        await expect(video(page)).toHaveAttribute('src', /assets\/videos\/tutorial-branching\.mp4$/);
    });

    for (const responseType of ['closedResponse', 'openResponse', 'friendClosedResponse']) {
        test(`the response row opens the ${responseType} tutorial`, async ({ page }) => {
            await openDecisionRow(page, { responseType, phase: 'simpleVideo-decisionTime-response' });

            await page.locator('#responseTutorialBtn').click({ force: true });

            await expect(overlay(page)).toBeVisible();
            await expect(video(page)).toHaveAttribute('src', new RegExp(`assets/videos/tutorial-${responseType}\\.mp4$`));
        });
    }

    test('the takeover is portrait, scrollable, tap-to-play and shows the corner X plus Continue', async ({ page }) => {
        await openDecisionRow(page, { responseType: 'closedResponse', phase: 'simpleVideo-decisionTime-response' });
        await page.locator('#responseTutorialBtn').click({ force: true });
        await expect(overlay(page)).toBeVisible();

        // Tap-to-play: controls present, no autoplay attribute, and the element
        // has not started on its own.
        await expect(video(page)).toHaveAttribute('controls', '');
        await expect(video(page)).toHaveAttribute('preload', 'metadata');
        await expect(video(page)).not.toHaveAttribute('autoplay', /.*/);
        expect(await video(page).evaluate((el) => el.paused)).toBe(true);

        // Portrait 9:16 and a scrollable takeover.
        const metrics = await video(page).evaluate((el) => {
            const rect = el.getBoundingClientRect();
            const overlayEl = document.querySelector('.tutorial-modal-overlay');
            const contentEl = document.querySelector('.tutorial-modal-content');
            return {
                ratio: rect.height / rect.width,
                overlayOverflow: getComputedStyle(overlayEl).overflowY,
                contentOverflow: getComputedStyle(contentEl).overflowY,
                contentMaxHeight: getComputedStyle(contentEl).maxHeight,
            };
        });
        expect(metrics.ratio).toBeCloseTo(16 / 9, 1);
        expect(metrics.overlayOverflow).toBe('auto');
        expect(metrics.contentOverflow).toBe('auto');

        await expect(page.locator('#tutorialCloseBtn')).toBeVisible();
        await expect(page.locator('#tutorialContinueBtn')).toBeVisible();
    });

    test('opening the tutorial pauses the lesson video underneath', async ({ page }) => {
        await openDecisionRow(page, { responseType: 'closedResponse', phase: 'simpleVideo-decisionTime-response' });
        await page.locator('#responseTutorialBtn').click({ force: true });
        await expect(overlay(page)).toBeVisible();

        expect(await page.locator('.ivp-video').evaluate((el) => el.paused)).toBe(true);
    });

    test('the corner X dismisses the takeover', async ({ page }) => {
        await openDecisionRow(page, { responseType: 'closedResponse', phase: 'simpleVideo-decisionTime-response' });
        await page.locator('#responseTutorialBtn').click({ force: true });
        await expect(overlay(page)).toBeVisible();

        await page.locator('#tutorialCloseBtn').click();
        await expect(overlay(page)).toHaveCount(0);
    });

    test('Continue dismisses the takeover', async ({ page }) => {
        await openDecisionRow(page, { responseType: 'closedResponse', phase: 'simpleVideo-decisionTime-response' });
        await page.locator('#responseTutorialBtn').click({ force: true });
        await expect(overlay(page)).toBeVisible();

        await page.locator('#tutorialContinueBtn').click();
        await expect(overlay(page)).toHaveCount(0);
    });

    test('a backdrop click dismisses the takeover', async ({ page }) => {
        await openDecisionRow(page, { responseType: 'closedResponse', phase: 'simpleVideo-decisionTime-response' });
        await page.locator('#responseTutorialBtn').click({ force: true });
        await expect(overlay(page)).toBeVisible();

        await overlay(page).click({ position: { x: 5, y: 5 } });
        await expect(overlay(page)).toHaveCount(0);
    });

    test('Escape dismisses the takeover', async ({ page }) => {
        await openDecisionRow(page, { responseType: 'closedResponse', phase: 'simpleVideo-decisionTime-response' });
        await page.locator('#responseTutorialBtn').click({ force: true });
        await expect(overlay(page)).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(overlay(page)).toHaveCount(0);
    });

    test('a guest who picked Spanish reads Spanish subtitles, not the browser default', async ({ page }) => {
        await openDecisionRow(page, { responseType: 'branching', phase: 'simpleVideo-decisionTime-branching' });
        // Guest language is authoritative over the browser default (the test
        // browser runs English). This is the guest-first rule from AGENTS.md.
        await page.evaluate(() => {
            window.appStore.getState().setGuestNativeLanguage('es');
        });
        await page.locator('#branchTutorialBtn').click({ force: true });
        await expect(overlay(page)).toBeVisible();

        const subtitle = page.locator('.tutorial-modal-subtitle-text');
        await expect(subtitle).toHaveAttribute('lang', 'es');
        await expect(subtitle).toContainText('Este paso te da una opción');
        await expect(page.locator('#tutorialContinueBtn')).toContainText('CONTINUAR');
    });

    test('an English learner sees the English script exactly once in the band', async ({ page }) => {
        await openDecisionRow(page, { responseType: 'closedResponse', phase: 'simpleVideo-decisionTime-response' });
        await page.locator('#responseTutorialBtn').click({ force: true });
        await expect(overlay(page)).toBeVisible();

        const subtitle = page.locator('.tutorial-modal-subtitle-text');
        await expect(subtitle).toHaveAttribute('lang', 'en');
        await expect(subtitle).toContainText('Now it is your turn to speak.');
    });
});
