// @ts-check
import { test, expect } from '@playwright/test';

// Public-profile friend-challenge links. The profile is loaded through
// useUserByShareCode; we settle its initial (empty) query, then inject the
// fixture through the app's own queryClient singleton (same pattern as
// answer-flow.spec.js importing app modules). page.clock fixes "now" so the
// 48h countdown is deterministic.

const FIXED_NOW = '2026-09-24T12:00:00.000Z';
// Must satisfy isShareCodeSegment: /:shareCode falls through to the 404 page
// for a segment the generator could not have minted.
const SHARE_CODE = 'k9gy';
// The one friend course we keep (the dev twin of the generated config). Its
// chain runs a -> b -> ... -> f, so `a` is the chain head the read-time filter
// keeps and `c` is filtered out for a logged-out visitor.
const COURSE_ID = 'wouldyourather-test';
const COURSE_NAME = 'Get $1 million or $5 million?';

const PROFILE = {
    id: 'u1',
    first_name: 'Test',
    last_name: 'User',
    // The app reads the camelCase aliases `fromDbRow` adds; the fixture is
    // injected into the query cache directly, so it carries both shapes.
    firstName: 'Test',
    lastName: 'User',
    native_language: 'EN',
    english_level: 'B1',
    join_date: '2026-01-01T00:00:00Z',
    share_code: SHARE_CODE,
    profile_picture_url: null,
    completed_dates: [],
    lessons_completed: 3,
};

const entry = (courseId, courseName, recordedLessonId, lessonId, lessonTitle, addedAt) => ({
    courseId, courseName, recordedLessonId, lessonId, lessonTitle, shareCode: SHARE_CODE, addedAt,
});

async function seedProfile(page, friendLinks) {
    await page.goto(`/${SHARE_CODE}`);
    // Wait for the initial query to settle into the not-found state before
    // overriding the cache, so it cannot land afterwards and clobber the fixture.
    await expect(page.getByText('User not found')).toBeVisible();
    await page.evaluate(async ({ key, profile }) => {
        const { queryClient } = await import('/src/modules/api/api.js');
        queryClient.setQueryData(['user', 'profile', 'shareCode', key], profile);
    }, { key: SHARE_CODE, profile: { ...PROFILE, friendLinks } });
}

