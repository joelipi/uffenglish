// Shared Playwright scaffolding for the lesson specs.
//
// These three pieces were previously copy-pasted into every spec that mounts a
// lesson, mounts a sentinel clip, or needs to get past the guest-language gate.
// Keeping them in one place means a change to the guest-modal flow or the
// sentinel clip only has to be made once.

import { expect } from '@playwright/test';

// A tiny valid VP9/WebM clip (616 bytes, generated with ffmpeg). Bundled
// Chromium decodes WebM natively, unlike H.264, so the video loads and does not
// fire `error`; autoplay is blocked below so `ended` only fires when the test
// dispatches it. This keeps pre-reveal states deterministic without codec
// flakiness.
export const SENTINEL_SRC = 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAI4EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggIi7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiEBpAAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYjcq/RnP6WRk5yBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhAJiWgDgibCBELqBEJqBAhJUw2dAgHNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjAuMTYuMTAwc3PaY8CLY8WI3Kv0Zz+lkZNnyKVFo4dFTkNPREVSRIeYTGF2YzYwLjMxLjEwMiBsaWJ2cHgtdnA5Z8ihRaOIRFVSQVRJT05Eh5MwMDowMDowMC4yMDAwMDAwMDAAH0O2dfnngQCjoIEAAICCSYNCAADwAPYAOCQcGEoAADBgAAAQv//9SIwAo5OBACgAhgBAkpwAUAAAAyAAAEJAo5OBAFAAhgBAkpwATuAAAyAAAEJAo5OBAHgAhgBAkpwAUAAAAyAAAEJAo5OBAKAAhgBAkpwATUAAAyAAAEJAHFO7a5G7j7OBALeK94EB8YIBpPCBAw==';

// Console errors we deliberately ignore: unrelated to the app under test
// (bootstrap-icons fonts 403 through the symlinked node_modules, missing
// sourcemaps, auth-probe noise, cache noise).
export const NOISE = ['favicon', 'source map', 'Whisper', 'vite', '401', 'Unauthorized', 'ERR_CACHE_WRITE_FAILURE'];

// Never fulfil a request — keeps a real clip from loading/ending/erroring
// underneath deterministic assertions.
export const HANG = () => { /* intentionally never fulfill — keeps the request pending */ };

/** Collect page errors + "Unexpected transition" warnings for later assertion. */
export function collectConsole(page) {
    const state = { errors: [], transitionWarnings: [] };

    page.on('pageerror', e => state.errors.push(e.message));
    page.on('console', msg => {
        const text = msg.text();
        const loc = msg.location()?.url || '';
        if (msg.type() === 'error') {
            if (!NOISE.some(n => text.includes(n)) && !loc.includes('bootstrap-icons')) {
                state.errors.push(text);
            }
        }
        if (msg.type() === 'warning' && text.includes('Unexpected transition')) {
            state.transitionWarnings.push(text);
        }
    });
    page.on('dialog', d => d.dismiss());

    return state;
}

/** Reject play() for the sentinel clip only, so it can never autoplay. */
export async function blockSentinelAutoplay(page) {
    await page.addInitScript(() => {
        const origPlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
            if (typeof this.src === 'string' && this.src.startsWith('data:video/webm')) {
                return Promise.reject(new DOMException('autoplay disabled for test', 'NotAllowedError'));
            }
            return origPlay.apply(this, arguments);
        };
    });
}

/**
 * Clear the guest-language gate: an anonymous visitor must confirm a language
 * before `configData` is set (config-normalizer.js isConfigLanguageSettled).
 * Confirm English when offered, then dismiss the login-choice step if the
 * lesson produced one.
 */
export async function confirmGuestLanguage(page) {
    await page.waitForFunction(
        () => window.appStore?.getState()?.configData || document.querySelector('#guestEnglishOnlyBtn'),
        null,
        { timeout: 30000 }
    );
    if (await page.locator('#guestEnglishOnlyBtn').count()) {
        await page.click('#guestEnglishOnlyBtn').catch(() => {});
        const continueBtn = page.locator('#guestContinueBtn');
        await continueBtn.waitFor({ state: 'visible', timeout: 3000 }).then(() => continueBtn.click()).catch(() => {});
    }
    await page.waitForFunction(() => window.appStore?.getState()?.configData, null, { timeout: 20000 });
}

/** Wait until the async lesson bootstrap has mounted the lesson intro step. */
export async function waitForLessonReady(page, lessonId) {
    await page.waitForFunction((id) => {
        const s = window.appStore?.getState();
        return s?.activeLessonId === id && s?.currentVideo?.type === 'intro' && s?.appPhase === 'lessonIntro';
    }, lessonId, { timeout: 25000 });
}

/** Wait out the 3s FOUC fallback that makes the video wrapper visible. */
export async function waitForVideoWrapper(page) {
    await page.waitForSelector('.ivp-video', { state: 'attached', timeout: 5000 });
    await expect(page.locator('.ivp-main-wrapper')).toBeVisible({ timeout: 6000 });
}
