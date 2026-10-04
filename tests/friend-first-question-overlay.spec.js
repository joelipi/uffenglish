// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    SENTINEL_SRC,
    HANG,
    collectConsole,
    blockSentinelAutoplay,
    confirmGuestLanguage,
    waitForLessonReady,
    waitForVideoWrapper,
} from './helpers/lesson-e2e.js';

// Story 029: on a friend lesson (`?shareCode=` or lesson id a/b) the FIRST
// response step must skip the one-button `firstResponse` mode chooser and use
// its normal per-video flow — simple clip → simpleVideo (mic hidden, subtitles
// low) → `simpleVideo-decisionTime-response` overlay (story 028); interactive
// clip → `interactiveVideo+<type>`; no clip → `recording/answering`. Non-friend
// lessons keep the chooser.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

test.describe('friend lessons: first question skips the mode chooser', () => {
    let observed = { errors: [], transitionWarnings: [] };

    test.beforeEach(async ({ page }) => {
        observed = collectConsole(page);
        await blockSentinelAutoplay(page);
    });

    /**
     * Load a specific step through the real `loadStep` path and return the
     * resulting store snapshot captured synchronously (so a clip that settles
     * later cannot race the assertion).
     */
    async function loadStepIndex(page, stepIndex) {
        return page.evaluate(async (idx) => {
            const { loadStep } = await import('/src/components/step-loader.web.js');
            const { appStore, getAnswerPipelineDeps } = await import('/src/modules/store/store.js');
            const state = appStore.getState();
            const lesson = state.configData.lessons[state.currentLessonIndex];
            appStore.setState({ currentStepIndex: idx, incorrectAttempts: 0 });
            loadStep(lesson.steps[idx], lesson, null, getAnswerPipelineDeps());
            const s = appStore.getState();
            return { appPhase: s.appPhase, bottomState: s.bottomState };
        }, stepIndex);
    }

    test('source wiring uses the pure resolver and route friend detection', () => {
        const source = readFileSync(path.join(ROOT, 'src/modules/lesson/step-executor-webonly.js'), 'utf8');
        expect(source).toContain('resolveStepPhase(');
        expect(source).toContain('isFriendLesson(');
        expect(source).not.toContain("phase = 'firstResponse'");
    });

    test('friend lesson a: first response step plays the clip, then raises the 028 overlay', async ({ page }) => {
        await page.route(/\.mp4(\?.*)?$/, HANG);
        await page.goto('/course/wouldrather/lesson/a');
        await confirmGuestLanguage(page);
        await waitForLessonReady(page, 'a');

        const snap = await loadStepIndex(page, 2);
        expect(snap.appPhase).toBe('simpleVideo');
        expect(snap.bottomState).toBe('hidden');

        // Swap the real clip for the deterministic sentinel now that the phase
        // is proven; keeps `ended` under the test's control.
        await page.evaluate((sentinel) => {
            const s = window.appStore.getState();
            s.setCurrentVideo({ type: 'simple', responseType: 'friendClosedResponse', url: sentinel, config: { subtitles: 'Follow along.' } });
            s.setMediaVisible(true);
        }, SENTINEL_SRC);

        await waitForVideoWrapper(page);

        await expect(page.locator('#state-intro-choices')).toHaveCount(0);
        await expect(page.locator('#micBtn')).toHaveCount(0);
        await expect(page.locator('.ivp-subtitle-scroll-container')).toHaveClass(/subtitles-at-bottom/);

        await page.evaluate(() => {
            document.querySelector('.ivp-video')?.dispatchEvent(new Event('ended'));
        });
        await page.waitForFunction(
            () => window.appStore.getState().appPhase === 'simpleVideo-decisionTime-response',
            null,
            { timeout: 5000 }
        );

        await expect(page.locator('.ivp-overlay.water-surface')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.ivp-overlay-text')).toHaveText('Can you repeat that exactly?');
        await expect(page.locator('#responseAnswerBtn')).toBeVisible();

        expect(observed.transitionWarnings).toEqual([]);
        expect(observed.errors).toEqual([]);
    });

    test('friend lesson via ?shareCode= on wa: first response step goes interactive', async ({ page }) => {
        await page.route(/\.mp4(\?.*)?$/, HANG);
        await page.goto('/course/model/lesson/wa?shareCode=friendtest1');
        await confirmGuestLanguage(page);
        await waitForLessonReady(page, 'wa');

        const snap = await loadStepIndex(page, 2);
        expect(snap.appPhase).toBe('interactiveVideo+friendClosedResponse');
        await expect(page.locator('#state-intro-choices')).toHaveCount(0);
        expect(observed.transitionWarnings).toEqual([]);
    });

    test('friend lesson via ?shareCode= on g: closed response goes interactive+closedResponse', async ({ page }) => {
        await page.route(/\.mp4(\?.*)?$/, HANG);
        await page.goto('/course/model/lesson/m-g?shareCode=friendtest1');
        await confirmGuestLanguage(page);
        await waitForLessonReady(page, 'm-g');

        const snap = await loadStepIndex(page, 1);
        expect(snap.appPhase).toBe('interactiveVideo+closedResponse');
        await expect(page.locator('#state-intro-choices')).toHaveCount(0);
        expect(observed.transitionWarnings).toEqual([]);
    });

    test('non-friend lesson w keeps the firstResponse chooser', async ({ page }) => {
        await page.route(/\.mp4(\?.*)?$/, HANG);
        await page.goto('/course/model/lesson/m-w');
        await confirmGuestLanguage(page);
        await waitForLessonReady(page, 'm-w');

        const snap = await loadStepIndex(page, 1);
        expect(snap.appPhase).toBe('firstResponse');
        await expect(page.locator('#state-intro-choices')).toHaveCount(1);
        expect(observed.transitionWarnings).toEqual([]);
    });

    test('non-friend lesson wa (no share code) keeps the firstResponse chooser', async ({ page }) => {
        await page.route(/\.mp4(\?.*)?$/, HANG);
        await page.goto('/course/model/lesson/wa');
        await confirmGuestLanguage(page);
        await waitForLessonReady(page, 'wa');

        const snap = await loadStepIndex(page, 2);
        expect(snap.appPhase).toBe('firstResponse');
        await expect(page.locator('#state-intro-choices')).toHaveCount(1);
        expect(observed.transitionWarnings).toEqual([]);
    });
});
