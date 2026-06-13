// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Answer Flow — mic bypass integration test', () => {
    let errors = [];

    test.beforeEach(async ({ page }) => {
        errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', msg => {
            if (msg.type() === 'error') {
                const text = msg.text();
                const noise = ['favicon', 'source map', 'Whisper', 'vite', '401 (Unauthorized)'];
                if (!noise.some(n => text.includes(n))) {
                    errors.push(text);
                }
            }
        });
    });

    test('submitAnswerPrecheck and handleAnswer wrappers resolve without error', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));
        page.on('console', msg => {
            if (msg.type() === 'error') errors.push(msg.text());
        });

        await page.goto('/course/gt2/lesson/a');

        // Wait for lesson to fully initialize
        await page.waitForFunction(() => {
            const state = window.appStore?.getState();
            return state && state.configData && state.currentLessonIndex >= 0;
        }, { timeout: 20000 });

        // Import the wrappers and call submitAnswerPrecheck with a mock speech response
        const precheckResult = await page.evaluate(async () => {
            const { createAnswerPipeline } = await import('/src/modules/answer/answer-pipeline.js');
            const { showChat, addAIFeedbackMessages, clearChat } = await import('/src/components/chat/chat-interface.js');
            const pipeline = createAnswerPipeline({
                showChat,
                clearChat,
                addAIFeedbackMessages,
                playSound: () => {},
                enableAudioSystem: () => {},
                preloadVideo: () => {},
                warmUpSpeechCam: () => {},
            });
            const answerDeps = { loadNextStep: null };
            const state = window.appStore.getState();
            const lesson = state.configData.lessons[state.currentLessonIndex];
            const step = lesson.steps[state.currentStepIndex] || lesson.steps[1];
            try {
                await pipeline.submitAnswerPrecheck(
                    'hello there',
                    step.cue,
                    step,
                    null,
                    step.explanation || '',
                    step.translation || null,
                    { pauseCount: 0, netDuration: 3 },
                    answerDeps,
                    state.userData,
                    state.configData
                );
                return { ok: true };
            } catch (e) {
                return { ok: false, error: e.message, stack: e.stack };
            }
        });

        if (!precheckResult.ok) {
            console.log('submitAnswerPrecheck failed:', precheckResult.error);
        }
        expect(precheckResult.ok).toBe(true);

        // Also test handleAnswer wrapper directly (simulates speech.js call)
        const answerResult = await page.evaluate(async () => {
            const { createAnswerPipeline } = await import('/src/modules/answer/answer-pipeline.js');
            const { showChat, addAIFeedbackMessages, clearChat } = await import('/src/components/chat/chat-interface.js');
            const pipeline = createAnswerPipeline({
                showChat,
                clearChat,
                addAIFeedbackMessages,
                playSound: () => {},
                enableAudioSystem: () => {},
                preloadVideo: () => {},
                warmUpSpeechCam: () => {},
            });
            const answerDeps = { loadNextStep: null };
            const state = window.appStore.getState();
            const lesson = state.configData.lessons[state.currentLessonIndex];
            const step = lesson.steps[state.currentStepIndex] || lesson.steps[1];
            try {
                await pipeline.handleAnswer(
                    'hello there',
                    step.cue,
                    step,
                    null,
                    step.explanation || '',
                    step.translation || null,
                    { pauseCount: 0, netDuration: 3 },
                    answerDeps,
                    state.userData,
                    state.configData
                );
                return { ok: true };
            } catch (e) {
                return { ok: false, error: e.message, stack: e.stack };
            }
        });

        if (!answerResult.ok) {
            console.log('handleAnswer (9-arg) failed:', answerResult.error);
        }
        expect(answerResult.ok).toBe(true);

        // No page errors
        expect(errors.filter(e =>
            !e.includes('favicon') &&
            !e.includes('source map') &&
            !e.includes('Whisper') &&
            !e.includes('vite') &&
            !e.includes('401') &&
            !e.includes('Unauthorized')
        )).toEqual([]);
    });

});
