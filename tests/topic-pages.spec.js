// @ts-check
import { test, expect } from '@playwright/test';

// The topic pages: `/welcome` ("choose your topic") and the tag pages it links
// to. Both are INSIDE pages of the app (the shared header, like the courses
// and friends pages) and both are PUBLIC routes: the guest language/login
// modal is suppressed there, because they are where a visitor WITHOUT a
// friend's code goes — the modal would cover the topic buttons.

async function openWelcome(page) {
    await page.goto('/welcome');
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
        // The four course topics under test are all reachable.
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

    test('the guest language/login modal is suppressed on the topic pages', async ({ page }) => {
        await openWelcome(page);

        // The modal is a top-layer <dialog>: if it were open it would cover the
        // topic buttons and intercept the click below.
        await expect(page.locator('#guestLoginModal')).not.toBeVisible();

        await page.getByTestId('welcome-tag-button').filter({ hasText: 'Travel' }).click();
        await expect(page.getByTestId('tag-heading')).toBeVisible();
        await expect(page.locator('#guestLoginModal')).not.toBeVisible();
    });

    test('a topic page lists the courses of that topic and links to the course', async ({ page }) => {
        await openWelcome(page);

        await page.getByTestId('welcome-tag-button').filter({ hasText: 'Travel' }).click();

        await expect(page.getByTestId('tag-heading')).toContainText('Travel');
        const cards = page.getByTestId('tag-course-card');
        await expect(cards.first()).toBeVisible();
        const hrefs = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('href')));
        for (const href of hrefs) {
            expect(href).toMatch(/^\/course\/[^/]+\/lesson\/[^/]+$/);
        }
        // The shared header is there on a topic page too.
        await expect(page.getByTestId('app-header')).toBeVisible();
    });

    test('a topic page shows the mission expanded', async ({ page }) => {
        await openWelcome(page);

        // The friend chain course carries a mission block.
        await page.getByTestId('welcome-tag-button').filter({ hasText: 'Family' }).click();

        const mission = page.getByTestId('course-mission').first();
        await expect(mission).toBeVisible();
        await expect(mission).toHaveClass(/expanded/);
    });

    test('a topic shows the English word first and the visitor\'s language after it', async ({ browser }) => {
        // A learner who is still learning English may not know what the topic
        // means in English, so both words are on the button.
        const context = await browser.newContext({ locale: 'es-ES' });
        const page = await context.newPage();
        try {
            await page.goto('/welcome');
            await expect(page.getByTestId('welcome-heading')).toBeVisible();

            const button = page.getByTestId('welcome-tag-button').filter({ hasText: 'Travel' }).first();
            await expect(button).toContainText('Travel');
            await expect(button).toContainText('Viajes');
            // The English word comes first.
            const text = (await button.textContent()).trim();
            expect(text.indexOf('Travel')).toBeLessThan(text.indexOf('Viajes'));
        } finally {
            await context.close();
        }
    });

    test('the home page sends "start without a friend\'s code" to the welcome page', async ({ page }) => {
        await page.goto('/');
        await page.getByTestId('no-code').first().click();

        await expect(page.getByTestId('welcome-heading')).toBeVisible();
    });
});

// The topic drop-down on the course lists: /home and /courses share the same
// list view, so the picker is on both.
test.describe('the topic drop-down on the course lists', () => {
    test('the courses page offers a topic drop-down under a bilingual subheading', async ({ page }) => {
        await page.goto('/courses');
        await expect(page.getByTestId('friend-courses-heading')).toBeVisible();

        const subheading = page.getByTestId('course-topic-heading');
        await expect(subheading).toContainText('Choose a topic to practice talking about.');

        const select = page.getByTestId('course-topic-select');
        await expect(select).toBeVisible();
        const values = await select.locator('option').evaluateAll((els) => els.map((el) => el.value));
        expect(values[0]).toBe('');
        expect(values).toContain('family');
        expect(values).toContain('preferences');
    });

    test('choosing a topic narrows the course list', async ({ page }) => {
        await page.goto('/courses');
        await expect(page.getByTestId('friend-course-card').first()).toBeVisible();
        const before = await page.getByTestId('friend-course-card').count();

        await page.getByTestId('course-topic-select').selectOption('preferences');
        const after = await page.getByTestId('friend-course-card').count();
        expect(after).toBeLessThan(before);
        expect(after).toBeGreaterThan(0);

        await page.getByTestId('course-topic-select').selectOption('');
        await expect(page.getByTestId('friend-course-card')).toHaveCount(before);
    });

    test('the home screen carries the same drop-down, with no guest modal over it', async ({ page }) => {
        await page.goto('/home');

        // The dashboard is a public route: the guest language/login modal
        // would cover the topic drop-down, so it must not open here.
        await expect(page.locator('#guestLoginModal')).not.toBeVisible();

        const select = page.getByTestId('course-topic-select');
        await expect(select).toBeVisible();
        await expect(page.getByTestId('course-topic-heading')).toContainText('Choose a topic to practice talking about.');
    });
});
