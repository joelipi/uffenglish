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
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** Record a short WebM in the page — the shape the app records (canvas + audio). */
async function mountRecordedTake(page, seconds = 3, beforeHandover = null) {
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

    if (typeof beforeHandover === 'function') await page.evaluate(beforeHandover);

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

    test('a second take does not inherit the previous take\'s silent loop', async ({ page }) => {
        await openLesson(page);
        await mountRecordedTake(page, 1);
        await expectTakePlaying(page);

        // Let the first take end and switch itself into the silent loop.
        await page.waitForFunction(() => {
            const v = document.querySelector('#playback-video');
            return !!v && v.loop === true;
        }, null, { timeout: 15000 });

        // Hand over a re-record. The persistent <video> element keeps `loop`
        // unless the new take resets it; an inherited `true` means the second
        // take auto-loops from its first play and never fires `ended`, so it
        // never performs the audible-once → silent-loop hand-off.
        await mountRecordedTake(page, 1);
        await page.waitForFunction(() => {
            const v = document.querySelector('#playback-video');
            return !!v && !v.paused && v.loop === false;
        }, null, { timeout: 15000 });
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

    // The recorded take is the one place the app knows it is on iOS and can
    // choose the only start iPadOS allows: muted first, then re-open the audio.
    test.describe('an iPad user agent starts muted on the first attempt', () => {
        test.use({ userAgent: IPAD_UA });

        test('the first play() call for the take is muted', async ({ page }) => {
            await page.addInitScript(() => {
                const original = HTMLMediaElement.prototype.play;
                window.__uffPlayCalls = [];
                HTMLMediaElement.prototype.play = function patchedPlay() {
                    window.__uffPlayCalls.push({ id: this.id, paused: this.paused, muted: this.muted });
                    return original.apply(this, arguments);
                };
            });

            await openLesson(page);
            await mountRecordedTake(page);
            await expectTakePlaying(page);

            const calls = await page.evaluate(
                () => window.__uffPlayCalls.filter((call) => call.id === 'playback-video')
            );
            expect(calls.length).toBeGreaterThan(0);
            // The unmuted start is always refused on iPad; asking for it first
            // makes the take depend on the fallback's timing (the ?diag=1 race).
            expect(calls[0]).toMatchObject({ paused: true, muted: true });
            expect(pageErrors).toEqual([]);
        });
    });

    // The field report behind this block: the take "never plays" on an iPad and
    // plays normally with `?diag=1`. The start had been ACCEPTED (`play()`
    // resolved) while the element stayed paused, and the only thing that ever
    // restarted it was another readiness event — which had already fired. The
    // start path must look at the element instead of waiting for that luck.
    test.describe('a take the element leaves unplayed', () => {
        test.use({ userAgent: IPAD_UA });

        test('is restarted by itself instead of waiting for another readiness event', async ({ page }) => {
            await page.addInitScript(() => {
                const original = HTMLMediaElement.prototype.play;
                window.__uffIgnoredStarts = 0;
                HTMLMediaElement.prototype.play = function patchedPlay() {
                    // The field shape: the start is accepted and nothing happens,
                    // long enough for every readiness event to have gone by.
                    if (this.id === 'playback-video' && Date.now() < (window.__uffIgnoreUntil || 0)) {
                        window.__uffIgnoredStarts += 1;
                        return Promise.resolve();
                    }
                    return original.apply(this, arguments);
                };
            });

            await openLesson(page);
            await mountRecordedTake(page, 2, () => { window.__uffIgnoreUntil = Date.now() + 900; });

            // The old start path gave up here and left the take on its first
            // frame with `paused: true`; the watchdog keeps starting it.
            await expectTakePlaying(page);
            expect(await page.evaluate(() => window.__uffIgnoredStarts)).toBeGreaterThan(0);

            // …and the rest of the contract still holds: audible once, then the
            // silent loop.
            await expect.poll(
                () => page.evaluate(() => document.querySelector('#playback-video').muted),
                { timeout: 5000 }
            ).toBe(false);
            await page.waitForFunction(
                () => document.querySelector('#playback-video')?.loop === true,
                null,
                { timeout: 20000 }
            );
            expect(pageErrors).toEqual([]);
        });
    });

    // Field report after the countdown ship: "when I pressed play, it played
    // muted". iOS's own play control starts playback with the element's CURRENT
    // mute state, so a technical mute left behind by the autoplay handshake makes
    // a native start silent. A pause must therefore leave the element AUDIBLE —
    // the state only, never a resumed play() — and the silent loop (the learner's
    // own silence) is the one case that stays muted.
    test.describe('the native play control starts the take with sound', () => {
        test.use({ userAgent: IPAD_UA });

        test('a pause does not leave the technical mute behind', async ({ page }) => {
            await openLesson(page);
            await mountRecordedTake(page);
            await expectTakePlaying(page);

            const after = await page.evaluate(async () => {
                const video = document.querySelector('#playback-video');
                video.muted = true;   // the leftover technical mute
                video.pause();
                await new Promise((resolve) => setTimeout(resolve, 100));
                return { paused: video.paused, muted: video.muted };
            });
            expect(after.paused).toBe(true);
            expect(after.muted).toBe(false);

            // What iOS's control does: play() with the element as it stands.
            const playing = await page.evaluate(async () => {
                const video = document.querySelector('#playback-video');
                await video.play();
                return { paused: video.paused, muted: video.muted };
            });
            expect(playing.paused).toBe(false);
            expect(playing.muted).toBe(false);
            expect(pageErrors).toEqual([]);
        });
    });
});
