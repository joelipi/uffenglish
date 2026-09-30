# Prioritize the first lesson video so Windows/Android don't stall behind bulk prefetch

## Context

Reported bug: on `/course/wouldrather/lesson/a` the first video takes so long to
load on Windows (worst) and Android (less) that it stalls. iOS is not affected.

Evidence gathered from the codebase and R2:

- Lesson `a`'s first two steps both use slug `testvideointro`: step 0
  `lessonIntro` (`introBackgroundVideoUrl`) and step 1 `viewAndContinue`
  (`simpleVideoUrl`) — `src/config/wouldrather.json:40-55`.
- R2 `https://r2.ultrafastfluency.com/assets/videos/testvideointro.mp4` is
  `39,327,996` bytes (37.5 MB), H.264 1080×1920, 38.14 s,
  `8,052,923` bps video + `192,674` bps audio ≈ 8.25 Mbps. Its `moov` atom is at
  the **end** of the file (the first atoms are `ftyp`, `free`, then a
  `39,285,362`-byte `mdat`), i.e. the mp4 is not `+faststart`.
- `window.preloadLessonAssets` (`index.html:143-148`) fires full-file `fetch()`es
  for **every** step's video, in parallel, at default priority, at lesson start.
  For lesson `a` that is roughly 57 MB (`testvideointro` + `testvideoa01..03` +
  `enda`) all competing at once.
- `IncomingVideoWidget` mounts the intro `<video>` with
  `preload={isIOS ? 'metadata' : 'auto'}` (`src/components/IncomingVideoWidget.jsx:300`).
  So Windows/Android fully buffer the 37.5 MB intro while the bulk fetches compete;
  iOS only reads metadata. That matches the reported platform split exactly.
- The video the learner perceives as "the first video" is the same slug played by
  `SimpleVideoPlayer` after the intro card is clicked. It uses `preload="metadata"`
  and waits up to 10 s for `canplay` after `video.load()`
  (`src/components/SimpleVideoPlayer.web.jsx:302-315`), so when the pipe is
  saturated it visibly stalls.

Root cause: the first video is starved of bandwidth by (a) the intro element's
full-file `preload="auto"` on desktop and (b) the default-priority parallel
prefetch of all lesson videos. This story removes both sources of contention and
prefetches the first video at high priority before anything else.

## Out of Scope

- Re-encoding or replacing the R2 asset. The 37.5 MB / non-faststart mp4 is the
  underlying content defect; the exact remediation command is recorded in Notes,
  but content changes are out-of-band ops (this repo has no video generator and
  never commits video).
- iOS behavior — already `preload="metadata"`; unchanged.
- UGC/friend clips (`{friendCode}…-response-NN`), the recap pipeline, the poster
  and caption pipelines, and the Preloader UI/UX.
- Cloudflare cache / Transform-Rule changes (`docs/cloudflare-video-cors.md`).
- No new npm dependencies.

## Implementation approach

Split planning (pure) from execution (I/O), following the repo's `*-logic.js`
convention. The prefetch loop moves out of the `index.html` inline script into a
testable module called from the web-only lesson-init hook, so the existing
`poster-runtime-wiring.test.js` poster guard on `index.html` is preserved.

### New module `src/modules/video/lesson-preload.js`

```js
// @web-only
// Pure planner for which lesson video to prefetch first, plus an executor that
// fetches the first video at high priority and defers the rest until idle at low
// priority so they never starve the first video. No DOM, no React.

export const PRELOAD_DEFER_TIMEOUT_MS = 5000;

// One slug per step, in the same precedence the loader uses
// (interactiveVideoUrl || simpleVideoUrl || introBackgroundVideoUrl).
// Falsy slugs are skipped; URLs are deduped in first-seen order.
export function planLessonPreload(lesson, buildVideoUrl) {
    const steps = Array.isArray(lesson?.steps) ? lesson.steps : [];
    const seen = new Set();
    const urls = [];
    for (const step of steps) {
        const slug = step?.interactiveVideoUrl || step?.simpleVideoUrl || step?.introBackgroundVideoUrl;
        if (!slug) continue;
        const url = buildVideoUrl(slug);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
    }
    return { immediate: urls.slice(0, 1), deferred: urls.slice(1) };
}

function defaultDeferSchedule(callback) {
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(callback, { timeout: PRELOAD_DEFER_TIMEOUT_MS });
    } else {
        setTimeout(callback, 0);
    }
}

export function preloadLessonVideos(plan, {
    fetchImpl = globalThis.fetch,
    schedule = defaultDeferSchedule,
} = {}) {
    const immediate = plan?.immediate ?? [];
    const deferred = plan?.deferred ?? [];
    for (const url of immediate) {
        fetchImpl(url, { priority: 'high' }).catch(() => {});
    }
    if (deferred.length) {
        schedule(() => {
            for (const url of deferred) {
                fetchImpl(url, { priority: 'low' }).catch(() => {});
            }
        });
    }
}
```

Rules and edge cases:

- `immediate` is the first distinct video URL across the lesson's steps (even if
  step 0 has no video); `deferred` is the rest, in first-seen order.
