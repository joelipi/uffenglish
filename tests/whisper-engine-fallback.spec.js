// Regression coverage for the speech-engine mode chooser.
//
// Voice is the product's priority, so text mode must never be the path of
// least resistance. These specs lock in:
//   1. While the engine is loading: voice buttons shown disabled, NO text
//      fallback offered.
//   2. When the engine fails: descriptive recovery steps + retry + a small,
//      de-emphasized text fallback.
//   3. When getUserMedia fails (no mic): the user stays on the chooser with
//      actionable guidance instead of a stranded muted-mic screen, and can
//      retry or fall back to text.
import { test, expect } from '@playwright/test';

const LESSON_URL = '/course/model/lesson/w';
const HANG = () => { /* intentionally never fulfill — keeps the request pending */ };

async function dismissGuestModal(page) {
    if (await page.locator('#guestEnglishOnlyBtn').count()) {
        await page.click('#guestEnglishOnlyBtn').catch(() => {});
        await page.waitForTimeout(200);
    }
    if (await page.locator('#guestContinueBtn').count()) {
        await page.click('#guestContinueBtn').catch(() => {});
        await page.waitForTimeout(200);
    }
}

async function advanceToChooser(page) {
    await page.waitForSelector('#intro-call-widget', { timeout: 20000 });
    await page.click('#intro-call-widget', { force: true }).catch(() => {});
    await page.waitForFunction(
        () => window.appStore?.getState()?.bottomState === 'introChoices',
        null,
        { timeout: 20000 }
    );
    await page.waitForTimeout(800);
}

const state = (page) => page.evaluate(() => {
    const s = window.appStore.getState();
    return {
        appPhase: s.appPhase,
        bottomState: s.bottomState,
        isTextMode: s.isTextMode,
        systemMessage: s.systemMessage,
    };
});

test.describe('speech engine chooser fallback', () => {
    test('while the engine loads: voice shown disabled, no text fallback', async ({ page }) => {
        test.setTimeout(60000);
        // Hang the model download so the engine stays in the loading state.
        await page.route('**r2.ultrafastfluency.com/whisper/onnx-community/**', HANG);

        await page.goto(LESSON_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.appStore?.getState()?.configData, null, { timeout: 20000 });
        await dismissGuestModal(page);
        await advanceToChooser(page);

        const s = await state(page);
        expect(s.bottomState).toBe('introChoices');
        expect(s.appPhase).toBe('firstResponse');

        await expect(page.locator('#speechEngineStatusText')).toBeVisible();
        await expect(page.locator('#audioOnlyButton')).toBeDisabled();
        await expect(page.locator('#continueButton')).toBeDisabled();
        // The text trap: it must not be offered while voice is still coming up.
        await expect(page.locator('#textFallbackLink')).toHaveCount(0);
    });

    test('when the engine fails: recovery steps, retry, and only a small text fallback', async ({ page }) => {
        test.setTimeout(60000);
        await page.route('**r2.ultrafastfluency.com/whisper/**', r => r.abort('failed'));
        await page.route('**cdn.jsdelivr.net/**', r => r.abort('failed'));

        await page.goto(LESSON_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.appStore?.getState()?.configData, null, { timeout: 20000 });
        await page.waitForFunction(() => window.appStore?.getState()?.isWhisperEngineFailed === true, null, { timeout: 30000 });
        await dismissGuestModal(page);
        await advanceToChooser(page);

        await expect(page.locator('#speechEngineFailedText')).toBeVisible();
        await expect(page.locator('#retryEngineButton')).toBeVisible();
        await expect(page.locator('#retryEngineButton')).toHaveText(/Try Again/i);
        await expect(page.locator('#textFallbackLink')).toBeVisible();
    });

    test('when getUserMedia fails: stays on chooser with guidance, not a dead-end', async ({ page }) => {
        test.setTimeout(60000);
        const dialogs = [];
        page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
        // Hang the engine so it never flips to failed/ready underneath us, then
        // mark it ready to reach the mic path deterministically.
        await page.route('**r2.ultrafastfluency.com/whisper/onnx-community/**', HANG);

        await page.goto(LESSON_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.appStore?.getState()?.configData, null, { timeout: 20000 });
        await page.evaluate(() => {
            window.appStore.getState().setWhisperReady(true);
            window.appStore.getState().setWhisperEngineFailed(false);
        });

        await dismissGuestModal(page);
        await advanceToChooser(page);

        // Engine ready → voice buttons available, text fallback de-emphasized.
        await expect(page.locator('#continueButton')).toBeEnabled();
        await expect(page.locator('#textFallbackLink')).toBeVisible();

        // No media devices exist in this environment → getUserMedia rejects.
        await page.locator('#continueButton').click({ force: true });
        await page.waitForFunction(
            () => window.appStore?.getState()?.systemMessage?.type === 'media-error',
            null,
            { timeout: 15000 }
        );

        const s = await state(page);
        expect(s.appPhase).toBe('firstResponse');
        expect(s.bottomState).toBe('introChoices');
        expect(s.systemMessage.text).toMatch(/microphone|camera/i);

        // The chooser is intact and the user can retry voice or fall back.
        await expect(page.locator('#state-intro-choices')).toBeVisible();
        await expect(page.locator('#continueButton')).toBeEnabled();
        await expect(page.locator('#textFallbackLink')).toBeVisible();

        // The old failure mode showed a blocking native alert and wiped the
        // message; neither should happen.
        expect(dialogs, `unexpected dialogs: ${dialogs.join('; ')}`).toEqual([]);

        // Falling back to text works and leaves the chooser.
        await page.locator('#textFallbackLink').click({ force: true });
        await expect.poll(async () => (await state(page)).isTextMode).toBe(true);
    });
});
