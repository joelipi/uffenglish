// @ts-check
import { test, expect } from '@playwright/test';

// Lesson g carries a responseType:"success" step with simpleVideoUrl:"success".
const LESSON_URL = '/course/model/lesson/g';

// Invalid (but codec-independent) media source. We never let it autoplay or
// end on its own, so the pre-reveal state is deterministic and the spec does
// not depend on H.264 decoding (Playwright's bundled Chromium lacks it).
const SENTINEL_SRC = 'data:video/mp4;base64,AAAA';

const NOISE = ['favicon', 'source map', 'Whisper', 'vite', '401', 'Unauthorized', 'ERR_CACHE_WRITE_FAILURE'];

test.describe('Success screen — concat button reveal', () => {
    let errors = [];
    let transitionWarnings = [];

    test.beforeEach(async ({ page }) => {
        errors = [];
        transitionWarnings = [];

        page.on('pageerror', e => errors.push(e.message));
        page.on('console', msg => {
            const text = msg.text();
            const loc = msg.location()?.url || '';
            if (msg.type() === 'error') {
                // bootstrap-icons fonts 403 through the symlinked node_modules
                // in this worktree; unrelated to the app under test.
                if (!NOISE.some(n => text.includes(n)) && !loc.includes('bootstrap-icons')) {
                    errors.push(text);
                }
            }
            if (msg.type() === 'warning' && text.includes('Unexpected transition')) {
                transitionWarnings.push(text);
            }
        });
        page.on('dialog', d => d.dismiss());

        // Reject play() only for the sentinel video so it can never autoplay
        // or fire `ended` on its own. Every other video plays normally.
        await page.addInitScript(() => {
            const origPlay = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function () {
                if (typeof this.src === 'string' && this.src.startsWith('data:video/mp4')) {
                    return Promise.reject(new DOMException('autoplay disabled for test', 'NotAllowedError'));
                }
                return origPlay.apply(this, arguments);
            };
        });
    });

    /** Wait until the async lesson bootstrap has loaded lesson g's intro step. */
    async function waitForLessonReady(page) {
        await page.waitForFunction(() => {
            const s = window.appStore?.getState();
            return s?.activeLessonId === 'g' && s?.currentVideo?.type === 'intro';
        }, null, { timeout: 25000 });
        // Let any remaining post-load microtasks settle before overriding state.
        await page.waitForTimeout(500);
    }

    /** Load lesson g, close the guest modal, and mount a pending success video. */
    async function setupSuccessScreen(page, { withVideo = true } = {}) {
        await page.goto(LESSON_URL);
        await page.waitForFunction(() => window.appStore?.getState()?.configData, null, { timeout: 20000 });
        await waitForLessonReady(page);
        await page.evaluate(({ sentinel, withVideo }) => {
            const s = window.appStore.getState();
            // Keep the guest dialog from making the page inert; treat as logged
            // in so SaveClipsModal does not open either.
            s.setGuestModalOpen(false);
            s.setGuestModalShownThisSession(true);
            window.appStore.setState({
                isLoggedIn: true,
                userData: { native_language: 'en', auth_method: 'supabase', $id: 'test-user' },
            });
            s.setSuccessScreen('g', { total: 85 });
            if (withVideo) {
                s.setCurrentVideo({
                    type: 'simple',
                    responseType: 'success',
                    url: sentinel,
                    config: { subtitles: '' },
                });
            } else {
                s.setCurrentVideo(null);
            }
            s.transitionTo('lessonSuccess', { lessonId: 'g', fluencyData: { total: 85 } }, { fromStepLoad: true });
        }, { sentinel: SENTINEL_SRC, withVideo });
    }

    /** Wait out the 3s FOUC fallback that makes the video wrapper visible. */
    async function waitForVideoWrapper(page) {
        await page.waitForSelector('.ivp-video', { state: 'attached', timeout: 5000 });
        await expect(page.locator('.ivp-main-wrapper')).toBeVisible({ timeout: 6000 });
    }

    async function endSuccessVideo(page) {
        await page.evaluate(() => {
            document.querySelector('.ivp-video')?.dispatchEvent(new Event('ended'));
        });
        await page.waitForFunction(
            () => window.appStore.getState().appPhase === 'lessonSuccess-decisionTime',
            null,
            { timeout: 5000 }
        );
    }

    test('lessonSuccess-decisionTime maps the success screen zones', async ({ page }) => {
        await page.goto(LESSON_URL);
        await page.waitForFunction(() => window.appStore?.getState()?.configData, null, { timeout: 20000 });
        await waitForLessonReady(page);

        const state = await page.evaluate(() => {
            window.appStore.getState().transitionTo('lessonSuccess-decisionTime', {}, { fromStepLoad: true });
            const s = window.appStore.getState();
            return {
                appPhase: s.appPhase,
                bottomState: s.bottomState,
                mediaState: s.mediaState,
                showMission: s.showMission,
            };
        });

        expect(state).toEqual({
            appPhase: 'lessonSuccess-decisionTime',
            bottomState: 'lessonSuccess',
            mediaState: 'decisionOverlay',
            showMission: false,
        });
        expect(transitionWarnings).toEqual([]);
    });

    test('concat button stays hidden while the success video plays', async ({ page }) => {
        await setupSuccessScreen(page);
        await waitForVideoWrapper(page);

        await expect(page.locator('#processBtn')).toHaveCount(0);
        await expect(page.locator('.ivp-overlay.water-surface')).toHaveCount(0);
    });

    test('success video end reveals overlay copy and the big glowing CONTINUE button', async ({ page }) => {
        await setupSuccessScreen(page);
        await waitForVideoWrapper(page);
        await expect(page.locator('#processBtn')).toHaveCount(0);

        await endSuccessVideo(page);

        const overlay = page.locator('.ivp-overlay.water-surface');
        await expect(overlay).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.ivp-overlay-text')).toHaveText('Continue to create and share your video');

        const btn = page.locator('#processBtn');
        await expect(btn).toBeVisible();
        await expect(btn).toHaveClass(/\bcall-btn\b/);

        const box = await btn.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(56);
        expect(box.width).toBeLessThanOrEqual(64);
        expect(box.height).toBeGreaterThanOrEqual(56);
        expect(box.height).toBeLessThanOrEqual(64);

        const glow = await btn.evaluate(el => {
            const cs = getComputedStyle(el, '::before');
            return { animationName: cs.animationName, boxShadow: cs.boxShadow };
        });
        expect(glow.animationName).toContain('btnGlowPulse');
        expect(glow.boxShadow).not.toBe('none');

        await expect(page.locator('#state-lesson-success .ivp-choice-label-text')).toHaveText('CONTINUE');

        expect(errors).toEqual([]);
    });

    test('reveals the button immediately when the success step has no video', async ({ page }) => {
        await setupSuccessScreen(page, { withVideo: false });

        await expect(page.locator('#processBtn')).toBeVisible();
        await expect(page.locator('#state-lesson-success .ivp-choice-label-text')).toHaveText('CONTINUE');
    });

    test('view-and-continue video end keeps the earlier overlay copy', async ({ page }) => {
        await page.goto(LESSON_URL);
        await page.waitForFunction(() => window.appStore?.getState()?.configData, null, { timeout: 20000 });
        await waitForLessonReady(page);
        await page.evaluate((sentinel) => {
            const s = window.appStore.getState();
            s.setGuestModalOpen(false);
            s.setGuestModalShownThisSession(true);
            s.setCurrentVideo({
                type: 'simple',
                responseType: 'viewAndContinue',
                url: sentinel,
                config: { subtitles: '' },
            });
            s.transitionTo('viewAndContinueVideo', {}, { fromStepLoad: true });
        }, SENTINEL_SRC);
        await waitForVideoWrapper(page);

        await page.evaluate(() => {
            document.querySelector('.ivp-video')?.dispatchEvent(new Event('ended'));
        });
        await page.waitForFunction(
            () => window.appStore.getState().appPhase === 'simpleVideo-decisionTime-viewAndContinue',
            null,
            { timeout: 5000 }
        );

        await expect(page.locator('.ivp-overlay-text')).toHaveText('Press a button below.');
    });

    test('clicking the revealed button starts processing', async ({ page }) => {
        await page.route('**/video-processor.js*', route => route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: [
                'export async function processVideo() { return { blob: null }; }',
                'export async function shareVideo() {}',
                'export async function exportSegmentsToR2() {}',
            ].join('\n'),
        }));

        await setupSuccessScreen(page);
        await waitForVideoWrapper(page);
        await endSuccessVideo(page);

        // The button intentionally floats (floatBob) like the earlier steps, so
        // Playwright's stability check never settles — force the click.
        await page.locator('#processBtn').click({ force: true });
        await expect.poll(() => page.evaluate(() => window.appStore.getState().successVideoButton.state)).toBe('processing');
        await expect.poll(() => page.evaluate(() => window.appStore.getState().successCanvasVisible)).toBe(true);

        expect(errors).toEqual([]);
    });
});
