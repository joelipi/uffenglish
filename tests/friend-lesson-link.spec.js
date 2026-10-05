// @ts-check
import { test, expect } from '@playwright/test';

// Public-profile friend-challenge links. The profile is loaded through
// useUserByShareCode; we settle its initial (empty) query, then inject the
// fixture through the app's own queryClient singleton (same pattern as
// answer-flow.spec.js importing app modules). page.clock fixes "now" so the
// 48h countdown is deterministic.

const FIXED_NOW = '2026-09-24T12:00:00.000Z';
const SHARE_CODE = 'friendtest1';

const PROFILE = {
    id: 'u1',
    first_name: 'Test',
    last_name: 'User',
    native_language: 'EN',
    english_level: 'B1',
    join_date: '2026-01-01T00:00:00Z',
    share_code: SHARE_CODE,
    profile_picture_url: null,
    completed_dates: [],
    lessons_completed: 3,
};

const entry = (courseId, lessonId, lessonTitle, addedAt) => ({
    courseId, lessonId, lessonTitle, shareCode: SHARE_CODE, addedAt,
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

    test('renders the large titled link and countdown for an active entry', async ({ page }) => {
        await seedProfile(page, {
            'friend:b': entry('friend', 'b', 'Respond', '2026-09-24T11:00:00.000Z'),
        });

        const link = page.getByTestId('friend-lesson-link');
        await expect(link).toBeVisible();
        await expect(link).toHaveText('Practice English with Me — Respond');
        await expect(link).toHaveAttribute(
            'href',
            'https://ultrafastfluency.com/course/friend/lesson/b?shareCode=friendtest1'
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

    test('renders one labelled link per active lesson', async ({ page }) => {
        await seedProfile(page, {
            'friendchain:b': entry('friendchain', 'b', 'Respond', '2026-09-24T11:00:00.000Z'),
            'friendchain:c': entry('friendchain', 'c', 'Follow Up', '2026-09-24T10:00:00.000Z'),
        });

        const links = page.getByTestId('friend-lesson-link');
        await expect(links).toHaveCount(2);
        await expect(links.nth(0)).toHaveAttribute(
            'href',
            'https://ultrafastfluency.com/course/friendchain/lesson/b?shareCode=friendtest1'
        );
        await expect(links.nth(1)).toHaveAttribute(
            'href',
            'https://ultrafastfluency.com/course/friendchain/lesson/c?shareCode=friendtest1'
        );
        await expect(links.nth(0)).toContainText('Respond');
        await expect(links.nth(1)).toContainText('Follow Up');
    });

    test('removes the link once the 48h window has passed', async ({ page }) => {
        // Exactly 48h before the fixed clock -> inactive (inclusive boundary).
        await seedProfile(page, {
            'friend:b': entry('friend', 'b', 'Respond', '2026-09-22T12:00:00.000Z'),
        });

        await expect(page.getByTestId('friend-lesson-link')).toHaveCount(0);
        await expect(page.getByTestId('friend-lesson-links')).toHaveCount(0);
    });

    test('renders no section when there are no links', async ({ page }) => {
        await seedProfile(page, {});

        await expect(page.getByTestId('friend-lesson-links')).toHaveCount(0);
        await expect(page.getByTestId('friend-lesson-link')).toHaveCount(0);
    });

    test('renders no link when the profile cannot be resolved', async ({ page }) => {
        await page.goto(`/${SHARE_CODE}`);

        await expect(page.getByTestId('friend-lesson-link')).toHaveCount(0);
    });
});