test.describe('public-profile friend-challenge links', () => {
    test.beforeEach(async ({ page }) => {
        await page.clock.setFixedTime(new Date(FIXED_NOW));
        // Deterministic Supabase: the public_profiles lookup resolves to empty.
        await page.route('**/rest/v1/**', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        );
    });

    test('renders the recorded-lesson label and countdown for an active entry', async ({ page }) => {
        await seedProfile(page, {
            [`${COURSE_ID}:a`]: entry(COURSE_ID, COURSE_NAME, 'a', 'b', 'Make 3 questions', '2026-09-24T11:00:00.000Z'),
        });

        await expect(page.getByTestId('friend-lesson-links-heading'))
            .toHaveText('Click on a lesson to start practicing with Test User right now free!');
        await expect(page.getByTestId('friend-lesson-links-subheading'))
            .toHaveText('Test User does not have to be online now, they can respond to you later.');

        const link = page.getByTestId('friend-lesson-link');
        await expect(link).toBeVisible();
        await expect(link).toHaveText('Make 3 questions');
        // The link is an IN-APP link: a react-router <Link> to a PATH, so the
        // click is a client-side navigation. A document load (a plain <a href>)
        // is the only thing in the app that can end in a browser-level "This
        // site can't be reached / ERR_FAILED" page, and it also threw the
        // in-memory guest language away.
        await expect(link).toHaveAttribute(
            'href',
            `/course/${COURSE_ID}/lesson/b?shareCode=k9gy`
        );

        const fontSize = await link.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        expect(fontSize).toBeGreaterThanOrEqual(24);

        const style = await link.evaluate((el) => {
            const s = getComputedStyle(el);
            return { color: s.color, decoration: s.textDecorationLine };
        });
        expect(style.color).toBe('rgb(255, 255, 255)');
        expect(style.decoration).toContain('underline');

        await expect(page.getByTestId('friend-lesson-link-countdown'))
            .toHaveText('Available for 47h 0m');
    });

    test('logged-out visitor sees every recorded link, under a course heading', async ({ page }) => {
        // The profile holds one link per recorded lesson (the ping-pong
        // chain), so a visitor sees where the chain stands, not just its
        // first lesson.
        await seedProfile(page, {
            [`${COURSE_ID}:a`]: entry(COURSE_ID, COURSE_NAME, 'a', 'b', 'Ask', '2026-09-24T11:00:00.000Z'),
            [`${COURSE_ID}:c`]: entry(COURSE_ID, COURSE_NAME, 'c', 'd', 'Follow Up', '2026-09-24T10:00:00.000Z'),
        });

        await expect(page.getByTestId('friend-lesson-link-group-heading')).toHaveText(COURSE_NAME);

        const links = page.getByTestId('friend-lesson-link');
        await expect(links).toHaveCount(2);
        await expect(links.nth(0)).toHaveAttribute(
            'href',
            `/course/${COURSE_ID}/lesson/b?shareCode=k9gy`
        );
        await expect(links.nth(0)).toHaveText('Ask');
        await expect(links.nth(1)).toHaveAttribute(
            'href',
            `/course/${COURSE_ID}/lesson/d?shareCode=k9gy`
        );
        await expect(links.nth(1)).toHaveText('Follow Up');
    });

    test('every lesson link stays on the site origin', async ({ page }) => {
        // The regression guard: a hard-coded apex here made the click leave the
        // host the visitor was on, which a webview wrapper refuses outright
        // (ERR_FAILED) and which silently sends a staging visitor to production.
        await seedProfile(page, {
            [`${COURSE_ID}:a`]: entry(COURSE_ID, COURSE_NAME, 'a', 'b', 'Ask', '2026-09-24T11:00:00.000Z'),
        });

        const origin = new URL(page.url()).origin;
        const hrefs = await page.getByTestId('friend-lesson-link')
            .evaluateAll((els) => els.map((el) => el.getAttribute('href')));
        expect(hrefs.length).toBeGreaterThan(0);
        for (const href of hrefs) {
            // Resolved against the page's own URL: a relative in-app path can
            // only ever resolve to the origin the visitor is already on.
            expect(new URL(href, page.url()).origin).toBe(origin);
        }
    });

    test('shows the expired state once the 48h window has passed', async ({ page }) => {
        // Exactly 48h before the fixed clock -> inactive (inclusive boundary).
        await seedProfile(page, {
            [`${COURSE_ID}:a`]: entry(COURSE_ID, COURSE_NAME, 'a', 'b', 'Make 3 questions', '2026-09-22T12:00:00.000Z'),
        });

        await expect(page.getByTestId('friend-lesson-link')).toHaveCount(0);
        await expect(page.getByTestId('friend-lesson-links')).toHaveCount(0);
        await expect(page.getByTestId('friend-lessons-expired-message')).toContainText('expired after 48 hours');
        await expect(page.getByTestId('friend-lessons-practice-free')).toHaveAttribute('href', '/courses');
    });

    test('shows the expired state when there are no links', async ({ page }) => {
        await seedProfile(page, {});

        await expect(page.getByTestId('friend-lesson-links')).toHaveCount(0);
        await expect(page.getByTestId('friend-lesson-link')).toHaveCount(0);
        await expect(page.getByTestId('friend-lessons-expired')).toBeVisible();
    });

    test('renders no link when the profile cannot be resolved', async ({ page }) => {
        await page.goto(`/${SHARE_CODE}`);

        await expect(page.getByTestId('friend-lesson-link')).toHaveCount(0);
    });

    test('the click stays inside the app and carries the friend code', async ({ page }) => {
        // The regression guard for the reported "black error screen": the link
        // used to be a plain <a href> with an absolute URL, so the click was a
        // DOCUMENT load — the only thing in the app that can end in a
        // browser-level "This site can't be reached / ERR_FAILED" page. A
        // marker on the window survives a client-side navigation and is wiped
        // by a document load, so it tells the two apart.
        await seedProfile(page, {
            [`${COURSE_ID}:a`]: entry(COURSE_ID, COURSE_NAME, 'a', 'b', 'Ask', '2026-09-24T11:00:00.000Z'),
        });

        await page.evaluate(() => { window.__uffSameDocument = true; });
        await page.getByTestId('friend-lesson-link').click();

        await page.waitForURL(new RegExp(`/course/${COURSE_ID}/lesson/b\\?shareCode=${SHARE_CODE}$`));
        expect(await page.evaluate(() => window.__uffSameDocument)).toBe(true);

        // The friend's code reached the store, so the lesson plays the friend's
        // take instead of the learner's own.
        const friendCode = await page.evaluate(async () => {
            const { appStore } = await import('/src/modules/store/store.js');
            return appStore.getState().friendCode;
        });
        expect(friendCode).toBe(SHARE_CODE);
    });
});
