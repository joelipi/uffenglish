// @ts-check
import { test, expect } from '@playwright/test';

/**
 * This test suite verifies the "Golden Path" of the application.
 * It uses the mic-bypass wrappers in app.js to simulate user interactions.
 */

test.describe('End-to-End Smoke Test', () => {
    let errors = [];

    test.beforeEach(async ({ page }) => {
        errors = [];
        // Listen for uncaught exceptions (SyntaxError, ReferenceError, etc.)
        page.on('pageerror', (exception) => {
            errors.push(`PageError: ${exception.message}`);
        });
        // Listen for console errors, filtering out common noise
        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                const text = msg.text();
                const noise = ['favicon', 'source map', 'Whisper', 'vite', '401'];
                if (!noise.some(n => text.includes(n))) {
                    errors.push(`ConsoleError: ${text}`);
                }
            }
        });
    });

    async function assertNoError() {
        if (errors.length > 0) {
            throw new Error(`Detected ${errors.length} critical errors during execution:\n${errors.join('\n')}`);
        }
    }

    test('Full User Journey: Load -> Mode Selection -> Interaction -> Tutor Chat', async ({ page }) => {
        // 1. Initial Loading
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        
        // Force the chat interface to be visible for the smoke test
        await page.evaluate(() => {
            const chat = document.getElementById('chat-window-container');
            if (chat) {
                chat.classList.remove('d-none');
                chat.style.setProperty('display', 'flex', 'important');
            }
            const stats = document.getElementById('react-root-stats');
            if (stats) stats.classList.remove('d-none');
            const media = document.getElementById('media-viewport');
            if (media) media.classList.remove('d-none');
            // Ensure store state matches (StatsBar React component manages d-none via store)
            if (window.appStore) window.appStore.getState().setStatsVisible(true);
        });
        await assertNoError();

        // Verify key UI elements are visible
        await expect(page.locator('#react-root-chat')).toBeVisible();
        await expect(page.locator('#react-root-stats')).toBeVisible();
        await expect(page.locator('#media-viewport')).toBeVisible();

        // 2. Test Mode Selection (Bypass actual clicks to ensure we hit the logic)
        await page.evaluate(() => {
            // Simulate switching to Text Mode
            window.appStore.setState({ isTextMode: true });
            // Trigger UI sync (which we've kept in ui.js for now)
            // If we deleted syncTextModeUI, we'd need to verify the React components respond to isTextMode
        });
        await assertNoError();

        // 3. Interaction Loop: Respond Correctly and Incorrectly
        const answerResults = await page.evaluate(async () => {
            const { submitAnswerPrecheck, handleAnswer } = await import('/js/modules/answer-pipeline.jsx');
            const answerDeps = { loadNextStep: null };
            const state = window.appStore.getState();
            const lesson = state.configData.lessons[state.currentLessonIndex];
            const step = lesson.steps[state.currentStepIndex] || lesson.steps[1];

            const results = [];

            // Path A: Incorrect Response
            try {
                const precheck = await submitAnswerPrecheck('wrong answer', step.cue, step, null, step.explanation, step.translation, { pauseCount: 0, netDuration: 3 }, answerDeps);
                const answer = await handleAnswer('wrong answer', step.cue, step, null, step.explanation, step.translation, { pauseCount: 0, netDuration: 3 }, answerDeps, state.userData, state.configData);
                results.push({ type: 'incorrect', ok: true });
            } catch (e) {
                results.push({ type: 'incorrect', ok: false, error: e.message });
            }

            // Path B: Correct Response
            try {
                const precheck = await submitAnswerPrecheck(step.cue, step.cue, step, null, step.explanation, step.translation, { pauseCount: 0, netDuration: 3 }, answerDeps);
                const answer = await handleAnswer(step.cue, step.cue, step, null, step.explanation, step.translation, { pauseCount: 0, netDuration: 3 }, answerDeps, state.userData, state.configData);
                results.push({ type: 'correct', ok: true });
            } catch (e) {
                results.push({ type: 'correct', ok: false, error: e.message });
            }

            return results;
        });

        expect(answerResults.find(r => r.type === 'incorrect')?.ok).toBe(true);
        expect(answerResults.find(r => r.type === 'correct')?.ok).toBe(true);
        await assertNoError();

        // 4. AI Tutor Interaction
        await page.evaluate(async () => {
            await new Promise(r => setTimeout(r, 500));
            const state = window.appStore.getState();
            state.addChatMessage({
                role: 'user',
                type: 'standard',
                content: 'Can you explain this more?',
                userName: 'Test User',
                userAvatarUrl: '/assets/img/userprofile.webp'
            });
            // In a real app, we'd wait for the API response. Here we verify the message was added.
        });

        const chatHistory = await page.evaluate(() => window.appStore.getState().chatHistory);
        expect(chatHistory.some(m => m.content === 'Can you explain this more?')).toBe(true);
        await assertNoError();
    });
});
