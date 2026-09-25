// Diagnostic E2E for lesson g — why video will not play
import { test, expect } from '@playwright/test';

const LESSON_G = '/course/model/lesson/g';
const SLUGS_G = [
  'do_you_have_dark_chocolate', // intro 0
  'do_you_have_rolls_too', // step 1 interactive closed
  'do_you_have_dark_chocolate', // step 2 simple
  'do_you_have_very_bitter_dark_chocolate', // step 3
  'where_is_the_bread_aisle', // step 4
  'success', // step 5
];

test('lesson g — video will not play diagnostic (local)', async ({ page }) => {
  test.setTimeout(90000);
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const videoConsole = [];

  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error') {
      if (!['favicon','source map','Whisper','vite','401','Unauthorized','ERR_CACHE_WRITE_FAILURE'].some(n => t.includes(n))) {
        consoleErrors.push(t.slice(0, 400));
      }
    }
    if (/Preloader|SimpleVideo|InteractiveVideo|IntroVideo|setCurrentVideo|Phase|appStore|video/.test(t)) {
      videoConsole.push(t.slice(0, 300));
    }
  });
  page.on('pageerror', e => pageErrors.push(e.message.slice(0, 400)));
  page.on('requestfailed', r => failedRequests.push(`${r.method()} ${r.url()} → ${r.failure()?.errorText}`));

  await page.goto(LESSON_G, { waitUntil: 'domcontentloaded' });

  // bootstrap waits — lesson g needs configData + activeLessonId + currentVideo intro (async preloadLessonAssets + loadLessonContent)
  await page.waitForFunction(() => window.appStore?.getState()?.configData, null, { timeout: 20000 });
  await page.waitForFunction(() => window.appStore?.getState()?.activeLessonId === 'g', null, { timeout: 20000 });
  await page.waitForFunction(() => window.appStore?.getState()?.currentVideo?.type === 'intro', null, { timeout: 25000 });
  // preloader is gated on poster + LQIP; wait a bit for it to hide
  await page.waitForFunction(() => window.appStore?.getState()?.preloaderVisible === false, null, { timeout: 25000 }).catch(() => console.log('[diag] preloader still visible after 25s'));

  const boot = await page.evaluate(() => ({
    appPhase: window.appStore?.getState()?.appPhase,
    mediaState: window.appStore?.getState()?.mediaState,
    mediaVisible: window.appStore?.getState()?.mediaVisible,
    currentVideo: window.appStore?.getState()?.currentVideo,
    introPosterReady: window.appStore?.getState()?.introPosterReady,
    introVideoReady: window.appStore?.getState()?.introVideoReady,
    preloaderVisible: window.appStore?.getState()?.preloaderVisible,
    reactReady: window.appStore?.getState()?.reactReady,
    configLessonId: window.appStore?.getState()?.configData?.lessons?.[window.appStore?.getState()?.currentLessonIndex]?.lessonId,
    stepIndex: window.appStore?.getState()?.currentStepIndex,
  }));
  console.log('[diag] boot', JSON.stringify(boot, null, 2));
  expect(boot.configLessonId).toBe('g');
  expect(boot.currentVideo?.type).toBe('intro');

  // intro widget poster
  await page.waitForSelector('#intro-call-widget', { timeout: 15000 });
  const posterImg = page.locator('#intro-call-widget .intro-video-container img');
  // poster may be hidden behind LQIP initially; check existence not visibility
  const posterCount = await posterImg.count();
  if (posterCount > 0) {
    const src = await posterImg.getAttribute('src');
    console.log('[diag] poster src', src);
    expect(src).toMatch(/assets\/videos\/do_you_have_dark_chocolate\.jpg/);
    const bg = await page.locator('.intro-video-container').evaluate(el => getComputedStyle(el).backgroundImage);
    expect(bg).not.toBe('none');
  }

  // capture intro video element diagnostics
  const introVideo = page.locator('.intro-video');
  if (await introVideo.count() > 0) {
    await page.evaluate(() => {
      const v = document.querySelector('.intro-video');
      if (!v) return;
      window.__diagIntro = { events: [] };
      ['error','canplay','loadeddata','canplaythrough','stalled','waiting','emptied','play','pause'].forEach(ev => {
        v.addEventListener(ev, () => window.__diagIntro.events.push(ev + ':' + v.readyState + ':' + (v.error ? v.error.code : 'noerr')));
      });
    });
  }

  // wait for preloader to hide (introPosterReady gates it)
  // IncomingVideoWidget signals poster ready after image load or LQIP timeout
  await page.waitForFunction(() => window.appStore?.getState()?.preloaderVisible === false, null, { timeout: 20000 }).catch(() => console.log('[diag] preloader still visible'));
  await page.waitForFunction(() => window.appStore?.getState()?.introPosterReady === true, null, { timeout: 20000 }).catch(() => console.log('[diag] introPosterReady still false'));

  const afterPoster = await page.evaluate(() => ({
    preloaderVisible: window.appStore?.getState()?.preloaderVisible,
    introPosterReady: window.appStore?.getState()?.introPosterReady,
    introVideoReady: window.appStore?.getState()?.introVideoReady,
    mediaVisible: window.appStore?.getState()?.mediaVisible,
  }));
  console.log('[diag] afterPoster', JSON.stringify(afterPoster));

  const introDiag = await page.evaluate(() => {
    const v = document.querySelector('.intro-video');
    if (!v) return { found: false };
    return {
      found: true,
      src: v.src,
      crossOrigin: v.crossOrigin,
      readyState: v.readyState,
      networkState: v.networkState,
      paused: v.paused,
      muted: v.muted,
      error: v.error ? { code: v.error.code, message: v.error.message } : null,
      videoWidth: v.videoWidth,
      currentSrc: v.currentSrc,
    };
  });
  console.log('[diag] introVideo', JSON.stringify(introDiag, null, 2));
  if (introDiag.found) {
    expect(introDiag.error, `intro video error ${JSON.stringify(introDiag.error)} src=${introDiag.src}`).toBeNull();
    expect(introDiag.crossOrigin).toBe('anonymous');
  }

  const introEvents = await page.evaluate(() => window.__diagIntro?.events || []);
  console.log('[diag] intro events', introEvents);

  // advance to first playback video — IncomingVideoWidget is a div#intro-call-widget with onClick handler (no <button>)
  const widget = page.locator('#intro-call-widget');
  const widgetCount = await widget.count();
  console.log('[diag] widget count', widgetCount);
  if (widgetCount > 0) {
    // Click the widget (it calls getIntroContinueHandler() via appStore)
    await widget.click({ timeout: 5000 }).catch(e => console.log('[diag] widget click failed', e?.message));
    // Fallback: directly invoke the continue handler via store if click didn't transition
    await page.evaluate(() => {
      const { getIntroContinueHandler } = require ? null : null;
      // Try to trigger via appStore: the handler is wired via answer-pipeline; if click didn't work, transition manually
      const s = window.appStore?.getState();
      if (s?.appPhase === 'lessonIntro') {
        // Try to call the exposed handler directly
        try { const mod = window.getIntroContinueHandler; if (typeof mod === 'function') mod(); } catch {}
      }
    }).catch(() => {});
    // Also try direct store transition as last resort for diagnosis
    await page.waitForTimeout(1000);
    const phaseBefore = await page.evaluate(() => window.appStore?.getState()?.appPhase);
    console.log('[diag] phase after widget click', phaseBefore);
    if (phaseBefore === 'lessonIntro') {
      console.log('[diag] attempting manual transition to firstResponse');
      await page.evaluate(() => {
        const s = window.appStore?.getState();
        // load next step by calling the exposed pipeline if available
        if (s?.currentLessonIndex !== undefined) {
          // Force transition so we can see video elements for next steps
          s.transitionTo?.('firstResponse', {}, { fromStepLoad: true });
        }
      }).catch(() => {});
      await page.waitForTimeout(800);
    }
  }

  const afterClick = await page.evaluate(() => ({
    appPhase: window.appStore?.getState()?.appPhase,
    mediaState: window.appStore?.getState()?.mediaState,
    mediaVisible: window.appStore?.getState()?.mediaVisible,
    currentVideo: window.appStore?.getState()?.currentVideo,
    isTextMode: window.appStore?.getState()?.isTextMode,
    videoPlays: window.appStore?.getState()?.videoPlays,
  }));
  console.log('[diag] afterClick', JSON.stringify(afterClick, null, 2));

  // Now check for Simple/Interactive video element regardless
  const anyVideo = page.locator('video');
  const videoCount = await anyVideo.count();
  console.log('[diag] total video elements', videoCount);
  for (let i = 0; i < Math.min(videoCount, 3); i++) {
    const v = anyVideo.nth(i);
    const diag = await v.evaluate(el => ({
      src: el.src,
      currentSrc: el.currentSrc,
      crossOrigin: el.crossOrigin,
      readyState: el.readyState,
      networkState: el.networkState,
      paused: el.paused,
      muted: el.muted,
      error: el.error ? { code: el.error.code, message: el.error.message } : null,
      videoWidth: el.videoWidth,
      visible: el.offsetParent !== null,
    })).catch(e => ({ evalError: String(e) }));
    console.log(`[diag] video[${i}]`, JSON.stringify(diag, null, 2));
    if (diag.error) expect(diag.error, `video[${i}] error ${JSON.stringify(diag.error)} src=${diag.src}`).toBeNull();
  }

  // Check for failed network requests to videos
  const videoFailed = failedRequests.filter(u => /assets\/videos/.test(u));
  console.log('[diag] failedRequests (video)', videoFailed);
  expect(videoFailed, `video network failed: ${videoFailed.join('; ')}`).toEqual([]);

  // Final asserts: no page errors, no console block errors
  console.log('[diag] consoleErrors', consoleErrors.slice(0, 5));
  console.log('[diag] pageErrors', pageErrors);
  console.log('[diag] videoConsole tail', videoConsole.slice(-5));
  expect(pageErrors, `pageerror: ${pageErrors.join('; ')}`).toEqual([]);
  // Allow some console noise but not CORS/COEP block
  const blockErrors = consoleErrors.filter(t => /ERR_BLOCKED_BY_RESPONSE|Cross-Origin-Embedder-Policy|CORP|Failed to load resource.*video/.test(t));
  expect(blockErrors, `blocked: ${blockErrors.join('; ')}`).toEqual([]);
});
