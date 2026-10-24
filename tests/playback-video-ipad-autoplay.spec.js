// @ts-check
// The recorded take must START on an iPad (stories/094-fix-ipad-recorded-take-autoplay).
//
// iPadOS Safari refuses an unmuted `play()` that is not in the same task as a
// gesture, and some WebKit builds return `undefined` from `play()`. Both shapes
// used to leave the take on its first frame while the step kept transcribing.
//
// This spec simulates the two browser shapes in Chromium (the device policy is
// what is simulated, not the engine), records a take in the page the way the app
// produces it, and asserts the clip actually plays.
import { test, expect } from '@playwright/test';
import { confirmGuestLanguage } from './helpers/lesson-e2e.js';

const LESSON_URL = '/course/model/lesson/m-g';

/** Record a short WebM in the page — the shape the app records (canvas + audio). */
async function mountRecordedTake(page, seconds = 3) {
    const base64 = await page.evaluate(async (secs) => {
        const canvas = document.createElement('canvas');
        canvas.width = 180;
        canvas.height = 320;
        const ctx = canvas.getContext('2d');
        let t = 0;
        const draw = () => {
            t += 0.05;
            ctx.fillStyle = `hsl(${Math.round(t * 20) % 360}, 60%, 50%)`;
            ctx.fillRect(0, 0, 180, 320);
            requestAnimationFrame(draw);
        };
        draw();

        const audioCtx = new AudioContext();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        gain.gain.value = 0.2;
        const dest = audioCtx.createMediaStreamDestination();
        osc.connect(gain);
        gain.connect(dest);
        osc.start();

        const stream = new MediaStream([
            ...canvas.captureStream(25).getVideoTracks(),
            ...dest.stream.getAudioTracks(),
        ]);
        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
            ? 'video/webm;codecs=vp8,opus'
            : 'video/webm';
        const rec = new MediaRecorder(stream, { mimeType: mime });
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        rec.start(100);
        await new Promise((r) => setTimeout(r, secs * 1000));
        await new Promise((r) => { rec.onstop = r; rec.stop(); });

        const blob = new Blob(chunks, { type: mime });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    }, seconds);

    await page.evaluate((b64) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'video/webm' });
        window.appStore.setState({ mediaState: 'webcamOrAvatar' });
        window.appStore.getState().setPlaybackBlob(blob, true);
    }, base64);

    await page.waitForSelector('#playback-video', { state: 'attached', timeout: 15000 });
}

/** Assert the clip is really playing (paused=false, frames decoded, time moving). */
async function expectTakePlaying(page) {
    await page.waitForFunction(() => {
        const v = document.querySelector('#playback-video');
        return !!v && !v.paused && v.readyState >= 2;
    }, null, { timeout: 20000 });

    const before = await page.evaluate(() => document.querySelector('#playback-video').currentTime);
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => document.querySelector('#playback-video').currentTime);
    expect(after).toBeGreaterThan(before + 0.3);
}

async function openLesson(page) {
    await page.goto(LESSON_URL);
    await confirmGuestLanguage(page);
}

test.describe('iPad autoplay shapes for the recorded take', () => {
    // Init scripts only apply to the NEXT navigation, so each test installs its
    // simulated browser policy BEFORE opening the lesson.
    let pageErrors = [];

    test.beforeEach(({ page }) => {
        pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(e.message));
    });

    test('an unmuted start refused without a gesture falls back to muted, then restores sound', async ({ page }) => {
        // The iPadOS policy: an unmuted start of a PAUSED element is refused.
        // An element that is already playing (it is only being unmuted) is not a
        // start, so that call is allowed — exactly like Safari.
        await page.addInitScript(() => {
            const original = HTMLMediaElement.prototype.play;
            window.__uffOrigPlay = original;
            window.__uffPlayCalls = [];
            HTMLMediaElement.prototype.play = function patchedPlay() {
                window.__uffPlayCalls.push({ id: this.id, paused: this.paused, muted: this.muted });
                if (this.id === 'playback-video' && this.paused && !this.muted) {
                    return Promise.reject(new DOMException('autoplay blocked for test', 'NotAllowedError'));
                }
                return original.apply(this, arguments);
            };
        });

        await openLesson(page);
        await mountRecordedTake(page);
        await expectTakePlaying(page);

        // The refusal really happened, and the muted rung is what started it.
        const calls = await page.evaluate(() => window.__uffPlayCalls.filter((c) => c.id === 'playback-video'));
        expect(calls.some((c) => c.paused && !c.muted)).toBe(true);
        expect(calls.some((c) => c.paused && c.muted)).toBe(true);

        // The muted start is followed by the unmute (and a re-issued play()).
        await expect.poll(
            () => page.evaluate(() => document.querySelector('#playback-video').muted),
            { timeout: 5000 }
        ).toBe(false);
        // The learner never asked for silence, so the store must not say they did.
        expect(await page.evaluate(() => window.appStore.getState().isPlaybackMuted)).toBe(false);
        expect(pageErrors).toEqual([]);
    });

    test('play() returning undefined (WebKit) still starts the clip and throws nothing', async ({ page }) => {
        await page.addInitScript(() => {
            const original = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function patchedPlay() {
                original.apply(this, arguments);
                // WebKit shape: playback starts, but the call returns nothing —
                // a direct `.catch()` on it used to throw inside the handler.
                return undefined;
            };
        });

        await openLesson(page);
        await mountRecordedTake(page);
        await expectTakePlaying(page);
        expect(pageErrors).toEqual([]);
    });

    test('a tap on a paused take starts it instead of toggling the sound', async ({ page }) => {
        // Refuse every start attempt (the Low Power Mode shape): the ladder ends
        // with the take paused.
        await page.addInitScript(() => {
            const original = HTMLMediaElement.prototype.play;
            window.__uffOrigPlay = original;
            HTMLMediaElement.prototype.play = function patchedPlay() {
                if (this.id === 'playback-video' && this.paused) {
                    return Promise.reject(new DOMException('autoplay blocked for test', 'NotAllowedError'));
                }
                return original.apply(this, arguments);
            };
        });

        await openLesson(page);
        await mountRecordedTake(page);
        await page.waitForTimeout(3500);
        expect(await page.evaluate(() => document.querySelector('#playback-video').paused)).toBe(true);

        // The tap is a gesture: lift the simulated policy and tap the frame.
        await page.evaluate(() => {
            HTMLMediaElement.prototype.play = window.__uffOrigPlay;
        });
        await page.locator('#playback-video').click({ force: true });
        await expectTakePlaying(page);
        expect(pageErrors).toEqual([]);
    });
});
