// @ts-check
import { test, expect } from '@playwright/test';
import {
    collectConsole,
    blockSentinelAutoplay,
    confirmGuestLanguage,
    waitForLessonReady,
} from './helpers/lesson-e2e.js';

// stories/060-autoplay-share-video: the display-only after-video loop owns the
// frame once the recap is ready. These specs drive the store directly (no R2,
// no codecs): real audible playback stays a manual device check by design.
const LESSON_URL = '/course/model/lesson/m-g';

test.describe('After-video loop wiring', () => {
    let observed = { errors: [], transitionWarnings: [] };

    test.beforeEach(async ({ page }) => {
        observed = collectConsole(page);
        await blockSentinelAutoplay(page);
        // No real tail media is fetched in these specs (the loop is driven
        // via the store flag); stub the candidates so nothing can hit R2.
        await page.route('**/assets/videos/aftersuccess*', (route) => route.abort());
        await page.route('**/assets/videos/aftershare*', (route) => route.abort());
    });

    /** Success screen in the post-generation `ready` state. */
    async function setupReadyScreen(page, { afterVideoActive = null, canvasVisible = false } = {}) {
        await page.goto(LESSON_URL);
        await confirmGuestLanguage(page);
        await waitForLessonReady(page, 'm-g');
        await page.evaluate(({ afterVideoActive, canvasVisible }) => {
            const s = window.appStore.getState();
            s.setGuestModalOpen(false);
            s.setGuestModalShownThisSession(true);
            window.appStore.setState({
                isLoggedIn: true,
                userData: { native_language: 'en', auth_method: 'supabase', $id: 'test-user' },
            });
            s.setSuccessScreen('g', { total: 85 });
            s.setCurrentVideo(null);
            s.transitionTo('lessonSuccess', { lessonId: 'm-g', fluencyData: { total: 85 } }, { fromStepLoad: true });
            s.setSuccessVideoBlob(new Blob(['fake'], { type: 'video/webm' }));
            s.setSuccessVideoState('ready');
            s.setSuccessRepeatButtonVisible(true);
            s.setSuccessContinueVisible(true);
            s.setSuccessCanvasVisible(canvasVisible);
            s.setAfterVideoActive(afterVideoActive);
        }, { afterVideoActive, canvasVisible });
    }

    test('running loop owns the frame: canvas + action row visible, blob preview absent', async ({ page }) => {
        await setupReadyScreen(page, { afterVideoActive: 'aftersuccess', canvasVisible: true });

        await expect(page.locator('#displayCanvas')).toBeVisible();
        await expect(page.locator('[data-testid="after-video-canvas"]')).toBeVisible();
        await expect(page.locator('#resultVideo')).toHaveCount(0);
        await expect(page.locator('#createVideoButton')).toBeVisible();
        await expect(page.locator('#continueButtonSuccess')).toBeVisible();
        await expect(page.locator('#repeatButtonSuccess')).toBeVisible();

        expect(observed.errors).toEqual([]);
    });

    test('fallback path renders the blob preview exactly as before', async ({ page }) => {
        await setupReadyScreen(page, { afterVideoActive: null, canvasVisible: false });

        await expect(page.locator('#resultVideo')).toBeVisible();
        await expect(page.locator('[data-testid="after-video-canvas"]')).toHaveCount(0);

        expect(observed.errors).toEqual([]);
    });

    test('tapping the looping canvas is safe: no navigation, loop flag kept', async ({ page }) => {
        await setupReadyScreen(page, { afterVideoActive: 'aftersuccess', canvasVisible: true });
        const canvas = page.locator('[data-testid="after-video-canvas"]');
        await expect(canvas).toBeVisible();
        const urlBefore = page.url();

        // No real loop runs headlessly (no codecs), so the toggle no-ops —
        // this proves the tap surface is wired without breaking the flow.
        await canvas.click({ force: true });
        await expect(canvas).toBeVisible();
        expect(page.url()).toBe(urlBefore);
        await expect.poll(() => page.evaluate(() => window.appStore.getState().afterVideoActive)).toBe('aftersuccess');

        expect(observed.errors).toEqual([]);
    });

    test('Share with no running loop is a safe no-op for the swap', async ({ page }) => {
        await setupReadyScreen(page, { afterVideoActive: null, canvasVisible: false });
        await expect(page.locator('#createVideoButton')).toBeVisible();

        await page.locator('#createVideoButton').click({ force: true });
        await expect.poll(() => page.evaluate(() => window.appStore.getState().afterVideoActive)).toBe(null);

        expect(observed.errors).toEqual([]);
    });

    test('reset clears the loop flag and hides the canvas', async ({ page }) => {
        await setupReadyScreen(page, { afterVideoActive: 'aftersuccess', canvasVisible: true });
        await expect(page.locator('[data-testid="after-video-canvas"]')).toBeVisible();

        await page.evaluate(() => window.appStore.getState().resetForNextStep());
        await expect(page.locator('[data-testid="after-video-canvas"]')).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => window.appStore.getState().afterVideoActive)).toBe(null);

        expect(observed.errors).toEqual([]);
    });
});
