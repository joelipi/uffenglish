// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Success Screen Integration', () => {
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

    test('triggers success screen via store and renders buttons, hides mission', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(1000);

        // Simulate success screen
        await page.evaluate(() => {
            const state = window.appStore.getState();
            state.setSuccessScreen('test-lesson-id', { total: 85 });
            state.setAppPhase('lessonSuccess', { lessonId: 'test-lesson-id', fluencyData: { total: 85 } });
        });

        // Success screen container should appear
        const successContainer = page.locator('#state-lesson-success');
        await expect(successContainer).toBeVisible({ timeout: 3000 });

        // Process (video) button should be visible
        const processBtn = page.locator('#processBtn');
        await expect(processBtn).toBeVisible();

        // Continue button should NOT be visible initially (only after video)
        const continueBtn = page.locator('#continueButtonSuccess');
        await expect(continueBtn).not.toBeVisible();

        // Mission section should be hidden
        const mission = page.locator('.mission-section');
        await expect(mission).not.toBeVisible();

        // No errors
        const filtered = errors.filter(e =>
            !e.includes('favicon') &&
            !e.includes('401') &&
            !e.includes('Unauthorized')
        );
        expect(filtered).toEqual([]);
    });

    test('continue button appears after video state set to ready', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(1000);

        await page.evaluate(() => {
            const state = window.appStore.getState();
            state.setSuccessScreen('test-lesson-id', { total: 85 });
            state.setAppPhase('lessonSuccess', { lessonId: 'test-lesson-id', fluencyData: { total: 85 } });
        });

        // Initially hidden
        await expect(page.locator('#continueButtonSuccess')).not.toBeVisible();

        // Simulate video generation complete
        await page.evaluate(() => {
            window.appStore.getState().setSuccessContinueVisible(true);
        });

        // Now visible
        await expect(page.locator('#continueButtonSuccess')).toBeVisible({ timeout: 3000 });
    });

    test('repeat button appears after video ready', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(1000);

        await page.evaluate(() => {
            const state = window.appStore.getState();
            state.setSuccessScreen('test-lesson-id', { total: 85 });
            state.setAppPhase('lessonSuccess', { lessonId: 'test-lesson-id', fluencyData: { total: 85 } });
        });

        // Initially hidden
        await expect(page.locator('#repeatButtonSuccess')).not.toBeVisible();

        // Simulate video ready
        await page.evaluate(() => {
            window.appStore.getState().setSuccessRepeatButtonVisible(true);
        });

        // Now visible
        await expect(page.locator('#repeatButtonSuccess')).toBeVisible({ timeout: 3000 });
    });

    test('success screen hides when resetForNextStep runs', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(1000);

        await page.evaluate(() => {
            const state = window.appStore.getState();
            state.setSuccessScreen('test-lesson-id', { total: 85 });
            state.setAppPhase('lessonSuccess', { lessonId: 'test-lesson-id', fluencyData: { total: 85 } });
        });

        await expect(page.locator('#state-lesson-success')).toBeVisible({ timeout: 3000 });

        // Reset should hide success screen
        await page.evaluate(() => {
            window.appStore.getState().resetForNextStep();
        });

        await expect(page.locator('#state-lesson-success')).not.toBeVisible();
    });

    test('success video blob renders SuccessVideo component', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(1000);

        // No resultVideo initially
        await expect(page.locator('#resultVideo')).not.toBeVisible();

        // Set a blob
        const hasVideo = await page.evaluate(() => {
            const blob = new Blob(['fake'], { type: 'video/webm' });
            window.appStore.getState().setSuccessVideoBlob(blob);
            return true;
        });

        // resultVideo should now be in the DOM
        await expect(page.locator('#resultVideo')).toBeVisible({ timeout: 3000 });

        // Clear blob
        await page.evaluate(() => {
            window.appStore.getState().clearSuccessVideoBlob();
        });

        // resultVideo should disappear
        await expect(page.locator('#resultVideo')).not.toBeVisible({ timeout: 3000 });
    });

    test('chatHistory is initialized as array (no crash)', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });

        const chatHistoryType = await page.evaluate(() => {
            return typeof window.appStore.getState().chatHistory;
        });

        expect(chatHistoryType).toBe('object'); // arrays are 'object'
        
        const isArray = await page.evaluate(() => {
            return Array.isArray(window.appStore.getState().chatHistory);
        });

        expect(isArray).toBe(true);
    });
});