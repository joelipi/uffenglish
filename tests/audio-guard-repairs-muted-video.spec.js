// @ts-check
// The audio guard repairs a lesson video that ends up muted.
//
// This is the Android-only field bug (stories/075-fix-android-silent-video-start):
// the clip starts playing silently for a second or two. The app cannot always
// see WHY the audio is gone, but it can see that the element ended up muted —
// and it can repair that. This spec forces the element muted and asserts the
// app restores audibility on its own.
//
// The sentinel WebM is used (not the R2 clip) so the bundled Chromium — which
// lacks H.264 — can decode it. The guard works on the element's mute state, so
// the clip needs no audio track. The sentinel is ~1 s long, so it is looped:
// otherwise the clip ends before the guard has anything to repair.
import { test, expect } from '@playwright/test';
import {
    SENTINEL_SRC,
    confirmGuestLanguage,
    waitForLessonReady,
    waitForVideoWrapper,
} from './helpers/lesson-e2e.js';

const LESSON_URL = '/course/model/lesson/m-g';

test.describe('lesson-video audio guard', () => {
    /** Uncaught JS exceptions — resource 4xx noise is not this spec's business. */
    let pageErrors = [];

    test.beforeEach(async ({ page }) => {
        pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(e.message));
        await page.goto(LESSON_URL);
        await confirmGuestLanguage(page);
        await waitForLessonReady(page, 'm-g');
    });

    /** Mount a simple response clip (the sentinel WebM) as the playing video. */
    async function mountPlayingClip(page) {
        await page.evaluate((sentinel) => {
            const s = window.appStore.getState();
            s.setGuestModalOpen(false);
            s.setGuestModalShownThisSession(true);
            window.appStore.setState({
                isLoggedIn: true,
                userData: { native_language: 'en', auth_method: 'supabase', $id: 'test-user' },
            });
            s.setCurrentVideo({
                type: 'simple',
                responseType: 'friendClosedResponse',
                url: sentinel,
                config: { subtitles: 'Follow along.' },
            });
            s.setMediaVisible(true);
            s.transitionTo('simpleVideo', {}, { fromStepLoad: true });
        }, SENTINEL_SRC);

        await waitForVideoWrapper(page);

        // A click is a real user gesture, so the autoplay is allowed and the
        // element actually starts playing (the guard is armed on 'play').
        const video = page.locator('.ivp-video');
        await video.click({ force: true });
        await page.waitForFunction(() => {
            const v = document.querySelector('.ivp-video');
            return !!v && !v.paused;
        }, null, { timeout: 10000 });

        // The sentinel is ~1 s long; loop it so the clip does not end (and
        // disarm the guard) before the assertions run.
        await page.evaluate(() => {
            document.querySelector('.ivp-video').loop = true;
        });
    }

    test('the app restores audibility when the element is muted mid-playback', async ({ page }) => {
        await mountPlayingClip(page);

        // Force the failure the field report describes.
        await page.evaluate(() => {
            document.querySelector('.ivp-video').muted = true;
        });
        await expect.poll(
            () => page.evaluate(() => document.querySelector('.ivp-video').muted),
            { timeout: 5000 }
        ).toBe(false);
    });

    test('the app restores audibility when the volume is zeroed mid-playback', async ({ page }) => {
        await mountPlayingClip(page);

        await page.evaluate(() => {
            document.querySelector('.ivp-video').volume = 0;
        });
        await expect.poll(
            () => page.evaluate(() => document.querySelector('.ivp-video').volume),
            { timeout: 5000 }
        ).toBeGreaterThan(0);
    });

    test('the guard leaves the clip alone once it has ended', async ({ page }) => {
        await mountPlayingClip(page);

        // End the clip: the guard is disarmed, so a later mute stays muted
        // (the app never mutes a clip on its own).
        await page.evaluate(() => {
            const v = document.querySelector('.ivp-video');
            v.dispatchEvent(new Event('ended'));
        });
        await page.waitForTimeout(600);

        await page.evaluate(() => {
            document.querySelector('.ivp-video').muted = true;
        });
        await page.waitForTimeout(1000);

        expect(await page.evaluate(() => document.querySelector('.ivp-video').muted)).toBe(true);
    });

    test('no uncaught page errors while the guard runs', async ({ page }) => {
        await mountPlayingClip(page);
        await page.evaluate(() => {
            document.querySelector('.ivp-video').muted = true;
        });
        await page.waitForTimeout(1500);
        expect(pageErrors).toEqual([]);
    });
});
