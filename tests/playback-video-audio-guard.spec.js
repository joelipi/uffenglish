// @ts-check
// The audio guard repairs the recorded take when it ends up muted.
//
// This is the Android-only field bug (stories/075-fix-android-silent-video-start):
// the clip starts playing silently for a second or two. The app cannot always
// see WHY the audio is gone, but it can see that the element ended up muted —
// and it can repair that.
//
// The recorded take is produced the way the app produces it: a MediaRecorder
// WebM blob handed to `setPlaybackBlob`. The clip is long enough not to end
// during the test (the app mutes and loops a clip that has ended — an
// intentional silence the guard must respect, which is asserted separately).
import { test, expect } from '@playwright/test';
import { confirmGuestLanguage } from './helpers/lesson-e2e.js';

const LESSON_URL = '/course/model/lesson/m-g';

/**
 * Record a short WebM in the page — the same shape the app records (a canvas
 * video track plus an audio track) — and hand it to the playback player.
 *
 * The canvas has to keep changing: `captureStream()` only emits frames while
 * the canvas is repainted.
 */
async function mountRecordedTake(page, seconds = 4) {
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
        gain.gain.value = 0.3;
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

    // The clip must actually be playing: the guard only repairs an element
    // that is playing (a paused element is silent by definition).
    await page.waitForFunction(() => {
        const v = document.querySelector('#playback-video');
        return !!v && !v.paused && v.readyState >= 2;
    }, null, { timeout: 15000 });
}

test.describe('recorded-take playback audio guard', () => {
    /** Uncaught JS exceptions — resource 4xx noise is not this spec's business. */
    let pageErrors = [];

    test.beforeEach(async ({ page }) => {
        pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(e.message));
        await page.goto(LESSON_URL);
        await confirmGuestLanguage(page);
    });

    test('the app restores audibility when the recorded take is muted mid-playback', async ({ page }) => {
        await mountRecordedTake(page);

        // Force the failure the field report describes.
        await page.evaluate(() => {
            document.querySelector('#playback-video').muted = true;
        });
        await expect.poll(
            () => page.evaluate(() => document.querySelector('#playback-video').muted),
            { timeout: 5000 }
        ).toBe(false);
    });

    test('the app restores audibility when the volume is zeroed mid-playback', async ({ page }) => {
        await mountRecordedTake(page);

        await page.evaluate(() => {
            document.querySelector('#playback-video').volume = 0;
        });
        await expect.poll(
            () => page.evaluate(() => document.querySelector('#playback-video').volume),
            { timeout: 5000 }
        ).toBeGreaterThan(0);
    });

    test('the app does not unmute a take the learner muted on purpose', async ({ page }) => {
        await mountRecordedTake(page);

        // The learner taps the clip to mute it. That is an intentional silence:
        // the guard must not undo it.
        await page.evaluate(() => {
            document.querySelector('#playback-video').click();
        });
        await page.waitForTimeout(1500);

        expect(await page.evaluate(() => document.querySelector('#playback-video').muted)).toBe(true);
    });

    test('no uncaught page errors while the guard runs', async ({ page }) => {
        await mountRecordedTake(page);
        await page.evaluate(() => {
            document.querySelector('#playback-video').muted = true;
        });
        await page.waitForTimeout(1500);
        expect(pageErrors).toEqual([]);
    });
});
