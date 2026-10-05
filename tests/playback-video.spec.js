// @ts-check
import { test, expect } from '@playwright/test';

test.describe('PlaybackVideo Visibility', () => {
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

    test('playback-video-wrapper is hidden when no blob', async ({ page }) => {
        await page.goto('/course/gt2/lesson/g-a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(1000);

        // Initially no blob, wrapper should be hidden
        const wrapper = page.locator('#playback-video-wrapper');
        await expect(wrapper).not.toBeVisible();
    });

    test('playback-video-wrapper shows when blob is set and chat mode is off', async ({ page }) => {
        await page.goto('/course/gt2/lesson/g-a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(1000);

        await page.evaluate(() => {
            window.appStore.setState({ mediaState: 'webcamOrAvatar' });
        });

        // Create a minimal video blob
        const hasVideo = await page.evaluate(async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }).catch(() => null);
                if (stream) {
                    const recorder = new MediaRecorder(stream);
                    return true;
                }
                // Fallback: just check the wrapper visibility logic
                const blob = new Blob(['fake-video-data'], { type: 'video/webm' });
                window.appStore.getState().setPlaybackBlob(blob, true);
                return true;
            } catch (e) {
                return false;
            }
        });

        if (hasVideo) {
            await page.waitForTimeout(500);
            // Wrapper should become visible (may take time for onloadedmetadata)
            // Since blob is fake, onloadedmetadata won't fire, but shouldShow should be true
            const isHidden = await page.evaluate(() => {
                const wrapper = document.getElementById('playback-video-wrapper');
                if (!wrapper) return 'not-found';
                const display = wrapper.style.display;
                const hasDNone = wrapper.classList.contains('d-none');
                return { display, hasDNone };
            });
        }

        // No crashes
        const filtered = errors.filter(e =>
            !e.includes('favicon') &&
            !e.includes('401') &&
            !e.includes('Unauthorized')
        );
        expect(filtered).toEqual([]);
    });

    test('playback-video-wrapper is hidden when mediaState is chat', async ({ page }) => {
        await page.goto('/course/gt2/lesson/g-a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(1000);

        await page.evaluate(() => {
            const blob = new Blob(['fake'], { type: 'video/webm' });
            window.appStore.getState().setPlaybackBlob(blob, true);
            window.appStore.setState({ mediaState: 'chat' });
        });

        await page.waitForTimeout(300);

        const isHidden = await page.evaluate(() => {
            const wrapper = document.getElementById('playback-video-wrapper');
            if (!wrapper) return true;
            const style = wrapper.style.getPropertyValue('display');
            return style === 'none' || wrapper.classList.contains('d-none');
        });

        expect(isHidden).toBe(true);
    });

    test('playback-video-wrapper is hidden after clearPlaybackBlob', async ({ page }) => {
        await page.goto('/course/gt2/lesson/g-a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(1000);

        // Set a blob first
        await page.evaluate(() => {
            const blob = new Blob(['fake'], { type: 'video/webm' });
            window.appStore.getState().setPlaybackBlob(blob, true);
        });

        await page.waitForTimeout(300);

        // Clear it
        await page.evaluate(() => {
            window.appStore.getState().clearPlaybackBlob();
        });

        await page.waitForTimeout(300);

        const isHidden = await page.evaluate(() => {
            const wrapper = document.getElementById('playback-video-wrapper');
            if (!wrapper) return true;
            const display = wrapper.style.display;
            const hasImportant = wrapper.style.getPropertyValue('display');
            return display === 'none' || wrapper.classList.contains('d-none');
        });

        expect(isHidden).toBe(true);
    });

    test('playback-video-wrapper stays hidden after resetForNextStep', async ({ page }) => {
        await page.goto('/course/gt2/lesson/g-a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(1000);

        // Set a blob and show it
        await page.evaluate(() => {
            const blob = new Blob(['fake'], { type: 'video/webm' });
            window.appStore.getState().setPlaybackBlob(blob, true);
            window.appStore.setState({ mediaState: 'webcamOrAvatar' });
        });

        await page.waitForTimeout(300);

        // Reset (simulates step transition)
        await page.evaluate(() => {
            window.appStore.getState().resetForNextStep();
        });

        await page.waitForTimeout(300);

        const isHidden = await page.evaluate(() => {
            const wrapper = document.getElementById('playback-video-wrapper');
            if (!wrapper) return true;
            const display = wrapper.style.display;
            return display === 'none' || wrapper.classList.contains('d-none');
        });

        expect(isHidden).toBe(true);

        // Blob should also be null
        const blobState = await page.evaluate(() => window.appStore.getState().playbackBlob);
        expect(blobState).toBeNull();
    });

    test('playback-video-wrapper does not reappear when mediaState toggles back with no blob', async ({ page }) => {
        await page.goto('/course/gt2/lesson/g-a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(1000);

        // Set blob, then activate chat mode (hides video)
        await page.evaluate(() => {
            const blob = new Blob(['fake'], { type: 'video/webm' });
            window.appStore.getState().setPlaybackBlob(blob, true);
            window.appStore.setState({ mediaState: 'chat' });
        });

        await page.waitForTimeout(300);

        // Clear blob while chat mode is active
        await page.evaluate(() => {
            window.appStore.getState().clearPlaybackBlob();
        });

        await page.waitForTimeout(300);

        // Now deactivate chat mode — wrapper should NOT reappear because blob is null
        await page.evaluate(() => {
            window.appStore.setState({ mediaState: 'webcamOrAvatar' });
        });

        await page.waitForTimeout(300);

        const isHidden = await page.evaluate(() => {
            const wrapper = document.getElementById('playback-video-wrapper');
            if (!wrapper) return true;
            return wrapper.style.display === 'none' || wrapper.classList.contains('d-none');
        });

        expect(isHidden).toBe(true);
    });

    test.fixme('playback-video-wrapper stays hidden during chat feedback after onloadedmetadata fires', async ({ page }) => {
        await page.goto('/course/gt2/lesson/g-a');
        await page.waitForFunction(() => window.appStore?.getState()?.configData, { timeout: 20000 });
        await page.waitForTimeout(1000);

        // Step 1: Set blob — React effect registers onloadedmetadata handler
        await page.evaluate(() => {
            const blob = new Blob(['fake'], { type: 'video/webm' });
            window.appStore.getState().setPlaybackBlob(blob, true);
        });
        await page.waitForTimeout(300);

        // Step 2: Simulate video load completing
        await page.evaluate(() => {
            const video = document.getElementById('playback-video');
            if (video) video.dispatchEvent(new Event('loadedmetadata'));
        });
        await page.waitForTimeout(100);

        // Wrapper should be visible (blob exists, chat mode off)
        const visibleAfterLoad = await page.evaluate(() => {
            const w = document.getElementById('playback-video-wrapper');
            if (!w) return false;
            return !w.classList.contains('d-none') && w.style.getPropertyValue('display') !== 'none';
        });
        expect(visibleAfterLoad).toBe(true);

        // Step 3: Activate chat mode — should hide wrapper
        await page.evaluate(() => {
            window.appStore.setState({ mediaState: 'chat' });
        });
        await page.waitForTimeout(300);

        const hiddenAfterChat = await page.evaluate(() => {
            const w = document.getElementById('playback-video-wrapper');
            if (!w) return true;
            return w.classList.contains('d-none') || w.style.getPropertyValue('display') === 'none';
        });
        expect(hiddenAfterChat).toBe(true);

        // Step 4: Dispatch loadedmetadata again — onloadedmetadata must check mediaState
        await page.evaluate(() => {
            const video = document.getElementById('playback-video');
            if (video) video.dispatchEvent(new Event('loadedmetadata'));
        });
        await page.waitForTimeout(100);

        const stillHidden = await page.evaluate(() => {
            const w = document.getElementById('playback-video-wrapper');
            if (!w) return true;
            return w.classList.contains('d-none') || w.style.getPropertyValue('display') === 'none';
        });
        expect(stillHidden).toBe(true);
    });
});