- `planLessonPreload` with a null lesson, no steps, no video slugs, or a
  `buildVideoUrl` that returns a falsy URL → `{ immediate: [], deferred: [] }`.
- `preloadLessonVideos` with an empty/all-empty plan → `fetchImpl` and `schedule`
  are never called.
- Deferred URLs are never fetched synchronously; the injected/custom `schedule`
  controls when. Immediate and deferred fetch rejections are swallowed so a
  failed prefetch can never reject.
- `priority` is a browser hint (honored by Chromium — Windows/Android; other
  engines ignore the unknown option). It only orders prefetches relative to each
  other; correctness does not depend on it.

### Wire the hook `src/hooks/use-initialize-lesson-webonly.js`

Import `planLessonPreload` and `preloadLessonVideos` from
`../modules/video/lesson-preload.js`, and — after the existing
`await window.preloadLessonAssets(lesson, getVideoUrl, getPosterUrl)` and before
`await loadLessonContent(lesson, { forceRestart })` — call:

```js
preloadLessonVideos(planLessonPreload(lesson, getVideoUrl));
```

### Remove the all-steps loop from `index.html`

Delete the `lessonData.steps.forEach(...)` video prefetch block
(`index.html:143-148`). Keep the poster prefetch, the UI-image preload and the
progress bar exactly as they are, so `poster-runtime-wiring.test.js` continues to
pass.

### Stop the intro element's full-file buffering `src/components/IncomingVideoWidget.jsx`

- Change the video element's `preload={isIOS ? 'metadata' : 'auto'}` to a literal
  `preload="metadata"`, and remove the now-unused `isIOS` const (`:9`).
- Add `onLoadedMetadata={signalReady}` to the element. With `metadata` preload the
  browser stops after the header, so `loadeddata`/`canplay` may never fire; without
  this the widget would only signal ready on the 10 s safety timeout and emit a
  `console.warn`, which `agents.md` §4 treats as a bug. The existing 1 s frame
  fallback inside `signalReady` covers the "no frame yet" case silently.
- Remove the Android-only `video.play()` "coax" block (`:215-223`). It exists to
  force a `preload="auto"` fetch that Chrome ignores; with an explicit
  `video.load()` and `preload="metadata"` it is unnecessary and would re-introduce
  a full pull on Android. The intro video sits behind the poster and its readiness
  is not user-visible (`introVideoReady` is written but never read), so this is safe.
- Keep `crossOrigin="anonymous"` and the no-CORS retry in `onError`.

## Tasks

### Task 1 - Pure preload planner (`planLessonPreload`)

New `src/modules/video/lesson-preload.js` and colocated
`src/modules/video/lesson-preload.test.js` (vitest, jsdom).

- lesson with steps `[{introBackgroundVideoUrl:'s1'},{simpleVideoUrl:'s1'},{simpleVideoUrl:'s2'}]` and `buildVideoUrl = (s) => '/v/' + s + '.mp4'`
  - → `immediate` is `['/v/s1.mp4']`
  - → `deferred` is `['/v/s2.mp4']`
- lesson whose first step has both `interactiveVideoUrl:'i'` and `simpleVideoUrl:'s'`
  - → `immediate` is `['/v/i.mp4']` (interactive wins, loader precedence)
- lesson whose step 0 has no video and step 1 has `simpleVideoUrl:'s1'`
  - → `immediate` is `['/v/s1.mp4']`
- lesson with duplicate slugs across steps
  - → the URL appears once, in first-seen order
- null lesson, `{lessons:[]}`, `{}`, `{steps:[]}`, all steps video-less, and a `buildVideoUrl` returning `''`
  - → `immediate` and `deferred` are both `[]`
- step with an empty-string `simpleVideoUrl` and no other video field
  - → skipped (not added to either list)

### Task 2 - Prefetch executor (`preloadLessonVideos`)

Tests in `src/modules/video/lesson-preload.test.js`, using injected `fetchImpl`
and `schedule` spies (never the network).

- plan `{immediate:['a'], deferred:['b','c']}`, action: call `preloadLessonVideos`
  - → `fetchImpl('a', {priority:'high'})` was called once
  - → `fetchImpl` was not called with `'b'`/`'c'` before `schedule`'s callback runs
  - → `schedule` was called once with a function
- action: run the callback passed to `schedule`
  - → `fetchImpl('b', {priority:'low'})` and `fetchImpl('c', {priority:'low'})` were called
- plan `{immediate:['a'], deferred:[]}` → `schedule` is not called
- plan `{immediate:[], deferred:[]}` → neither `fetchImpl` nor `schedule` is called
- `fetchImpl` returning `Promise.reject(new Error('x'))` for an immediate and for a deferred URL
  - → `preloadLessonVideos` does not throw and no unhandled rejection is produced
- default scheduler resolution: with `globalThis.requestIdleCallback` stubbed, calling `preloadLessonVideos` with the default `schedule` uses it with `{timeout: PRELOAD_DEFER_TIMEOUT_MS}`; with `requestIdleCallback` deleted, `setTimeout` is used

### Task 3 - Wire the hook and remove the inline bulk loop

