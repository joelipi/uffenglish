// @ts-check
import { test, expect } from '@playwright/test';
import {
    SENTINEL_SRC,
    collectConsole,
    blockSentinelAutoplay,
    confirmGuestLanguage,
    waitForLessonReady,
    waitForVideoWrapper,
} from './helpers/lesson-e2e.js';

// Simple-video response steps (closedResponse / openResponse /
// friendClosedResponse carrying a plain clip) raise a Replay / Answer /
// Tutorial decision overlay once the clip ends, mirroring the interactive
// decision path. Lesson g is used only for a mounted app + configData; the
// response step itself is injected directly below.
const LESSON_URL = '/course/model/lesson/g';

test.describe('simple-video response decision overlay', () => {
    let observed = { errors: [], transitionWarnings: [] };

    test.beforeEach(async ({ page }) => {
        observed = collectConsole(page);
        await blockSentinelAutoplay(page);
    });

    /** Load the app, dismiss the guest modal, and mount a simple response clip. */
    async function setupSimpleResponseStep(page, responseType) {
        await page.goto(LESSON_URL);
        await confirmGuestLanguage(page);
        await waitForLessonReady(page, 'g');
        await page.evaluate(({ sentinel, responseType }) => {
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
        }, { sentinel: SENTINEL_SRC, responseType });
    }

    /** Wait out the 3s FOUC fallback that makes the video wrapper visible. */
    async function endVideo(page) {
        await page.evaluate(() => {
            document.querySelector('.ivp-video')?.dispatchEvent(new Event('ended'));
        });
        await page.waitForFunction(
            () => window.appStore.getState().appPhase === 'simpleVideo-decisionTime-response',
            null,
            { timeout: 5000 }
        );
    }

    test('playing response clip hides the mic and drops the subtitles to the bottom band', async ({ page }) => {
        await setupSimpleResponseStep(page, 'friendClosedResponse');
        await waitForVideoWrapper(page);

        const s = await page.evaluate(() => window.appStore.getState());
        expect(s.appPhase).toBe('simpleVideo');
        expect(s.bottomState).toBe('hidden');

        // The mic control is not mounted while the clip plays.
        await expect(page.locator('#micBtn')).toHaveCount(0);

        const container = page.locator('.ivp-subtitle-scroll-container');
        await expect(container).toHaveClass(/subtitles-at-bottom/);
        const bottom = await container.evaluate(el => getComputedStyle(el).bottom);
        expect(bottom).toBe('0px');

        // No decision overlay yet.
        await expect(page.locator('.ivp-overlay.water-surface')).toHaveCount(0);
        expect(observed.errors).toEqual([]);
    });

    test('a friendClosedResponse clip raises the repeat-exactly overlay on end', async ({ page }) => {
        await setupSimpleResponseStep(page, 'friendClosedResponse');
        await waitForVideoWrapper(page);

        await endVideo(page);

        await expect(page.locator('.ivp-overlay.water-surface')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.ivp-overlay-text')).toHaveText('Can you repeat that exactly?');
        expect(observed.transitionWarnings).toEqual([]);
        expect(observed.errors).toEqual([]);
    });

    test('an openResponse clip uses the did-you-understand copy and respond-now label', async ({ page }) => {
        await setupSimpleResponseStep(page, 'openResponse');
        await waitForVideoWrapper(page);

        await endVideo(page);

        await expect(page.locator('.ivp-overlay-text')).toHaveText('Did you understand completely?');
        await expect(
            page.locator('.ivp-choice-col:has(#responseAnswerBtn) .ivp-choice-label-text')
        ).toHaveText('RESPOND NOW');
    });

    test('a friendClosedResponse clip uses the repeat-now label', async ({ page }) => {
        await setupSimpleResponseStep(page, 'friendClosedResponse');
        await waitForVideoWrapper(page);

        await endVideo(page);

        await expect(
            page.locator('.ivp-choice-col:has(#responseAnswerBtn) .ivp-choice-label-text')
        ).toHaveText('REPEAT NOW');
    });

    test('a failed response clip still reveals the overlay instead of stranding the learner', async ({ page }) => {
        await setupSimpleResponseStep(page, 'friendClosedResponse');
        await waitForVideoWrapper(page);

        await page.evaluate(() => {
            document.querySelector('.ivp-video')?.dispatchEvent(new Event('error'));
        });
        await page.waitForFunction(
            () => window.appStore.getState().appPhase === 'simpleVideo-decisionTime-response',
            null,
            { timeout: 5000 }
        );

        await expect(page.locator('.ivp-overlay.water-surface')).toBeVisible();
    });

    test('the decision phase shows Replay / Answer / Tutorial with the expected labels', async ({ page }) => {
        await setupSimpleResponseStep(page, 'friendClosedResponse');
        await waitForVideoWrapper(page);
        await endVideo(page);

        await expect(page.locator('#responseReplayBtn')).toBeVisible();
        await expect(page.locator('#responseAnswerBtn')).toBeVisible();
        await expect(page.locator('#responseTutorialBtn')).toBeVisible();

        await expect(
            page.locator('.ivp-choice-col:has(#responseReplayBtn) .ivp-choice-label-text')
        ).toHaveText('REPLAY VIDEO');
        await expect(
            page.locator('.ivp-choice-col:has(#responseAnswerBtn) .ivp-choice-label-text')
        ).toHaveText('REPEAT NOW');
        await expect(
            page.locator('.ivp-choice-col:has(#responseTutorialBtn) .ivp-choice-label-text')
        ).toHaveText('WATCH TUTORIAL');
    });

    test('Replay returns to the simpleVideo phase and restores the bottom subtitles', async ({ page }) => {
        await setupSimpleResponseStep(page, 'friendClosedResponse');
        await waitForVideoWrapper(page);
        await endVideo(page);

        await page.locator('#responseReplayBtn').click({ force: true });
        await page.waitForFunction(
            () => window.appStore.getState().appPhase === 'simpleVideo',
            null,
            { timeout: 5000 }
        );

        const s = await page.evaluate(() => window.appStore.getState());
        expect(s.bottomState).toBe('hidden');
        await expect(page.locator('.ivp-subtitle-scroll-container')).toHaveClass(/subtitles-at-bottom/);
    });

    test('Tutorial opens the modal and clicking outside dismisses it', async ({ page }) => {
        await setupSimpleResponseStep(page, 'friendClosedResponse');
        await waitForVideoWrapper(page);
        await endVideo(page);

        await page.locator('#responseTutorialBtn').click({ force: true });
        await expect(page.locator('.tutorial-modal-overlay')).toBeVisible();

        // The content stops propagation; a click on the overlay backdrop closes it.
        await page.locator('.tutorial-modal-overlay').click({ position: { x: 5, y: 5 } });
        await expect(page.locator('.tutorial-modal-overlay')).toHaveCount(0);
    });

    test('voice Answer toggles speech without transitioning; recording starts on onRecordingStart', async ({ page }) => {
        await setupSimpleResponseStep(page, 'friendClosedResponse');
        await waitForVideoWrapper(page);
        await endVideo(page);

        await page.evaluate(async () => {
            window.__speechCalled = false;
            const mod = await import('/src/modules/lesson/step-loader-callbacks.js');
            mod.setSpeechInputToggleCallback(() => { window.__speechCalled = true; });
        });

        await page.locator('#responseAnswerBtn').click({ force: true });
        await expect.poll(() => page.evaluate(() => window.__speechCalled === true)).toBe(true);

        // The button must not pre-enter recording/answering: a getUserMedia
        // failure has to keep the decision overlay mounted.
        expect(await page.evaluate(() => window.appStore.getState().appPhase)).toBe('simpleVideo-decisionTime-response');
    });

    test('text-mode Answer transitions to recording/answering and reveals the text input', async ({ page }) => {
        await setupSimpleResponseStep(page, 'friendClosedResponse');
        await waitForVideoWrapper(page);
        await endVideo(page);

        await page.evaluate(() => window.appStore.getState().setTextMode(true));
        await expect(page.locator('#responseTxtBtn')).toBeVisible();
        // The mic button stays in the DOM but is hidden via `d-none` in text mode.
        await expect(page.locator('#responseAnswerBtn')).toBeHidden();

        await page.locator('#responseTxtBtn').click({ force: true });
        await page.waitForFunction(
            () => window.appStore.getState().appPhase === 'recording/answering',
            null,
            { timeout: 5000 }
        );
        expect(await page.evaluate(() => window.appStore.getState().textInputVisible)).toBe(true);

        expect(observed.transitionWarnings).toEqual([]);
        expect(observed.errors).toEqual([]);
    });
});
