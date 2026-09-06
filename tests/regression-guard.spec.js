// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Regression Guard — Store, DOM IDs, Module Imports', () => {
    let errors = [];

    test.beforeEach(async ({ page }) => {
        errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', msg => {
            if (msg.type() === 'error') {
                const text = msg.text();
                const noise = ['favicon', 'source map', 'Whisper', 'vite', '401', 'Unauthorized'];
                if (!noise.some(n => text.includes(n))) {
                    errors.push(text);
                }
            }
        });
    });

    test('app loads without console errors', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(2000);

        const filtered = errors.filter(e =>
            !e.includes('favicon') &&
            !e.includes('401') &&
            !e.includes('Unauthorized')
        );
        expect(filtered).toEqual([]);
    });

    test('no duplicate DOM IDs for resultVideo', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(1000);

        // There should be at most one #resultVideo
        const count = await page.evaluate(() => {
            return document.querySelectorAll('#resultVideo').length;
        });
        expect(count).toBeLessThanOrEqual(1);
    });

    test('no duplicate DOM IDs for displayCanvas', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(1000);

        const count = await page.evaluate(() => {
            return document.querySelectorAll('#displayCanvas').length;
        });
        expect(count).toBeLessThanOrEqual(1);
    });

    test('no duplicate DOM IDs for state-lesson-success', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(1000);

        const count = await page.evaluate(() => {
            return document.querySelectorAll('#state-lesson-success').length;
        });
        expect(count).toBeLessThanOrEqual(1);
    });

    test('successHandler is no longer in store', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });

        const hasHandler = await page.evaluate(() => {
            return 'successHandler' in window.appStore.getState();
        });
        expect(hasHandler).toBe(false);
    });

    test('chatHistory is array and not undefined', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });

        const result = await page.evaluate(() => {
            const state = window.appStore.getState();
            return {
                isArray: Array.isArray(state.chatHistory),
                length: state.chatHistory?.length ?? -1
            };
        });
        expect(result.isArray).toBe(true);
        expect(result.length).toBeGreaterThanOrEqual(0);
    });

    test('resetForNextStep resets all success screen state', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });

        // Set success screen state
        await page.evaluate(() => {
            const s = window.appStore.getState();
            s.setSuccessScreen('test-id', { total: 85 });
            s.setSuccessContinueVisible(true);
            s.setSuccessRepeatButtonVisible(true);
            s.setSuccessVideoState('ready');
            s.setSuccessCanvasVisible(true);
        });

        // Reset
        await page.evaluate(() => {
            window.appStore.getState().resetForNextStep();
        });

        const result = await page.evaluate(() => {
            const s = window.appStore.getState();
            return {
                successScreenVisible: s.successScreenVisible,
                successLessonId: s.successLessonId,
                successFluencyData: s.successFluencyData,
                successContinueButtonVisible: s.successContinueButton.visible,
                successVideoButtonState: s.successVideoButton.state,
                successRepeatButtonVisible: s.successRepeatButton.visible,
                successCanvasVisible: s.successCanvasVisible,
                successVideoBlob: s.successVideoBlob
            };
        });

        expect(result.successScreenVisible).toBe(false);
        expect(result.successLessonId).toBeNull();
        expect(result.successFluencyData).toBeNull();
        expect(result.successContinueButtonVisible).toBe(false);
        expect(result.successVideoButtonState).toBe('idle');
        expect(result.successRepeatButtonVisible).toBe(false);
        expect(result.successCanvasVisible).toBe(false);
        expect(result.successVideoBlob).toBeNull();
    });

    test('bottomState resets to hidden on resetForNextStep', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });

        await page.evaluate(() => {
            window.appStore.getState().transitionTo('lessonSuccess');
        });

        await page.evaluate(() => {
            window.appStore.getState().resetForNextStep();
        });

        const state = await page.evaluate(() => window.appStore.getState().bottomState);
        expect(state).toBe('hidden');
    });

    test('loadLessonContent is importable', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });

        const result = await page.evaluate(async () => {
            try {
                const { loadLessonContent } = await import('/src/modules/lesson/lesson-loader.js');
                return { ok: true, type: typeof loadLessonContent };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        });
        expect(result.ok).toBe(true);
        expect(result.type).toBe('function');
    });

    test('handleSuccessStep uses store (no successHandler)', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(2000);

        const result = await page.evaluate(async () => {
            const { handleSuccessStep } = await import('/src/modules/lesson/step-loader-logic.js');
            const state = window.appStore.getState();
            const step = {
                lessonId: state.configData.lessons[state.currentLessonIndex]?.lessonId || 'test',
                stepType: 'success',
                subtitles: { en: 'Great!', es: '¡Bien!' },
                simpleVideoUrl: 'success'
            };
            try {
                handleSuccessStep(step, { total: 85 });
                // Read state after the call
                const newState = window.appStore.getState();
                return {
                    successScreenVisible: newState.successScreenVisible,
                    successLessonId: newState.successLessonId,
                    error: undefined
                };
            } catch (e) {
                return { error: e.message };
            }
        });

        expect(result.error).toBeUndefined();
        expect(result.successScreenVisible).toBe(true);
        expect(result.successLessonId).toBeTruthy();
    });

    test('old success-lesson.js module is not loadable', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });

        // Attempting to import the old module should fail
        const result = await page.evaluate(async () => {
            try {
                await import('/js/components/success-lesson.js');
                return { loaded: true };
            } catch (e) {
                return { loaded: false, error: e.message };
            }
        });

        // If it loaded, it means the file still exists in the build
        // This test guards against accidentally re-adding it
        // We expect it to be deleted, so the import should fail
        // But if Vite bundles it, it might still load — that's OK as long as
        // no SuccessLessonHandler is in the store
        expect(result.loaded).toBe(false);
    });
});