New source-guard test `src/modules/video/lesson-preload-wiring.test.js`
(`readFileSync` on the two files, following `poster-runtime-wiring.test.js`).

- `src/hooks/use-initialize-lesson-webonly.js` source inspected
  - → imports `planLessonPreload` and `preloadLessonVideos` from `'../modules/video/lesson-preload.js'`
  - → contains `preloadLessonVideos(planLessonPreload(lesson, getVideoUrl))`
  - → that call appears after the `window.preloadLessonAssets(...)` await and before `await loadLessonContent(`
- `index.html` source inspected
  - → does not contain `lessonData.steps.forEach`
  - → does not contain `fetch(buildVideoUrlFn(slug))`
  - → still contains `buildPosterUrlFn(posterSlug)` and `lessonData?.steps?.[0]?.introBackgroundVideoUrl` (existing poster guard stays green)
  - → still contains the `#ui-progress-bar` progress interval
- `npm test -- --run` → `src/modules/video/poster-runtime-wiring.test.js` passes

### Task 4 - Intro element only preloads metadata

`src/components/IncomingVideoWidget.jsx`; tests in a new
`src/components/intro-preload.test.js` using the same `vi.mock` +
`createRoot`/`act` harness as `src/components/intro-caller-name.test.js`
(mock `../modules/answer/answer-pipeline.js`, `../modules/video/video-url.js`,
`../generated/poster-lqips.js`).

- widget rendered with `currentVideo.type === 'intro'` and a poster slug, action: inspect the rendered `<video>`
  - → `getAttribute('preload')` is `'metadata'`
  - → `crossOrigin` is `'anonymous'`
- source inspected
  - → does not contain `isIOS ? 'metadata' : 'auto'`
  - → does not contain `isIOS` at all
  - → contains `onLoadedMetadata={signalReady}`
  - → does not contain `video.play()` in the mount effect (the Android coax is gone)
- existing `src/components/intro-caller-name.test.js` still passes

## Technical Context

- No new dependencies. Existing toolchain only: vitest 4.1.6 + jsdom 29.1.1
  (colocated `*.test.js`, excludes `tests/**` and `*.spec.js`) and Playwright
  1.60.0 (`tests/**`). Gate: `npm test -- --run`.
- `useInitializeLesson` is `@web-only` (`src/hooks/use-initialize-lesson-webonly.js`)
  and already imports `getVideoUrl`/`getPosterUrl` from
  `src/modules/video/video-url.js`, so no new wiring surface is needed.
- `getVideoUrl` returns `/assets/videos/<slug>.mp4` in dev (proxied to R2 by
  `vite.config.js`) and `https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4`
  in prod; the planner is URL-agnostic (it calls `buildVideoUrl`).
- `introVideoReady` is written by the widget but never read (the Preloader gates on
  `introPosterReady`), and the poster `<img>` (zIndex 1) covers the intro `<video>`
  (zIndex 0), so the intro element's readiness has no user-visible effect today.
- `fetch(url, { priority })` is the Fetch Priority hint; passing it in browsers
  that do not support it is a no-op (unknown `RequestInit` keys are ignored).
- `requestIdleCallback` is unavailable in jsdom; the default scheduler falls back
  to `setTimeout`, and tests inject `schedule`/stub the global.

## Notes

- **Underlying content defect (recommended follow-up, not this story).** The R2
  source is 37.5 MB at 8.25 Mbps and not faststart. Even with the client
  contention fixed, a large bitrate still buffers on slow links. The out-of-band
  remediation for `assets/videos/testvideointro.mp4` is a remux/re-encode with a
  front-loaded `moov` atom, e.g.:

  ```bash
  # stream copy + faststart (fastest option, keeps quality)
  ffmpeg -y -i testvideointro.mp4 -c copy -movflags +faststart testvideointro.faststart.mp4
  # if the bitrate is still too high, re-encode to ~1.2 Mbps 720x1280
  ffmpeg -y -i testvideointro.mp4 -vf scale=720:1280 -c:v libx264 -profile:v main \
    -crf 26 -maxrate 1.2M -bufsize 2.4M -c:a aac -b:a 96k -movflags +faststart testvideointro.opt.mp4
  # verify moov precedes mdat, then upload back over the slug
  npx wrangler r2 object put uff/assets/videos/testvideointro.mp4 --file testvideointro.faststart.mp4 --content-type video/mp4
  ```

  Replacing the mp4 under the same slug refreshes its poster on the next push
  (`stories/025-regenerate-stale-posters`). `test.json` and `newtest.json` share
  the slug, so this benefits every lesson that uses it.
- The per-step just-in-time warm path in `answer-pipeline.js:1024-1031`
  (`preloadVideo(nextStepVideoUrl)`) is untouched and still runs on each answered
  step; the deferred bulk prefetch is only an additional head start.
- `priority` does not change what is downloaded, only the browser's scheduling
  order. It is most effective on Chromium (Windows/Android), the exact platforms
  in the report; Safari (iOS) already uses `preload="metadata"` and is unaffected.
- The change is config-agnostic: it applies to any lesson's first video, not just
  `wouldrather/a`.
