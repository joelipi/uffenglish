// @ts-check
import { test, expect } from '@playwright/test';

// Lesson g carries a responseType:"success" step with simpleVideoUrl:"success".
const LESSON_URL = '/course/model/lesson/g';

// A tiny valid VP9/WebM clip (616 bytes, generated with ffmpeg). Bundled
// Chromium decodes WebM natively, unlike H.264, so the video loads and does not
// fire `error`; autoplay is blocked below so `ended` only fires when we dispatch
// it. This keeps the pre-reveal state deterministic without codec flakiness.
const SENTINEL_SRC = 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAI4EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggIi7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiEBpAAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYjcq/RnP6WRk5yBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhAJiWgDgibCBELqBEJqBAhJUw2dAgHNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjAuMTYuMTAwc3PaY8CLY8WI3Kv0Zz+lkZNnyKVFo4dFTkNPREVSRIeYTGF2YzYwLjMxLjEwMiBsaWJ2cHgtdnA5Z8ihRaOIRFVSQVRJT05Eh5MwMDowMDowMC4yMDAwMDAwMDAAH0O2dfnngQCjoIEAAICCSYNCAADwAPYAOCQcGEoAADBgAAAQv//9SIwAo5OBACgAhgBAkpwAUAAAAyAAAEJAo5OBAFAAhgBAkpwATuAAAyAAAEJAo5OBAHgAhgBAkpwAUAAAAyAAAEJAo5OBAKAAhgBAkpwATUAAAyAAAEJAHFO7a5G7j7OBALeK94EB8YIBpPCBAw==';

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
                if (typeof this.src === 'string' && this.src.startsWith('data:video/webm')) {
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
            return s?.activeLessonId === 'g' && s?.currentVideo?.type === 'intro' && s?.appPhase === 'lessonIntro';
        }, null, { timeout: 25000 });
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

    test('concat button is always present; it only glows after the success video ends', async ({ page }) => {
        await setupSuccessScreen(page);
        await waitForVideoWrapper(page);

        // Present and pressable the whole time — never hidden (a blocked or
        // stalled clip must not strand the learner with no button).
        await expect(page.locator('#processBtn')).toBeVisible();
        await expect(page.locator('#state-lesson-success .ivp-choice-label-text')).toHaveText('CONTINUE');

        // The call-btn column layout is kept even before the glow, so the
        // button stays centred under its label (regression guard).
        const wrap = page.locator('#processBtn').locator('..');
        await expect(wrap).toHaveClass(/\bivp-choice-col\b/);
        await expect(wrap).toHaveClass(/\bprocess-btn-pending\b/);
        const centerOffset = await page.locator('#processBtn').evaluate(el => {
            const r = el.getBoundingClientRect();
            return Math.abs(r.x + r.width / 2 - innerWidth / 2);
        });
        expect(centerOffset).toBeLessThanOrEqual(2);

        // Not glowing yet, and no overlay.
        const glowBefore = await page.locator('#processBtn').evaluate(el => getComputedStyle(el, '::before').animationName);
        expect(glowBefore).toBe('none');
        await expect(page.locator('.ivp-overlay.water-surface')).toHaveCount(0);
    });

    test('restoring directly to the success step reveals the overlay without waiting for the clip', async ({ page }) => {
        await page.goto(LESSON_URL);
        await page.waitForFunction(() => window.appStore?.getState()?.configData, null, { timeout: 20000 });
        await waitForLessonReady(page);

        const phases = await page.evaluate(async (webm) => {
            const { handleSuccessStep } = await import('/src/modules/lesson/step-loader-logic.js');
            const s = window.appStore.getState();
            s.setGuestModalOpen(false);
            s.setGuestModalShownThisSession(true);
            window.appStore.setState({ isLoggedIn: true, userData: { native_language: 'en', auth_method: 'supabase', $id: 't' } });
            s.setCurrentVideo({ type: 'simple', responseType: 'success', url: webm, config: { subtitles: '' } });
            s.setMediaVisible(true);
            const step = { lessonId: 'g', simpleVideoUrl: 'success', responseType: 'success' };
            // Advanced in-app → stays on lessonSuccess (waits for the clip to end).
            s.setStepLoadedFromRestore(false);
            handleSuccessStep(step, { total: 85 });
            const advanced = window.appStore.getState().appPhase;
            // Loaded directly (page load / signup redirect) → reveals at once.
            s.setStepLoadedFromRestore(true);
            handleSuccessStep(step, { total: 85 });
            const restored = window.appStore.getState().appPhase;
            return { advanced, restored };
        }, SENTINEL_SRC);

        expect(phases.advanced).toBe('lessonSuccess');
        expect(phases.restored).toBe('lessonSuccess-decisionTime');

        // The restored phase drives the water overlay + glowing button at once.
        await expect(page.locator('.ivp-overlay.water-surface')).toBeVisible({ timeout: 3000 });
        const glow = await page.locator('#processBtn').evaluate(el => getComputedStyle(el, '::before').animationName);
        expect(glow).toContain('btnGlowPulse');
    });

    test('success video end reveals overlay copy and the big glowing CONTINUE button', async ({ page }) => {
        await setupSuccessScreen(page);
        await waitForVideoWrapper(page);
        // Present but not glowing before the clip ends.
        await expect(page.locator('#processBtn')).toBeVisible();
        const beforeGlow = await page.locator('#processBtn').evaluate(el => getComputedStyle(el, '::before').animationName);
        expect(beforeGlow).toBe('none');

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

    test('reveals the glow when the success video fails to load', async ({ page }) => {
        await setupSuccessScreen(page);
        await waitForVideoWrapper(page);
        await expect(page.locator('#processBtn')).toBeVisible();

        // Simulate a broken/undecodable clip: `ended` never fires, so the
        // onError fallback must reveal the glow instead of leaving it dim.
        await page.evaluate(() => {
            document.querySelector('.ivp-video')?.dispatchEvent(new Event('error'));
        });

        await page.waitForFunction(
            () => window.appStore.getState().appPhase === 'lessonSuccess-decisionTime',
            null,
            { timeout: 5000 }
        );
        const glow = await page.locator('#processBtn').evaluate(el => getComputedStyle(el, '::before').animationName);
        expect(glow).toContain('btnGlowPulse');
    });

    test('reveals the button (glowing) immediately when the success step has no video', async ({ page }) => {
        await setupSuccessScreen(page, { withVideo: false });

        await expect(page.locator('#processBtn')).toBeVisible();
        await expect(page.locator('#state-lesson-success .ivp-choice-label-text')).toHaveText('CONTINUE');
        const glow = await page.locator('#processBtn').evaluate(el => getComputedStyle(el, '::before').animationName);
        expect(glow).toContain('btnGlowPulse');
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
        // Stub the processor so no real canvas/MediaRecorder work runs. The
        // stubbed module sets window flags so the test can prove it was hit
        // (otherwise the test would pass even if the route were ignored).
        await page.route('**/video-processor.js*', route => route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: [
                'export async function processVideo() { window.__processorStubbed = true; return { blob: null }; }',
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
        // The stub sets this flag, proving the real processor was not invoked.
        await expect.poll(() => page.evaluate(() => window.__processorStubbed === true)).toBe(true);

        expect(errors).toEqual([]);
    });

    test('recap video end shows the share overlay', async ({ page }) => {
        await setupSuccessScreen(page);

        // Mount the generated recap video (SuccessVideo renders on a blob).
        await page.evaluate(() => {
            window.appStore.getState().setSuccessVideoBlob(new Blob(['fake'], { type: 'video/webm' }));
        });
        await expect(page.locator('#resultVideo')).toBeVisible();
        await expect(page.locator('.ivp-overlay.water-surface')).toHaveCount(0);

        // The recap finishes playing.
        await page.evaluate(() => {
            document.querySelector('#resultVideo')?.dispatchEvent(new Event('ended'));
        });

        await expect(page.locator('.ivp-overlay.water-surface')).toBeVisible();
        await expect(page.locator('.ivp-overlay-text')).toHaveText('Share the video with friends so they can practice English with you');
    });
});
