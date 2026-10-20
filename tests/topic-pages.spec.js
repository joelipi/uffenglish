// @ts-check
import { test, expect } from '@playwright/test';

// The topic pages: `/welcome` ("choose your topic") and the tag pages it links
// to. Both are INSIDE pages of the app (the shared header, like the courses
// and friends pages) and both are PUBLIC routes: the guest language/login
// modal is suppressed there, because they are where a visitor WITHOUT a
// friend's code goes — the modal would cover the topic buttons.
//
// The topics under test are the ones the surviving courses carry: `food`
// (the regular course) and `preferences` (the friend course). A topic is
// listed by its DISPLAY label ("Preferences"), while its href is the
// normalized tag (`/tags/preferences`).

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
        // The course topics under test are all reachable.
        expect(hrefs).toContain('/tags/food');
        expect(hrefs).toContain('/tags/preferences');
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

        await page.getByTestId('welcome-tag-button').filter({ hasText: 'Preferences' }).click();
        await expect(page.getByTestId('tag-heading')).toBeVisible();
        await expect(page.locator('#guestLoginModal')).not.toBeVisible();
    });

    test('a topic page lists the courses of that topic and links to the course', async ({ page }) => {
        await openWelcome(page);

        await page.getByTestId('welcome-tag-button').filter({ hasText: 'Preferences' }).click();

        await expect(page.getByTestId('tag-heading')).toContainText('Preferences');
        const cards = page.getByTestId('tag-course-card');
        await expect(cards.first()).toBeVisible();
        const hrefs = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('href')));
        for (const href of hrefs) {
            expect(href).toMatch(/^\/course\/[^/]+\/lesson\/[^/]+$/);
        }
        // The friend course carries the "preferences" topic.
        expect(hrefs).toContain('/course/wouldyourather/lesson/a');
        // The shared header is there on a topic page too.
        await expect(page.getByTestId('app-header')).toBeVisible();
    });

    test('a topic page shows the mission expanded', async ({ page }) => {
        await openWelcome(page);

        await page.getByTestId('welcome-tag-button').filter({ hasText: 'Preferences' }).click();

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

            const button = page.getByTestId('welcome-tag-button').filter({ hasText: 'Preferences' }).first();
            await expect(button).toContainText('Preferences');
            await expect(button).toContainText('Preferencias');
            // The English word comes first.
            const text = (await button.textContent()).trim();
            expect(text.indexOf('Preferences')).toBeLessThan(text.indexOf('Preferencias'));
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
        // The options are the topics of the courses ON SCREEN, so the picker
        // can never offer a topic with no course behind it.
        expect(values.slice(1).sort()).toEqual(['getting to know you', 'money', 'preferences']);
    });

    test('choosing a topic keeps the course that carries it', async ({ page }) => {
        // The one listed course carries every topic the drop-down offers, so
        // the list cannot get shorter here; the filtering itself is covered by
        // the component test, which renders several courses.
        await page.goto('/courses');
        await expect(page.getByTestId('friend-course-card').first()).toBeVisible();

        await page.getByTestId('course-topic-select').selectOption('preferences');
        await expect(page.getByTestId('friend-course-card')).toHaveCount(1);
        await expect(page.getByTestId('friend-course-card').first())
            .toHaveAttribute('href', '/course/wouldyourather/lesson/a');

        await page.getByTestId('course-topic-select').selectOption('');
        await expect(page.getByTestId('friend-course-card')).toHaveCount(1);
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
