// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Story 029: on a friend lesson (`?shareCode=` or lesson id a/b) the FIRST
// response step must skip the one-button `firstResponse` mode chooser and use
// its normal per-video flow — simple clip → simpleVideo (mic hidden, subtitles
// low) → `simpleVideo-decisionTime-response` overlay (story 028); interactive
// clip → `interactiveVideo+<type>`; no clip → `recording/answering`. Non-friend
// lessons keep the chooser.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// A tiny valid VP9/WebM clip (616 bytes, generated with ffmpeg). Bundled
// Chromium decodes WebM natively, unlike H.264, so the video loads and does not
// fire `error`; autoplay is blocked below so `ended` only fires when we dispatch
// it. This keeps the pre-overlay state deterministic without codec flakiness.
const SENTINEL_SRC = 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAI4EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggIi7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiEBpAAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYjcq/RnP6WRk5yBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhAJiWgDgibCBELqBEJqBAhJUw2dAgHNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjAuMTYuMTAwc3PaY8CLY8WI3Kv0Zz+lkZNnyKVFo4dFTkNPREVSRIeYTGF2YzYwLjMxLjEwMiBsaWJ2cHgtdnA5Z8ihRaOIRFVSQVRJT05Eh5MwMDowMDowMC4yMDAwMDAwMDAAH0O2dfnngQCjoIEAAICCSYNCAADwAPYAOCQcGEoAADBgAAAQv//9SIwAo5OBACgAhgBAkpwAUAAAAyAAAEJAo5OBAFAAhgBAkpwATuAAAyAAAEJAo5OBAHgAhgBAkpwAUAAAAyAAAEJAo5OBAKAAhgBAkpwATUAAAyAAAEJAHFO7a5G7j7OBALeK94EB8YIBpPCBAw==';

const NOISE = ['favicon', 'source map', 'Whisper', 'vite', '401', 'Unauthorized', 'ERR_CACHE_WRITE_FAILURE'];

// Never fulfil media requests: keeps real clips from loading/ending/erroring
// underneath the synchronous phase assertions.
const HANG = () => { /* intentionally never fulfill — keeps the request pending */ };

test.describe('friend lessons: first question skips the mode chooser', () => {
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

    // The guest language modal gates config normalisation: an anonymous visitor
    // must confirm a language before `configData` is set. Confirm English when
    // offered, then dismiss the non-friend login-choice step if it appears.
    async function confirmGuestLanguage(page) {
        await page.waitForFunction(
            () => window.appStore?.getState()?.configData || document.querySelector('#guestEnglishOnlyBtn'),
            null,
            { timeout: 30000 }
        );
        if (await page.locator('#guestEnglishOnlyBtn').count()) {
            await page.click('#guestEnglishOnlyBtn').catch(() => {});
            const continueBtn = page.locator('#guestContinueBtn');
            await continueBtn.waitFor({ state: 'visible', timeout: 3000 }).then(() => continueBtn.click()).catch(() => {});
        }
        await page.waitForFunction(() => window.appStore?.getState()?.configData, null, { timeout: 20000 });
    }

    /** Wait until the async lesson bootstrap has mounted the lesson intro step. */
    async function waitForLessonReady(page, lessonId) {
        await page.waitForFunction((id) => {
            const s = window.appStore?.getState();
            return s?.activeLessonId === id && s?.currentVideo?.type === 'intro' && s?.appPhase === 'lessonIntro';
        }, lessonId, { timeout: 25000 });
    }

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

    /** Wait out the 3s FOUC fallback that makes the video wrapper visible. */
    async function waitForVideoWrapper(page) {
        await page.waitForSelector('.ivp-video', { state: 'attached', timeout: 5000 });
        await expect(page.locator('.ivp-main-wrapper')).toBeVisible({ timeout: 6000 });
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

        expect(transitionWarnings).toEqual([]);
        expect(errors).toEqual([]);
    });

    test('friend lesson via ?shareCode= on wa: first response step goes interactive', async ({ page }) => {
        await page.route(/\.mp4(\?.*)?$/, HANG);
        await page.goto('/course/model/lesson/wa?shareCode=friendtest1');
        await confirmGuestLanguage(page);
        await waitForLessonReady(page, 'wa');

        const snap = await loadStepIndex(page, 2);
        expect(snap.appPhase).toBe('interactiveVideo+friendClosedResponse');
        await expect(page.locator('#state-intro-choices')).toHaveCount(0);
        expect(transitionWarnings).toEqual([]);
    });

    test('friend lesson via ?shareCode= on g: closed response goes interactive+closedResponse', async ({ page }) => {
        await page.route(/\.mp4(\?.*)?$/, HANG);
        await page.goto('/course/model/lesson/g?shareCode=friendtest1');
        await confirmGuestLanguage(page);
        await waitForLessonReady(page, 'g');

        const snap = await loadStepIndex(page, 1);
        expect(snap.appPhase).toBe('interactiveVideo+closedResponse');
        await expect(page.locator('#state-intro-choices')).toHaveCount(0);
        expect(transitionWarnings).toEqual([]);
    });

    test('non-friend lesson w keeps the firstResponse chooser', async ({ page }) => {
        await page.route(/\.mp4(\?.*)?$/, HANG);
        await page.goto('/course/model/lesson/w');
        await confirmGuestLanguage(page);
        await waitForLessonReady(page, 'w');

        const snap = await loadStepIndex(page, 1);
        expect(snap.appPhase).toBe('firstResponse');
        await expect(page.locator('#state-intro-choices')).toHaveCount(1);
        expect(transitionWarnings).toEqual([]);
    });

    test('non-friend lesson wa (no share code) keeps the firstResponse chooser', async ({ page }) => {
        await page.route(/\.mp4(\?.*)?$/, HANG);
        await page.goto('/course/model/lesson/wa');
        await confirmGuestLanguage(page);
        await waitForLessonReady(page, 'wa');

        const snap = await loadStepIndex(page, 2);
        expect(snap.appPhase).toBe('firstResponse');
        await expect(page.locator('#state-intro-choices')).toHaveCount(1);
        expect(transitionWarnings).toEqual([]);
    });
});
