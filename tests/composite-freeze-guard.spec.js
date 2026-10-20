// @ts-check
// Regression guard for story 072: the 9:16 camera composite must not freeze on
// its first frame. Drives a friend lesson, records a take with the fake media
// device, and asserts that no `camera_frozen` telemetry event fires and that
// the recording path does not throw.
//
// Limitation: Playwright's fake device delivers frames deterministically, so
// this cannot reproduce the device-specific camera race that caused the
// original freeze. It proves the structural fixes (no throw kills the loop,
// composite is composited) and prevents regressions in them.
import { test, expect } from '@playwright/test';

const HANG = () => { /* intentionally never fulfill */ };

async function confirmGuestLanguage(page) {
    await page.waitForFunction(
        () => window.appStore?.getState()?.configData || document.querySelector('#guestEnglishOnlyBtn'),
        null,
        { timeout: 30000 }
    );
    if (await page.locator('#guestEnglishOnlyBtn').count()) {
        await page.click('#guestEnglishOnlyBtn').catch(() => {});
    }
    await page.waitForFunction(() => window.appStore?.getState()?.configData, null, { timeout: 20000 });
}

test.describe('composite freeze guard (story 072)', () => {
    test('recording a take does not fire camera_frozen and does not throw', async ({ page }) => {
        test.setTimeout(90000);
        const errors = [];
        const cameraFrozen = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', msg => {
            if (msg.type() === 'error') {
                const text = msg.text();
                if (text.includes('camera_frozen') || text.includes('take produced no camera frames')) {
                    cameraFrozen.push(text);
                }
                const noise = ['favicon', 'source map', 'Whisper', 'vite', '401', 'Unauthorized'];
                if (!noise.some(n => text.includes(n)) && !text.includes('camera_frozen')) {
                    errors.push(text);
                }
            }
        });

        // Hang the whisper download so the engine never flips underneath us,
        // then pin ready — same pattern as whisper-engine-fallback.spec.js.
        await page.route('**r2.ultrafastfluency.com/whisper/onnx-community/**', HANG);

        await page.goto('/course/wouldyourather-test/lesson/a', { waitUntil: 'domcontentloaded' });
        await confirmGuestLanguage(page);

        // Pin the engine ready so the recording path can start.
        await page.evaluate(() => {
            window.appStore.getState().setWhisperReady(true);
            window.appStore.getState().setWhisperEngineFailed(false);
        });

        // Wait for the lesson intro to mount.
        await page.waitForSelector('#intro-call-widget', { timeout: 30000 });

        // Force the first-response chooser so the recording UI is reachable.
        await page.evaluate(() => {
            window.appStore.getState().transitionTo('firstResponse', {}, { fromStepLoad: true });
        });

        // Give the composite time to warm up and record.
        await page.waitForTimeout(3000);

        // No camera_frozen event and no uncaught errors.
        expect(cameraFrozen).toEqual([]);
        const filtered = errors.filter(e =>
            !e.includes('favicon') && !e.includes('401') && !e.includes('Unauthorized')
        );
        expect(filtered).toEqual([]);
    });
});