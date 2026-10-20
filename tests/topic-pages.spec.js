// @ts-check
import { test, expect } from '@playwright/test';

// The topic pages: `/welcome` ("choose your topic") and the tag pages it links
// to. Both are INSIDE pages of the app, so they render inside the app shell
// (the shared header, like the courses and friends pages) and the guest
// language/login modal opens for an anonymous visitor.

async function dismissGuestModal(page) {
    const englishOnly = page.locator('#guestEnglishOnlyBtn');
    if (await englishOnly.count()) {
        await englishOnly.click().catch(() => {});
    }
    const continueAsGuest = page.locator('#guestContinueBtn');
    if (await continueAsGuest.count()) {
        await continueAsGuest.click().catch(() => {});
    }
}

async function openWelcome(page) {
    await page.goto('/welcome');
    await dismissGuestModal(page);
    await expect(page.getByTestId('welcome-heading')).toBeVisible();
}

test.describe('the topic pages', () => {
    test('the welcome page shows one big button per topic', async ({ page }) => {
        await openWelcome(page);

        await expect(page.getByTestId('welcome-heading')).toHaveText('Choose your topic');

        const buttons = page.getByTestId('welcome-tag-button');
        await expect(buttons.first()).toBeVisible();
        const hrefs = await buttons.evaluateAll((els) => els.map((el) => el.getAttribute('href')));
        expect(hrefs.length).toBeGreaterThan(0);
        for (const href of hrefs) {
            expect(href).toMatch(/^\/tags\//);
        }
        // The four course tags under test are all reachable.
        expect(hrefs).toContain('/tags/travel');
        expect(hrefs).toContain('/tags/family');
        expect(hrefs).toContain('/tags/music');
        expect(hrefs).toContain('/tags/sports');
    });

    test('the welcome page renders inside the app shell, with the shared header', async ({ page }) => {
        await openWelcome(page);

        await expect(page.getByTestId('app-shell')).toBeVisible();
        await expect(page.getByTestId('app-header')).toBeVisible();
    });

    test('a topic page lists the courses of that topic and links to the course', async ({ page }) => {
        await openWelcome(page);

        await page.getByTestId('welcome-tag-button').filter({ hasText: 'family' }).click();

        await expect(page.getByTestId('tag-heading')).toHaveText('family');
        const cards = page.getByTestId('tag-course-card');
        await expect(cards.first()).toBeVisible();
        const hrefs = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('href')));
        for (const href of hrefs) {
            expect(href).toMatch(/^\/course\/[^/]+\/lesson\/[^/]+$/);
        }
        // The friend chain course carries the "family" tag.
        expect(hrefs).toContain('/course/friendchain/lesson/a');
        // The shared header is there on a topic page too.
        await expect(page.getByTestId('app-header')).toBeVisible();
    });

    test('a topic page shows the mission expanded', async ({ page }) => {
        await openWelcome(page);

        await page.getByTestId('welcome-tag-button').filter({ hasText: 'family' }).click();

        const mission = page.getByTestId('course-mission').first();
        await expect(mission).toBeVisible();
        await expect(mission).toHaveClass(/expanded/);
    });

    test('the home page sends "start without a friend\'s code" to the welcome page', async ({ page }) => {
        await page.goto('/');
        await page.getByTestId('no-code').first().click();

        await expect(page.getByTestId('welcome-heading')).toBeVisible();
    });
});
