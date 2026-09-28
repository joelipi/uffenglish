// Friend-challenge lessons exist to produce a shared video, so their mode
// chooser (`IntroChoices`) must offer only Video Call — no Audio Only and no
// Text Only. Non-friend lessons keep all three options.
//
// A friend lesson is detected from the route alone (`isFriendLesson`):
// `?shareCode=` present, or the lesson id is 'a'/'b' in any course.
//
// The chooser is forced deterministically with transitionTo('firstResponse')
// and the engine state is pinned the same way as tests/whisper-engine-fallback
// so it cannot flip underneath the assertions.
import { test, expect } from '@playwright/test';

const HANG = () => { /* intentionally never fulfill — keeps the request pending */ };

// The guest language modal gates config normalisation: an anonymous visitor
// must confirm a language before `configData` is set. Confirm English when the
// step is offered (a non-English browser on a friend lesson adopts silently and
// never shows this button).
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

// Force the first-response mode chooser once the lesson intro is mounted, so a
// later step-load cannot overwrite the forced phase.
async function forceChooser(page) {
    await page.waitForSelector('#intro-call-widget', { timeout: 30000 });
    await page.evaluate(() => {
        window.appStore.getState().transitionTo('firstResponse', {}, { fromStepLoad: true });
    });
    await page.waitForFunction(
        () => window.appStore?.getState()?.bottomState === 'introChoices',
        null,
        { timeout: 20000 }
    );
    await page.waitForTimeout(500);
}

async function bootstrap(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await confirmGuestLanguage(page);
}

test.describe('friend lessons: video-recording mode only', () => {
    test('friend lesson, engine ready: only the video button is shown', async ({ page }) => {
        test.setTimeout(60000);
        // Hang the download so the engine never flips underneath us, then pin ready.
        await page.route('**r2.ultrafastfluency.com/whisper/onnx-community/**', HANG);

        await bootstrap(page, '/course/friend/lesson/b');
        await page.evaluate(() => {
            window.appStore.getState().setWhisperReady(true);
            window.appStore.getState().setWhisperEngineFailed(false);
        });
        await forceChooser(page);

        await expect(page.locator('#continueButton')).toBeVisible();
        await expect(page.locator('#continueButton')).toBeEnabled();
        await expect(page.locator('#audioOnlyButton')).toHaveCount(0);
        await expect(page.locator('#textOnlyButton')).toHaveCount(0);
        await expect(page.locator('#state-intro-choices button')).toHaveCount(1);
    });

    test('friend lesson, engine loading: only a disabled video button is shown', async ({ page }) => {
        test.setTimeout(60000);
        await page.route('**r2.ultrafastfluency.com/whisper/onnx-community/**', HANG);

        await bootstrap(page, '/course/friend/lesson/b');
        await forceChooser(page);

        await expect(page.locator('#continueButton')).toBeVisible();
        await expect(page.locator('#continueButton')).toBeDisabled();
        await expect(page.locator('#audioOnlyButton')).toHaveCount(0);
        await expect(page.locator('#textOnlyButton')).toHaveCount(0);
        await expect(page.locator('#speechEngineStatusText')).toBeVisible();
    });

    test('friend lesson, engine failed: retry only, no audio or text fallback', async ({ page }) => {
        test.setTimeout(60000);
        await page.route('**r2.ultrafastfluency.com/whisper/**', r => r.abort('failed'));
        await page.route('**cdn.jsdelivr.net/**', r => r.abort('failed'));

        await bootstrap(page, '/course/friend/lesson/b');
        await page.waitForFunction(
            () => window.appStore?.getState()?.isWhisperEngineFailed === true,
            null,
            { timeout: 30000 }
        );
        await forceChooser(page);

        await expect(page.locator('#retryEngineButton')).toBeVisible();
        await expect(page.locator('#textOnlyButton')).toHaveCount(0);
        await expect(page.locator('#audioOnlyButton')).toHaveCount(0);
    });

    test('friend lesson opened via ?shareCode= on a non-friend id is video only', async ({ page }) => {
        test.setTimeout(60000);
        await page.route('**r2.ultrafastfluency.com/whisper/onnx-community/**', HANG);

        await bootstrap(page, '/course/model/lesson/g?shareCode=friendtest1');
        await page.evaluate(() => {
            window.appStore.getState().setWhisperReady(true);
            window.appStore.getState().setWhisperEngineFailed(false);
        });
        await forceChooser(page);

        await expect(page.locator('#continueButton')).toBeVisible();
        await expect(page.locator('#audioOnlyButton')).toHaveCount(0);
        await expect(page.locator('#textOnlyButton')).toHaveCount(0);
    });

    test('non-friend lesson, engine ready: all three mode buttons remain', async ({ page }) => {
        test.setTimeout(60000);
        await page.route('**r2.ultrafastfluency.com/whisper/onnx-community/**', HANG);

        await bootstrap(page, '/course/model/lesson/w');
        await page.evaluate(() => {
            window.appStore.getState().setWhisperReady(true);
            window.appStore.getState().setWhisperEngineFailed(false);
        });
        await forceChooser(page);

        await expect(page.locator('#audioOnlyButton')).toBeVisible();
        await expect(page.locator('#continueButton')).toBeVisible();
        await expect(page.locator('#textOnlyButton')).toBeVisible();
    });
});
