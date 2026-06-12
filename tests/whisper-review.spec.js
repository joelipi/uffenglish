// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Whisper Review Regression Guard', () => {
    let errors = [];

    test.beforeEach(async ({ page }) => {
        errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', msg => {
            if (msg.type() === 'error') {
                const text = msg.text();
                const noise = ['favicon', 'source map', 'Whisper', 'vite', '401', 'Unauthorized', 'ERR_FILE_NOT_FOUND', 'ERR_CACHE_WRITE_FAILURE'];
                if (!noise.some(n => text.includes(n))) {
                    errors.push(text);
                }
            }
        });
    });

    test('whisper review timeout auto-accept: playback video stays hidden on next step', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(2000);

        // Set a playback blob (simulating user recording)
        const state = await page.evaluate(() => {
            const blob = new Blob(['fake-recording'], { type: 'video/webm' });
            window.appStore.getState().setPlaybackBlob(blob, true);
            return { playbackBlob: true };
        });

        // Wait for the video element to process
        await page.waitForTimeout(500);

        // Simulate whisper review appearing (store-driven, no mic needed)
        await page.evaluate(() => {
            window.appStore.getState().setAppPhase('review', {
                transcript: 'test transcript',
                timeLeft: 7,
                onAccept: () => {
                    console.log('[test] whisper auto-accept triggered');
                    window.appStore.getState().setWhisperReviewData(null);
                    window.appStore.getState().setWhisperReviewTimeLeft(null);
                },
                onReject: () => {}
            });
        });

        // Verify whisper review phase is active
        const reviewPhase = await page.evaluate(() => {
            const state = window.appStore.getState();
            return state.appPhase === 'review' && state.phaseData?.transcript === 'test transcript';
        });
        expect(reviewPhase).toBe(true);

        // Simulate whisper timeout: clear the review and proceed to next step
        await page.evaluate(() => {
            const state = window.appStore.getState();
            // Clear whisper review (simulates timeout accept)
            state.setWhisperReviewData(null);
            state.setWhisperReviewTimeLeft(null);
            state.setAppPhase('feedback');

            // Now simulate step transition (resetForNextStep)
            state.resetForNextStep();
        });

        await page.waitForTimeout(500);

        // Verify playback video is hidden after step transition
        const playbackHidden = await page.evaluate(() => {
            const wrapper = document.getElementById('playback-video-wrapper');
            if (!wrapper) return true;
            const display = wrapper.style.display;
            const classList = wrapper.classList.contains('d-none');
            return display === 'none' || classList;
        });
        expect(playbackHidden).toBe(true);

        // Verify playbackBlob is null
        const blobState = await page.evaluate(() => window.appStore.getState().playbackBlob);
        expect(blobState).toBeNull();

        // No page errors
        const filtered = errors.filter(e =>
            !e.includes('favicon') &&
            !e.includes('401') &&
            !e.includes('Unauthorized') &&
            !e.includes('ERR_FILE_NOT_FOUND') &&
            !e.includes('ERR_CACHE_WRITE_FAILURE')
        );
        expect(filtered).toEqual([]);
    });

    test('whisper review reject: playback video cleared', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(2000);

        // Set playback blob
        await page.evaluate(() => {
            const blob = new Blob(['fake'], { type: 'video/webm' });
            window.appStore.getState().setPlaybackBlob(blob, true);
        });

        await page.waitForTimeout(300);

        // Show whisper review via setAppPhase
        await page.evaluate(() => {
            window.appStore.getState().setAppPhase('review', {
                transcript: 'wrong answer',
                timeLeft: 7,
                onAccept: () => {},
                onReject: () => {
                    window.appStore.getState().triggerPreflightRejected(
                        window.appStore.getState().currentStep?.cue || 'test',
                        'wrong transcript'
                    );
                }
            });
        });

        // Clear review (reject path) - setAppPhase back to recording
        await page.evaluate(() => {
            window.appStore.getState().setAppPhase('recording/answering');
        });

        await page.waitForTimeout(300);

        // Simulate preflight rejection which triggers video clear
        await page.evaluate(() => {
            window.appStore.getState().triggerVideoClear();
        });

        await page.waitForTimeout(300);

        // Verify video is hidden
        const isHidden = await page.evaluate(() => {
            const wrapper = document.getElementById('playback-video-wrapper');
            if (!wrapper) return true;
            return wrapper.style.display === 'none' || wrapper.classList.contains('d-none');
        });
        expect(isHidden).toBe(true);
    });

    test('success screen appears after handleSuccessStep and sets subtitles', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(2000);

        const result = await page.evaluate(async () => {
            const { handleSuccessStep } = await import('/js/modules/lesson/step-loader-logic.js');
            const state = window.appStore.getState();
            const lessonId = state.configData.lessons[state.currentLessonIndex]?.lessonId || 'test';

            const step = {
                lessonId: lessonId,
                stepType: 'success',
                subtitles: { en: "That's great!", es: '¡Eso es genial!', pt: 'Ótimo!' },
                simpleVideoUrl: 'success'
            };

            handleSuccessStep(step, { total: 85 });

            const newState = window.appStore.getState();
            return {
                successScreenVisible: newState.successScreenVisible,
                speechCue: newState.speechCue,
                hintsVisible: newState.hintsVisible,
                appPhase: newState.appPhase
            };
        });

        expect(result.successScreenVisible).toBe(true);
        // Subtitles should be set from step.subtitles
        expect(result.speechCue).toBeTruthy();
        expect(result.hintsVisible).toBe(true);
        expect(result.appPhase).toBe('lessonSuccess');
    });

    test('mediaState toggle hides and correctly restores playback video', async ({ page }) => {
        await page.goto('/course/gt2/lesson/a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(1000);

        // Set playback blob with chat mode off
        await page.evaluate(() => {
            window.appStore.setState({ mediaState: 'webcamOrAvatar' });
            const blob = new Blob(['fake'], { type: 'video/webm' });
            window.appStore.getState().setPlaybackBlob(blob, true);
        });

        await page.waitForTimeout(300);

        // Activate chat mode — should hide video
        await page.evaluate(() => {
            window.appStore.setState({ mediaState: 'chat' });
        });

        await page.waitForTimeout(300);

        let isHidden = await page.evaluate(() => {
            const wrapper = document.getElementById('playback-video-wrapper');
            if (!wrapper) return true;
            return wrapper.style.getPropertyValue('display') === 'none';
        });
        expect(isHidden).toBe(true);

        // Deactivate chat mode WITH blob — should show video
        await page.evaluate(() => {
            window.appStore.setState({ mediaState: 'webcamOrAvatar' });
        });

        await page.waitForTimeout(300);

        // Video should be visible again since blob exists
        let isVisible = await page.evaluate(() => {
            const wrapper = document.getElementById('playback-video-wrapper');
            if (!wrapper) return false;
            const hasDNone = wrapper.classList.contains('d-none');
            const display = wrapper.style.getPropertyValue('display');
            return !hasDNone && display !== 'none';
        });
        expect(isVisible).toBe(true);

        // Now clear blob while chat mode is off
        await page.evaluate(() => {
            window.appStore.getState().clearPlaybackBlob();
        });

        await page.waitForTimeout(300);

        // Toggle chat mode on then off — video should NOT reappear (blob is null)
        await page.evaluate(() => {
            window.appStore.setState({ mediaState: 'chat' });
        });
        await page.waitForTimeout(200);
        await page.evaluate(() => {
            window.appStore.setState({ mediaState: 'webcamOrAvatar' });
        });
        await page.waitForTimeout(300);

        isHidden = await page.evaluate(() => {
            const wrapper = document.getElementById('playback-video-wrapper');
            if (!wrapper) return true;
            return wrapper.style.display === 'none' || wrapper.classList.contains('d-none');
        });
        expect(isHidden).toBe(true);
    });
});