// @ts-check
// Story 033: friendCode is a live mirror of the current URL (?shareCode=), not
// persisted state. A browser that once opened a friend link must not keep that
// friend's code for a later, shareCode-less visit.
//
// The app's store singleton is module-cached by Vite, so importing it from
// page.evaluate() returns the same instance the app uses (same pattern as the
// queryClient/router injections in friend-lesson-modals.spec.js).
import { test, expect } from '@playwright/test';

const STORAGE_KEY = 'uff-lesson-storage';

async function readFriendCode(page) {
    return page.evaluate(async () => {
        const { appStore } = await import('/src/modules/store/store.js');
        return appStore.getState().friendCode;
    });
}

async function expectFriendCode(page, expected) {
    await expect.poll(() => readFriendCode(page), { timeout: 15000 }).toBe(expected);
}

// Seed a legacy persisted blob exactly once per page context. Later gotos in
// the same test must not re-seed it (the guard).
async function seedLegacyFriendCodeOnce(page) {
    await page.addInitScript((key) => {
        if (!localStorage.getItem(key)) {
            localStorage.setItem(key, JSON.stringify({ state: { friendCode: 'stale' }, version: 0 }));
        }
    }, STORAGE_KEY);
}

async function stubBackend(page) {
    await page.route('**/auth/v1/**', (route) =>
        route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
    await page.route('**/rest/v1/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
}

async function goto(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
}

test.describe('friendCode staleness (URL-authoritative)', () => {
    test.beforeEach(async ({ page }) => {
        await stubBackend(page);
        await seedLegacyFriendCodeOnce(page);
    });

    test('a legacy persisted code is cleared on a shareCode-less visit', async ({ page }) => {
        await goto(page, '/');
        await expectFriendCode(page, null);
    });

    test('a shareCode in the URL is mirrored (lowercased)', async ({ page }) => {
        await goto(page, '/?shareCode=Ab12');
        await expectFriendCode(page, 'ab12');
    });

    test('navigating to a shareCode-less URL clears a previously-set code', async ({ page }) => {
        await goto(page, '/?shareCode=Ab12');
        await expectFriendCode(page, 'ab12');

        await goto(page, '/');
        await expectFriendCode(page, null);
    });

    test('a different shareCode on the same route updates the code', async ({ page }) => {
        await goto(page, '/?shareCode=ab12');
        await expectFriendCode(page, 'ab12');

        await goto(page, '/?shareCode=cd34');
        await expectFriendCode(page, 'cd34');
    });

    test('the shareCode key is read case-insensitively', async ({ page }) => {
        await goto(page, '/?SHARECODE=Ab12');
        await expectFriendCode(page, 'ab12');
    });
});
