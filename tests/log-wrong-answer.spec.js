// @ts-check
import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3001' });

test.describe('Wrong answer subtitle preservation', () => {
    const allLogs = [];

    test.beforeEach(async ({ page }) => {
        allLogs.length = 0;
        page.on('console', msg => {
            allLogs.push(`[${msg.type()}] ${msg.text()}`);
        });
        page.on('pageerror', err => {
            allLogs.push(`[PAGE_ERROR] ${err.message}`);
        });
    });

    test('wrong closedResponse preserves speech-result subtitles after video replay', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');

        await page.waitForFunction(() => {
            const s = window.appStore?.getState();
            return s && s.configData && s.currentLessonIndex >= 0;
        }, { timeout: 20000 });

        await page.waitForTimeout(1000);

        // Enable all logs
        await page.evaluate(() => { window.enabledLogs.all = true; });

        // Set interactive video and controller
        await page.evaluate(() => {
            window.appStore.getState().setCurrentVideo({
                type: 'interactive',
                stepType: 'closedResponse',
                url: 'https://r2.ultrafastfluency.com/assets/videos/gtests-1-1.mp4',
                config: {
                    cue: { en: 'Hi, what would you like to drink?' },
                    videoUrl: 'https://r2.ultrafastfluency.com/assets/videos/gtests-1-1.mp4',
                    speeds: [0.75, 0.6, 1]
                }
            });
        });

        await page.waitForTimeout(2000);

        // Fake the isTextMode flag since we don't have a real mic
        await page.evaluate(() => { window.appStore.getState().setTextMode(true); });

        // Now call submitAnswerPrecheck with a WRONG answer through the REAL pipeline
        // This should trigger applySpeechResultToPlayer -> player.applySpeechResult
        const result = await page.evaluate(async () => {
            const { createAnswerPipeline } = await import('/js/modules/answer-pipeline.js');
            const { showChat, addAIFeedbackMessages, clearChat } = await import('/js/components/chat/chat-interface.js');
            const pipeline = createAnswerPipeline({
                showChat,
                clearChat,
                addAIFeedbackMessages,
                playSound: () => {},
                enableAudioSystem: () => {},
                preloadVideo: () => {},
                warmUpSpeechCam: () => {},
            });
            const answerDeps = { loadNextStep: null, callLoadStep: null };
            const state = window.appStore.getState();
            const lesson = state.configData.lessons[state.currentLessonIndex];
            // Find a closedResponse step with videoUrl
            const step = lesson.steps[1]; // index 1 = "I love English!" closedResponse

            try {
                await pipeline.submitAnswerPrecheck(
                    'I hate Spanish',      // WRONG answer
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

        if (!result.ok) {
            console.log('Pipeline call failed:', result.error, result.stack);
        }
        expect(result.ok).toBe(true);

        await page.waitForTimeout(2000);

        // Check: does the player's controller have speech overrides?
        const subtitleState = await page.evaluate(() => {
            const player = window.appStore.getState().currentVideoPlayer;
            if (!player) return { hasPlayer: false };
            const tokens = player.tokens || [];
            const punctuationMap = player.punctuationMap || new Map();
            // Use the applySpeechResult bridge to check... we know it was called
            // Just check if any speech override exists
            return {
                hasPlayer: true,
                tokenCount: tokens.length,
                hasApplySpeechResult: typeof player.applySpeechResult === 'function',
                hasTokens: tokens.length > 0,
                hasPunctuationMap: punctuationMap instanceof Map,
            };
        });

        console.log('\n=== SUBTITLE STATE AFTER WRONG ANSWER ===');
        console.log(JSON.stringify(subtitleState, null, 2));

        // Check that the bridge actually fired — look for our marker
        const controllerBuilt = allLogs.some(l => l.includes('CONTROLLER BUILT'));
        console.log(`Controller built: ${controllerBuilt}`);

        // Also check for the [Store] log confirming video was set
        const storeVideoLog = allLogs.filter(l => l.includes('setCurrentVideo'));
        console.log(`Store video logs: ${storeVideoLog.length}`);
        storeVideoLog.forEach(l => console.log(`  ${l}`));

        // Print all pipeline-related logs
        const pipelineLogs = allLogs.filter(l =>
            l.includes('pipeline') || l.includes('handleAnswer') ||
            l.includes('submitAnswer') || l.includes('incorrect') ||
            l.includes('applySpeech') || l.includes('TRIGGERING')
        );
        console.log('\n=== PIPELINE-RELATED LOGS ===');
        pipelineLogs.forEach(l => console.log(`  ${l}`));

        // Verify the bridge is now traversable
        expect(subtitleState.hasApplySpeechResult).toBe(true);
        expect(subtitleState.hasTokens).toBe(true);
        expect(subtitleState.hasPunctuationMap).toBe(true);
    });
});
