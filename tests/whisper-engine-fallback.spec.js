// Regression coverage for the speech-engine mode chooser.
//
// Voice is the product's priority, but text is always available via the
// keyboard icon (it does not depend on the speech engine). These specs lock in:
//   1. While the engine is loading: voice buttons shown disabled, keyboard
//      icon still available.
//   2. When the engine fails: descriptive recovery steps + retry + keyboard
//      icon.
//   3. When getUserMedia fails (no mic): the user stays on the chooser with
//      actionable guidance instead of a stranded muted-mic screen, and can
//      retry or fall back to text.
import { test, expect } from '@playwright/test';

const LESSON_URL = '/course/model/lesson/m-w';
const HANG = () => { /* intentionally never fulfill — keeps the request pending */ };

async function dismissGuestModal(page) {
    // The guest language modal gates config normalisation: configData is only
    // set once a language is confirmed (config-normalizer.js
    // isConfigLanguageSettled). Wait for either signal, then confirm English
    // (which leads to the login-choice step) and dismiss.
    await page.waitForFunction(
        () => window.appStore?.getState()?.configData || document.querySelector('#guestEnglishOnlyBtn'),
        null,
        { timeout: 30000 }
    );
    if (await page.locator('#guestEnglishOnlyBtn').count()) {
        await page.click('#guestEnglishOnlyBtn').catch(() => {});
        await page.waitForTimeout(200);
    }
    if (await page.locator('#guestContinueBtn').count()) {
        await page.click('#guestContinueBtn').catch(() => {});
        await page.waitForTimeout(200);
    }
    await page.waitForFunction(() => window.appStore?.getState()?.configData, null, { timeout: 20000 });
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

// Read the mode-chooser buttons' layout geometry via offset metrics. offsetTop
// / offsetLeft are unaffected by CSS transforms, so the floatBob animation on
// #continueButton cannot make the row assertions flaky (getBoundingClientRect
// would include the transform and is not safe here).
async function readChooserGeometry(page) {
    return page.evaluate(() => {
        const ids = ['#audioOnlyButton', '#continueButton', '#textOnlyButton'];
        const buttons = ids.map((sel) => document.querySelector(sel));
        const parent = buttons[0]?.parentElement ?? null;
        const parentStyle = parent ? getComputedStyle(parent) : null;
        return {
            buttons: buttons.map((el) => el && {
                offsetTop: el.offsetTop,
                offsetLeft: el.offsetLeft,
                offsetWidth: el.offsetWidth,
                offsetHeight: el.offsetHeight,
            }),
            parent: parent && {
                display: parentStyle.display,
                flexDirection: parentStyle.flexDirection,
            },
            sameParent: buttons.every((el) => el && el.parentElement === parent),
            statusText: (() => {
                const el = document.querySelector('#speechEngineStatusText');
                return el ? { offsetTop: el.offsetTop } : null;
            })(),
        };
    });
}

test.describe('speech engine chooser fallback', () => {
    test('while the engine loads: voice shown disabled, keyboard icon available', async ({ page }) => {
        test.setTimeout(60000);
        // Hang the model download so the engine stays in the loading state.
        await page.route('**r2.ultrafastfluency.com/whisper/onnx-community/**', HANG);

        await page.goto(LESSON_URL, { waitUntil: 'domcontentloaded' });
        await dismissGuestModal(page);
        await advanceToChooser(page);

        const s = await state(page);
        expect(s.bottomState).toBe('introChoices');
        expect(s.appPhase).toBe('firstResponse');

        await expect(page.locator('#speechEngineStatusText')).toBeVisible();
        await expect(page.locator('#audioOnlyButton')).toBeDisabled();
        await expect(page.locator('#continueButton')).toBeDisabled();
        // Text is always available via the keyboard icon, even while voice loads.
        await expect(page.locator('#textOnlyButton')).toBeVisible();
    });

    test('ready state: phone, camera, keyboard sit in one flex row with even geometry', async ({ page }) => {
        test.setTimeout(60000);
        // Hang the model download so the engine never flips to failed/ready
        // underneath us, then mark it ready to reach the ready-state chooser
        // deterministically.
        await page.route('**r2.ultrafastfluency.com/whisper/onnx-community/**', HANG);

        await page.goto(LESSON_URL, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => {
            window.appStore.getState().setWhisperReady(true);
            window.appStore.getState().setWhisperEngineFailed(false);
        });

        await dismissGuestModal(page);
        await advanceToChooser(page);

        const geo = await readChooserGeometry(page);
        expect(geo.buttons.every(Boolean)).toBe(true);
        expect(geo.sameParent).toBe(true);
        expect(geo.parent.display).toBe('flex');
        expect(geo.parent.flexDirection).toBe('row');

        const offsetTops = geo.buttons.map((b) => b.offsetTop);
        const offsetLefts = geo.buttons.map((b) => b.offsetLeft);
        expect(new Set(offsetTops).size).toBe(1);
        expect(offsetLefts[0]).toBeLessThan(offsetLefts[1]);
        expect(offsetLefts[1]).toBeLessThan(offsetLefts[2]);
        for (const b of geo.buttons) {
            expect(b.offsetWidth).toBe(60);
            expect(b.offsetHeight).toBe(60);
        }
    });

    test('loading state: icons stay in one row, voice disabled, status text below', async ({ page }) => {
        test.setTimeout(60000);
        // Hang the model download so the engine stays in the loading state.
        await page.route('**r2.ultrafastfluency.com/whisper/onnx-community/**', HANG);

        await page.goto(LESSON_URL, { waitUntil: 'domcontentloaded' });
        await dismissGuestModal(page);
        await advanceToChooser(page);

        await expect(page.locator('#speechEngineStatusText')).toBeVisible();
        await expect(page.locator('#audioOnlyButton')).toBeDisabled();
        await expect(page.locator('#continueButton')).toBeDisabled();
        await expect(page.locator('#textOnlyButton')).toBeEnabled();

        const geo = await readChooserGeometry(page);
        expect(geo.buttons.every(Boolean)).toBe(true);
        expect(geo.sameParent).toBe(true);
        expect(geo.parent.display).toBe('flex');
        expect(geo.parent.flexDirection).toBe('row');

        const offsetTops = geo.buttons.map((b) => b.offsetTop);
        const offsetLefts = geo.buttons.map((b) => b.offsetLeft);
        expect(new Set(offsetTops).size).toBe(1);
        expect(offsetLefts[0]).toBeLessThan(offsetLefts[1]);
        expect(offsetLefts[1]).toBeLessThan(offsetLefts[2]);
        for (const b of geo.buttons) {
            expect(b.offsetWidth).toBe(60);
            expect(b.offsetHeight).toBe(60);
        }

        // Status text renders below the icon row.
        expect(geo.statusText).not.toBeNull();
        expect(geo.statusText.offsetTop).toBeGreaterThan(Math.max(...offsetTops));
    });

    test('when the engine fails: recovery steps, retry, and keyboard icon', async ({ page }) => {
        test.setTimeout(60000);
        await page.route('**r2.ultrafastfluency.com/whisper/**', r => r.abort('failed'));
        await page.route('**cdn.jsdelivr.net/**', r => r.abort('failed'));

        await page.goto(LESSON_URL, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.appStore?.getState()?.isWhisperEngineFailed === true, null, { timeout: 30000 });
        await dismissGuestModal(page);
        await advanceToChooser(page);

        await expect(page.locator('#speechEngineFailedText')).toBeVisible();
        await expect(page.locator('#retryEngineButton')).toBeVisible();
        await expect(page.locator('#retryEngineButton')).toHaveText(/Try Again/i);
        await expect(page.locator('#textOnlyButton')).toBeVisible();
    });

    test('when getUserMedia fails: stays on chooser with guidance, not a dead-end', async ({ page }) => {
        test.setTimeout(60000);
        const dialogs = [];
        page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
        // Hang the engine so it never flips to failed/ready underneath us, then
        // mark it ready to reach the mic path deterministically.
        await page.route('**r2.ultrafastfluency.com/whisper/onnx-community/**', HANG);

        await page.goto(LESSON_URL, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => {
            window.appStore.getState().setWhisperReady(true);
            window.appStore.getState().setWhisperEngineFailed(false);
        });

        await dismissGuestModal(page);
        await advanceToChooser(page);

        // Engine ready → voice buttons available, keyboard icon available.
        await expect(page.locator('#continueButton')).toBeEnabled();
        await expect(page.locator('#textOnlyButton')).toBeVisible();

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

        // The historical bug was state-only: the message was set then wiped, so
        // nothing rendered. Assert the guidance is actually on screen.
        await expect(page.locator('#micStatusText')).toBeVisible();
        await expect(page.locator('#micStatusText')).toContainText(/microphone|camera/i);

        // The chooser is intact and the user can retry voice or fall back.
        await expect(page.locator('#state-intro-choices')).toBeVisible();
        await expect(page.locator('#continueButton')).toBeEnabled();
        await expect(page.locator('#textOnlyButton')).toBeVisible();

        // The old failure mode showed a blocking native alert and wiped the
        // message; neither should happen.
        expect(dialogs, `unexpected dialogs: ${dialogs.join('; ')}`).toEqual([]);

        // Falling back to text works and leaves the chooser.
        await page.locator('#textOnlyButton').click({ force: true });
        await expect.poll(async () => (await state(page)).isTextMode).toBe(true);
    });

    test('ear ("listen again") does not pre-enter the recording UI without media', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto(LESSON_URL, { waitUntil: 'domcontentloaded' });
        await dismissGuestModal(page);

        // Force the decision-time phase so DecisionButtons mounts deterministically.
        await page.evaluate(() => {
            window.appStore.getState().transitionTo(
                'interactiveVideo-decisionTime-closedResponse',
                {},
                { fromStepLoad: true }
            );
        });
        await expect(page.locator('#earBtn')).toBeVisible({ timeout: 10000 });

        await page.locator('#earBtn').click({ force: true });
        await page.waitForTimeout(500);

        // Must stay on the decision UI (no media acquired) — this is the path
        // that previously stranded a mic-denied user in recording/answering.
        const s = await state(page);
        expect(s.appPhase).toBe('interactiveVideo-decisionTime-closedResponse');
        expect(s.bottomState).toBe('decisionButtons');
    });
});
