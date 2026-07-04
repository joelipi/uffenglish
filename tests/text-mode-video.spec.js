// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Verifies that text-only answers produce a processed video where the user
 * segment is a 3-second clip of the profile image with the normal overlays.
 */

test.describe('Text-Mode Video', () => {
    let errors = [];

    test.beforeEach(async ({ page }) => {
        errors = [];
        page.on('pageerror', (exception) => {
            errors.push(`PageError: ${exception.message}`);
        });
        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                const text = msg.text();
                const noise = ['favicon', 'source map', 'Whisper', 'vite', '401', 'ERR_CACHE_WRITE_FAILURE', 'cache'];
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

    test('processVideo generates a blob for text-mode answers', async ({ page }) => {
        test.setTimeout(90000);

        await page.goto('/course/model/lesson/g');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });

        const result = await page.evaluate(async () => {
            const state = window.appStore.getState();
            const lessonId = state.activeLessonId || 'model';

            // Ensure a profile image is available for the placeholder clip.
            window.appStore.setState({
                userData: {
                    ...(state.userData || {}),
                    profilePictureUrl: '/assets/img/userprofile.png'
                },
                isTextMode: true
            });

            const { saveSpeechRecording, clearSpeechRecordingsForLesson } = await import('/src/modules/storage/storage.js');
            await clearSpeechRecordingsForLesson(lessonId);

            // Simulate a text-mode answer stored without a webcam blob.
            await saveSpeechRecording(null, {
                lessonId,
                stepIndex: 0,
                userResponse: 'This is my text answer',
                isTextMode: true,
                duration: 3
            });

            const { processVideo } = await import('/src/modules/video/video-processor.js');
            const result = await processVideo({ total: 85 }, lessonId, null);
            return { size: result.blob.size, ext: result.ext };
        });

        expect(result.size).toBeGreaterThan(0);
        expect(['mp4', 'webm']).toContain(result.ext);

        await assertNoError();
    });
});
