// @ts-check
import { test, expect } from '@playwright/test';

// Friend lessons must be low-friction: a friend who opens a share link should
// not be interrupted by the guest login/language modal. These specs exercise
// the real guard + store + modal with a real browser locale.

const FRIEND_URL = '/course/friend/lesson/b?shareCode=friendtest1';
const NON_FRIEND_URL = '/course/model/lesson/g';

async function waitForGuardRun(page) {
    await page.waitForFunction(
        () => window.appStore?.getState()?.guestModalShownThisSession === true,
        null,
        { timeout: 30000 }
    );
}

test.describe('friend lesson + Spanish browser', () => {
    test.use({ locale: 'es-ES' });

    test('opens with no modal and adopts the browser language silently', async ({ page }) => {
        await page.goto(FRIEND_URL);
        await waitForGuardRun(page);

        // The bootstrap writes the guest profile (native_language EN) after the
        // guard runs; the re-apply effect must win.
        await page.waitForFunction(
            () => window.appStore.getState().userData?.native_language === 'ES',
            null,
            { timeout: 15000 }
        );

        const state = await page.evaluate(() => ({
            isGuestModalOpen: window.appStore.getState().isGuestModalOpen,
            guestNativeLanguage: window.appStore.getState().guestNativeLanguage,
        }));
        expect(state.isGuestModalOpen).toBe(false);
        expect(state.guestNativeLanguage).toBe('ES');

        const dialogOpen = await page.locator('#guestLoginModal').evaluate((el) => el.open);
        expect(dialogOpen).toBe(false);
    });

    test('a logged-in user skips all friend-lesson logic', async ({ page }) => {
        // Boot on a non-friend lesson so window.appStore exists and an anonymous
        // guard run has happened.
        await page.goto(NON_FRIEND_URL);
        await waitForGuardRun(page);

        // Stub the auth query logged-in through the app's own singleton, mark
        // the bootstrap store flag, and clear the anonymous guard traces.
        await page.evaluate(async () => {
            const { queryClient } = await import('/src/modules/api/api.js');
            queryClient.setQueryData(['auth', 'status'], true);
            window.appStore.getState().setIsLoggedIn(true);
            window.appStore.setState({
                isGuestModalOpen: false,
                guestModalShownThisSession: false,
                guestNativeLanguage: null,
            });
        });

        // Client-side navigation keeps the injected cache (a full goto would not).
        await page.evaluate(async (url) => {
            const { router } = await import('/src/routes/router.js');
            router.navigate(url);
        }, FRIEND_URL);

        await page.waitForFunction(
            () => window.location.pathname === '/course/friend/lesson/b',
            null,
            { timeout: 10000 }
        );
        // Give the guard/modal effects a beat to run against the new location.
        await page.waitForTimeout(500);

        const state = await page.evaluate(() => ({
            isLoggedIn: window.appStore.getState().isLoggedIn,
            isGuestModalOpen: window.appStore.getState().isGuestModalOpen,
            guestNativeLanguage: window.appStore.getState().guestNativeLanguage,
        }));
        expect(state.isLoggedIn).toBe(true);
        expect(state.isGuestModalOpen).toBe(false);
        // Friend logic did not run: no silent adoption of the Spanish browser language.
        expect(state.guestNativeLanguage).toBeNull();

        const dialogOpen = await page.locator('#guestLoginModal').evaluate((el) => el.open);
        expect(dialogOpen).toBe(false);
    });
});

test.describe('friend lesson + English browser', () => {
    test.use({ locale: 'en-US' });

    test('shows the language step only and never the login step', async ({ page }) => {
        await page.goto(FRIEND_URL);
        await waitForGuardRun(page);

        await expect(page.locator('#guestLanguageSelect')).toBeVisible();
        expect(await page.locator('#guestLoginBtn').count()).toBe(0);

        await page.click('#guestEnglishOnlyBtn');

        const state = await page.evaluate(() => ({
            isGuestModalOpen: window.appStore.getState().isGuestModalOpen,
            guestModalStep: window.appStore.getState().guestModalStep,
        }));
        expect(state.isGuestModalOpen).toBe(false);
        expect(state.guestModalStep).toBe('select-language');
        expect(await page.locator('#guestLoginBtn').count()).toBe(0);
    });

    test('a non-friend lesson keeps the unchanged two-step flow', async ({ page }) => {
        await page.goto(NON_FRIEND_URL);
        await waitForGuardRun(page);

        await expect(page.locator('#guestLanguageSelect')).toBeVisible();

        await page.click('#guestEnglishOnlyBtn');

        await expect(page.locator('#guestLoginBtn')).toBeVisible();
    });
});
