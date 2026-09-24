# Uniform R2-only video posters (`<video>.jpg`) for teacher + UGC

## Context

Every video is addressed by a **slug**, and a poster is a still frame of that
video, so a poster must be the video's URL with `.mp4` → `.jpg`
(`getUgcThumbUrl`/`getUgcThumbKey`, `video-url.js:33-40`). This story makes all
posters follow that one rule.

**Media storage (verified).** Teacher videos are **never in the repo** — zero
`.mp4` files are tracked; they live only on R2 at `assets/videos/<slug>.mp4`.
`assets/videos/` is both the R2 key prefix and the dev URL path: in dev
`getVideoUrl` returns the relative `/assets/videos/<slug>.mp4` and Vite proxies
`/assets/videos/` to R2 (`vite.config.js:72-75`); in prod it returns
`https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4`. UGC media is R2-only
too, under `videos/<shareCode>-<courseId>-<lessonId>-response-NN.mp4`
(`video-url.js:13-25`, `video-source.js:10-16`).

Requirements for this story: posters are stored **only on R2**, are **not
committed**, and are **not served locally** — the browser always fetches a
poster from R2 (in dev through the existing proxy). There is no purpose to a
local poster: the app is useless without R2 media anyway.

### A. Teacher/lesson-intro posters (config-driven)

Today teacher posters violate all of the above:

- They are committed to the repo at `public/assets/posters/<lessonId>.jpg`
  (10 tracked files) and served locally in dev.
- They use a separate R2 prefix `assets/posters/<lessonId>.jpg` — **not** a
  sibling of `assets/videos/<slug>.mp4`, so the naming is inconsistent with UGC.
- Only `src/config/model.json` is scanned, but there is one config per course
  and `AppLayout.jsx` loads whichever the `/course/:courseId` route names
  (`fetch('/src/config/${courseId}.json')`). Intro videos in the other four
  configs can never get a poster.
- `lessonId` is not unique across configs: `t` → `do_you_have_rolls_too` in
  `model.json` but `gtests-1-0` in `t.json`; `a` → `gtests-1-0` in `model.json`
  but `testvideo01` in `friend.json`. A `lessonId`-keyed poster is wrong for one
  of every colliding pair.

The full first-step intro slug set across the `steps`-shaped configs is
`testvideo01`, `do_you_have_rolls_too`, `do_you_have_dark_chocolate`,
`gtests-1-0`, `gtests-0-1-1` (5 slugs). All 5 mp4s are live on R2
(`HEAD` → `200`).

**`questions`-shaped configs are vestigial and explicitly out of scope.**
`gt2.json` (139 lessons) stores its steps under `questions`, and the runtime
normalizes `questions` → `steps` (`config-normalizer.js:50-52`), so its first
`questions[0].introBackgroundVideoUrl` values would request posters
(`gtests-1-0`, `gtests-0-1-1`, `gtests-1-2`, `gtests-0-1intro`,
`worried-UnitIntro`). These intro entries are vestigial: the pipeline must **not**
normalize `questions` and must ignore them (the user confirmed they should be
deleted from `gt2.json` in a separate cleanup). Two of those slugs
(`gtests-0-1intro`, `worried-UnitIntro`) do not even have a source mp4 on R2
(`HEAD` → `404`), which is why they must not become generation targets.

### B. User-generated (UGC) friend posters — generated but never uploaded

The friend-challenge flow is already R2-only and mostly complete:

- `generateThumbFromBlob` (`thumbnail.web.js:17`) makes a JPEG thumb from the
  recorded webcam blob; `speech.web.js:223` passes it to `saveSpeechRecording`.
- `storage.web.js:59-84,173-183` persists (`thumbBlob`/`thumbArrayBuffer`) and
  restores it.
- `video-processor.web.js:1332-1352` (`exportSegmentsToR2`) intends to upload a
  **sibling** `videos/<...-response-NN>.jpg` via `getUgcThumbKey(key)`.
- `functions/api/upload-segment.js:25-27,88` already accepts `.jpg`/`.jpeg` under
  the `videos/${shareCode}-` namespace.

**The bug:** `VideoRenderPlanner.generatePlan()`
(`video-processor-logic.js:200-213`) builds the webcam step with
`blob: rec.blob` but **drops `rec.thumbBlob`**, so `step.thumbBlob` is always
`undefined`, the thumb-upload branch silently no-ops, and no UGC `.jpg` is ever
uploaded. Storage exposes the thumb as a Blob only: a record restored from
IndexedDB has its `thumbArrayBuffer` converted back to `thumbBlob` (and the
ArrayBuffer cleared) before the planner sees it (`storage.web.js:173-180`).

### Trigger

Removing local serving also removes the reason for a dev-time hook: with
posters fetched from R2, generating one locally shows nothing. The pipeline that
already creates teacher posters is `.github/workflows/deploy.yml`, which runs on
**every push** (the same event that triggers the caption workflow) and does
`generate-thumbnails` → `--upload` → `verify` → `build` → `pages deploy`. A new
intro video therefore gets a poster uploaded at push time with no new trigger —
this story only makes that pipeline config-agnostic and slug-keyed. UGC posters
are created at record/publish time on the client.

## Out of Scope

- **No local poster files.** `public/assets/posters/` is deleted and nothing is
  written into `public/`; there is no Vite proxy change (the existing
  `/assets/videos/` proxy already sends poster requests to R2).
- **No `predev` hook / no new trigger.** Teacher posters are produced by the
  existing push pipeline; a `predev` generate+upload would need Cloudflare
  credentials on every dev machine and would duplicate CI. (Flagged in Notes.)
- **No change to the caption pipeline** (`generate-captions.mjs`,
  `captions-changed.sh`, `captions.yml`).
- **No support for `questions`-shaped intros.** `gt2.json`'s first-step
  `questions` intros are vestigial and ignored (no `questions` → `steps`
  normalization); deleting them from `gt2.json` is a separate cleanup. See Notes.
- **No deletion of old R2 objects.** The orphaned `assets/posters/<lessonId>.jpg`
  objects are manual Cloudflare cleanup.
- **No rendering of posters inside `SimpleVideoPlayer` / `InteractiveVideoPlayer`.**
  Those players set `<video poster>` only after the first frame decodes, via a
  canvas snapshot (`SimpleVideoPlayer.web.jsx:117-130,347`). Using the uploaded
  `.jpg` as the initial player poster is a separate UI change.
- **No `courseId` in the poster key** — the slug disambiguates; `courseId` would
  reintroduce the config-filename-vs-`config.courseId` mismatch (`friend.json`
  has `"20260921"`, the route uses `friend`).
- **No new npm packages, no headless-browser screenshot.** Frame grabs stay
  ffmpeg (server) and canvas (`thumbnail.web.js`, client).

## Implementation approach

**1. New pure module `scripts/lib/poster-utils.js`** (mirrors
`scripts/lib/caption-utils.js`). Config-agnostic — takes parsed configs:

```js
export const FRAME_AT_SECONDS = 0.2; // avoid the black frame at t=0
export const POSTER_WIDTH = 640;     // 1.78x the 360px display width
export const POSTER_QUALITY = 8;     // ffmpeg -q:v (was 4); ~31% smaller, SSIM 0.993
export const POSTER_MAX_BYTES = 32768; // 32 KiB guard against regressions
export const LQIP_WIDTH = 32;

// Warn (never fail) when a generated JPEG blows the byte budget.
export function exceedsPosterBudget(bytes) { return bytes > POSTER_MAX_BYTES; }

// Every first-step intro slug across all `steps`-shaped configs, deduped,
// first-seen order. A lesson contributes iff steps[0].introBackgroundVideoUrl is
// truthy. Deliberately does NOT normalize `questions` -> `steps`: `questions`-
// shaped configs (gt2.json) hold vestigial intros and are out of scope.
export function introTargets(configs) { … }        // -> [{ slug }]

// <slug>.jpg — the sibling name shared by teacher and UGC posters.
export function posterFilename(slug) { return `${slug}.jpg`; }

// Remote objects key for R2 uploads.
export function posterR2Key(slug) { return `assets/videos/${slug}.jpg`; }

// Download path for the built-in ffmpeg frame grab.
export function posterSourceUrl(slug) {
  return `https://r2.ultrafastfluency.com/assets/videos/${slug}.mp4`;
}

// Pure run planner (existence check injected — the CLI supplies an R2 HEAD).
export function planPosterRun({ configs, posterExists, moduleText }) { … }

// Byte format of src/generated/poster-lqips.js, keyed by slug.
export function formatLqipModule(lqipsBySlug) { … }
```

`planPosterRun` rules: `targets` = `introTargets(configs)` whose
`posterExists(slug)` is false (discovery order preserved); `rebuild: true` when
`moduleText == null`, when some slug is not found as `"<slug>"`/`'<slug>'` in
`moduleText`, or when `targets.length > 0`; otherwise `{ targets: [], rebuild: false }`.

**2. One uniform poster rule (R2-only).** Poster URL for any slug =
`getVideoUrl(slug)` with `.mp4` → `.jpg`:

- Teacher: dev `/assets/videos/<slug>.jpg` (Vite proxies to R2), prod
  `https://r2.ultrafastfluency.com/assets/videos/<slug>.jpg`.
- UGC: `https://r2.ultrafastfluency.com/videos/<key>.jpg`.
- `getPosterUrl(slug)` returns `getUgcThumbUrl(getVideoUrl(slug))`; `null` for a
  falsy slug. The `POSTER_BASE` constant and the `public/assets/posters/`
  directory are removed. `getPosterLqip(slug)` stays slug-keyed.

**3. Runtime wiring (4 edits, no Vite change).**

- `video-url.js`: replace `getPosterUrl(lessonId)` with the uniform
  `getPosterUrl(slug)` above (reuses the already-imported `isFriendVideoSlug` via
  `getVideoUrl`). Delete `POSTER_BASE`.
- `video-loader.web.js:58-69`: add `posterSlug: step.introBackgroundVideoUrl` to
  the intro `currentVideo.config`.
- `IncomingVideoWidget.jsx`: use
  `const posterSlug = show ? currentVideo.config?.posterSlug : null;` for both
  `getPosterUrl` / `getPosterLqip` (replaces `activeLessonId`).
- `index.html:153-155`: preload calls
  `buildPosterUrlFn(lessonData?.steps?.[0]?.introBackgroundVideoUrl)` (the
  existing guard skips a null result).

No `vite.config.js` change: `/assets/videos/<slug>.jpg` is proxied to R2 by the
existing rule, which is exactly the desired "always fetch from R2" behavior.

**4. `scripts/generate-thumbnails.mjs` rework (no repo output).** Scans every
`src/config/*.json`, generates slug-keyed JPEGs into an OS temp work dir
(`os.tmpdir()/uff-posters/`, override via `POSTER_OUT_DIR` for tests), and
`--upload` pushes them to R2 as `assets/videos/<slug>.jpg`. Flags:

| flag | behavior |
| --- | --- |
| *(none)* | Missing-only: generate `targets` whose `posterExists` (R2 `HEAD`) is false; rebuild the LQIP module only when `planPosterRun().rebuild`. Non-zero only on a hard ffmpeg error. |
| `--force` | Ignore `posterExists`; re-render every intro slug. |
| `--upload` | `wrangler r2 object put uff/assets/videos/<slug>.jpg --file <workdir>/<slug>.jpg` (version-aware `--remote`). |
| `--help` | Prints flags, exits 0. |

Per target: source `--video-dir/<slug>.mp4` → `public/assets/videos/<slug>.mp4` →
download `https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4` into the work
dir; poster
`ffmpeg -y -loglevel error -ss 0.2 -i <src> -vframes 1 -vf scale=640:-2 -q:v 8 <workdir>/<slug>.jpg`
(i.e. `-q:v ${POSTER_QUALITY}`). After each encode, stat the file and `WARN` if
`exceedsPosterBudget(size)`. `--check` is dropped (R2 verification lives in
`verify-thumbnails.mjs`).

**5. LQIP module stays committed.** `src/generated/poster-lqips.js` is not a
poster file — it is a small JS module of base64 low-res placeholders imported by
`IncomingVideoWidget` for the pre-load background. It is regenerated from the
work-dir posters by the same run (only when `rebuild`), and is the one poster-
derived artifact that remains in git. (If zero poster data in the repo is
wanted, drop LQIP and rely on the gradient fallback — see Notes.)

**6. UGC poster: carry the thumb into the publish plan.** Add
`thumbBlob: rec.thumbBlob || null` to the webcam step in
`video-processor-logic.js:200-213`; `exportSegmentsToR2` then uploads the sibling
`.jpg` via the existing branch. Do **not** add a `thumbArrayBuffer` field:
storage rehydrates a restored thumb as `thumbBlob` (`storage.web.js:173-180`), so
the ArrayBuffer form never reaches the planner (carrying it would be dead code).
No other UGC code changes.

**7. Migration + verification.** `git rm -r public/assets/posters` (the 10
`lessonId` JPEGs); ensure no `.jpg` is tracked under `public/`. Update
`tests/poster-check.spec.js:11` to `/assets/videos/do_you_have_rolls_too.jpg`.
`scripts/verify-thumbnails.mjs` imports `introTargets`, scans all configs, and
checks **R2** (`HEAD https://r2.ultrafastfluency.com/assets/videos/<slug>.jpg`)
plus the committed LQIP module entries; it remains the gate in `deploy.yml` and
`playwright.yml`. `deploy.yml` is unchanged — its generate → upload → verify
steps already run this pipeline on every push.

## Tasks

### Task 1 - Config-agnostic pure utilities

- `introTargets` given configs containing a first-step `introBackgroundVideoUrl`, a first step that is not an intro, a lesson with no `steps`, a lesson whose `steps[0]` lacks the field, and a lesson whose only intro field is in `steps[2]`
  - → returns only the first-step intro slug
- two lessons (same or different configs) reuse one slug + `introTargets`
  - → returns that slug once (deduped)
- `introTargets([])` / `introTargets([{}])` / a config with no `lessons`
  - → `[]`
- `introTargets` over every parsed `src/config/*.json`
  - → slug set is exactly `testvideo01`, `do_you_have_rolls_too`, `do_you_have_dark_chocolate`, `gtests-1-0`, `gtests-0-1-1`
  - → `gtests-1-2`, `gtests-0-1intro`, and `worried-UnitIntro` are NOT returned (they live only under `gt2.json`'s `questions`)
- `introTargets` given a lesson whose only first-step intro is under `questions` (no `steps`)
  - → returns `[]` (no `questions` normalization; vestigial)
- `posterFilename('do_you_have_rolls_too')` / `posterR2Key('do_you_have_rolls_too')`
  - → `do_you_have_rolls_too.jpg` / `assets/videos/do_you_have_rolls_too.jpg`
- `posterSourceUrl('testvideo01')` → `https://r2.ultrafastfluency.com/assets/videos/testvideo01.mp4`
- `planPosterRun` where `posterExists` is false for one slug and true for the rest, with a `moduleText` containing every slug
  - → `targets` equals `[{ slug: <that slug> }]`; `rebuild === true`
- `planPosterRun` where every poster exists and `moduleText` contains every slug
  - → `targets` is `[]`, `rebuild === false`
- `planPosterRun` where every poster exists and `moduleText` is `null`
  - → `targets` is `[]`, `rebuild === true`
- `planPosterRun` where every poster exists and `moduleText` omits one slug
  - → `rebuild === true`
- module constants
  - → `FRAME_AT_SECONDS === 0.2`, `POSTER_WIDTH === 640`, `POSTER_QUALITY === 8`, `POSTER_MAX_BYTES === 32768`, `LQIP_WIDTH === 32`
- `exceedsPosterBudget(32768)` / `exceedsPosterBudget(32769)` / `exceedsPosterBudget(19653)`
  - → `false` / `true` / `false`
- `formatLqipModule({ do_you_have_rolls_too: 'data:image/jpeg;base64,AAA' })`
  - → contains `POSTER_LQIPS`, `getPosterLqip`, `"do_you_have_rolls_too"`, and the data URI; output is valid JS
- `formatLqipModule({})`
  - → empty `POSTER_LQIPS` map and still exports `getPosterLqip`

### Task 2 - Slug-keyed, all-config generator writing outside the repo

- source of `scripts/generate-thumbnails.mjs`
  - → imports `introTargets`/`planPosterRun` from `./lib/poster-utils.js`
  - → scans all `src/config/*.json` (no hardcoded `model.json`-only read)
  - → resolves its output directory under `os.tmpdir()` (honours `POSTER_OUT_DIR`) and never writes under the repo root or `public/`
  - → determines existing posters via an R2 `HEAD` (`https://r2.ultrafastfluency.com/assets/videos/<slug>.jpg`)
  - → contains the poster ffmpeg filter `scale=640` and encodes with `POSTER_QUALITY` (8)
  - → calls `exceedsPosterBudget` on each generated file size
- `node scripts/generate-thumbnails.mjs --help`
  - → exits 0 and prints `--force`, `--upload`
- `node scripts/generate-thumbnails.mjs --force` run against a scratch `POSTER_OUT_DIR`
  - → exits 0 and writes `<scratch>/<slug>.jpg` for each of the 5 teacher slugs
  - → writes nothing under the repo root or `public/`
- no committed poster images
  - → `public/assets/posters/` does not exist
  - → `git ls-files public` contains no `.jpg`/`.jpeg`/`.mp4`
- `src/generated/poster-lqips.js`
  - → every `POSTER_LQIPS` key is one of the 5 slugs (no `lessonId` keys)

### Task 3 - Uniform slug-keyed runtime contract (teacher + UGC, R2-only)

- `src/modules/video/video-url.js` via vitest
  - → `getPosterUrl('do_you_have_rolls_too')` matches `/assets\/videos\/do_you_have_rolls_too\.jpg$/`
  - → `getPosterUrl('ab12-model-w-response-01')` equals `https://r2.ultrafastfluency.com/videos/ab12-model-w-response-01.jpg`
  - → `getPosterUrl('')` and `getPosterUrl(undefined)` return `null`
  - → the module no longer exports or uses `POSTER_BASE`, and its source contains no `assets/posters` path
- `src/generated/poster-lqips.js` via vitest
  - → `getPosterLqip('do_you_have_rolls_too')` returns a `data:image/jpeg;base64,` string
  - → `getPosterLqip('t')` returns `null` (old `lessonId` keys are gone)
- `src/modules/video/video-loader.web.js` source
  - → the intro `currentVideo.config` includes `posterSlug: step.introBackgroundVideoUrl`
- `src/components/IncomingVideoWidget.jsx` source
  - → passes `currentVideo.config?.posterSlug` (not `activeLessonId`) to `getPosterUrl` / `getPosterLqip`
- `index.html` source
  - → the poster preload passes a slug from `steps` / `introBackgroundVideoUrl` to `buildPosterUrlFn`, not `lessonData.lessonId`
- `vite.config.js` source
  - → the `/assets/videos/` proxy is unchanged (no `.jpg` bypass) so posters continue to proxy to R2
- `tests/poster-check.spec.js` source
  - → the expected poster path is `/assets/videos/do_you_have_rolls_too.jpg`

### Task 4 - UGC poster upload (friend recordings)

- `VideoRenderPlanner.generatePlan()` with a recording carrying `thumbBlob`
  - → the `webcam` plan step includes `thumbBlob` equal to that recording's thumb
- a recording whose thumb was restored from IndexedDB (where `storage.web.js`
  rehydrates the `thumbArrayBuffer` into `thumbBlob`)
  - → the `webcam` plan step carries that `thumbBlob` and does not carry a
    `thumbArrayBuffer` field (the ArrayBuffer form never reaches the planner)
- a recording with no thumb + `generatePlan()`
  - → the `webcam` step's `thumbBlob` is `null` and no error is thrown
- `getUgcThumbKey('videos/ab12-model-w-response-01.mp4')` / `(undefined)`
  - → `videos/ab12-model-w-response-01.jpg` / `null`
- `getUgcThumbUrl('https://r2.ultrafastfluency.com/videos/ab12-model-w-response-01.mp4')`
  - → `https://r2.ultrafastfluency.com/videos/ab12-model-w-response-01.jpg`
- `src/modules/video/video-processor.web.js` source
  - → `exportSegmentsToR2` derives `getUgcThumbKey(key)` and uploads the sibling `.jpg` when a thumb is present
- `functions/api/upload-segment.js` source
  - → accepts `.jpg`/`.jpeg` keys under the `videos/${shareCode}-` namespace

### Task 5 - R2 verifier and docs

- `scripts/verify-thumbnails.mjs` source read
  - → imports `introTargets` from `./lib/poster-utils.js`
  - → checks `https://r2.ultrafastfluency.com/assets/videos/<slug>.jpg` for every intro slug
  - → no local `public/assets/posters` read remains
  - → honours a `POSTER_CDN_BASE` override (hermetic test seam)
- `scripts/verify-thumbnails.mjs` run against a fake R2 (`POSTER_CDN_BASE`) where all 5 slugs return 200 → exits 0 and reports 5 intro slugs
- the same run where one slug returns 404 → exits non-zero and names the missing slug
- against the **real** R2 the script is the deploy gate: it exits 0 only after `--upload` has published the 5 posters. This is an operational deploy step (requires Cloudflare credentials), not an in-repo acceptance criterion.
- `README.md` read
  - → documents uniform R2-only `<video>.jpg` posters (teacher pushed by `deploy.yml`, UGC uploaded at publish), and that no posters are committed or served locally
- `agents.md` read
  - → states posters are generated and uploaded to R2 on push for every course and are never committed locally
- `docs/product.md` read
  - → Features and Known Limitations describe uniform R2-only slug-sibling posters (`<video>.jpg`), linking to `stories/011-auto-intro-poster/story.md`

## Technical Context

- **No new packages.** Zero `dependencies`/`devDependencies` added.
- **ffmpeg 6.1.1** — already required by `deploy.yml`/`captions.yml`; confirmed
  locally. All 5 teacher intro slugs are live on R2 (`HEAD` → `200`).
- **Poster size/quality (measured).** The display is at most 360 CSS px wide
  (`.intro-video-container`: `width: min(90vw, 360px, 50cqi)`, `aspect-ratio: 3/4`,
  `app.css:1190-1198`) and sits under a `rgba(0,0,0,0.5)` overlay
  (`app.css:1200-1210`), so 640w is 1.78x coverage. Measured JPEG sizes:
  640w/`-q:v 4` = 7.5 KB (simple) to 28.6 KB (detailed); 640w/`-q:v 8` = 6.5–19.7 KB;
  480w/`-q:v 8` = 4.1–13.5 KB. 640w/`-q:v 8` scores SSIM 0.993 vs a `-q:v 2`
  reference, so it is the recommended setting. LQIP at 32w/`-q:v 15` is ~287 B
  (384 base64 chars).
- **R2-only serving needs no Vite change.** The existing `/assets/videos/` proxy
  (`vite.config.js:72-75`) already forwards `/assets/videos/<slug>.jpg` to R2 in
  dev; prod uses the absolute R2 URL.
- **Node 20+** (CI `setup-node@v4`, local v22.23.2); global `fetch` available
  (used for the R2 `HEAD` existence check).
- **vitest** — `vitest.config.js` has no `include`, so `**/*.test.js` runs;
  `**/tests/**` and `**/*.spec.js` excluded. Existing tests to extend:
  `src/modules/video/video-url.test.js`, `video-processor-logic.test.js`. Gate:
  `npm test -- --run` (eslint/knip not runnable — `docs/learnings.md`).
- **Poster contract call sites (updated here):** `video-url.js:27-40`;
  `video-loader.web.js:52-70`; `IncomingVideoWidget.jsx:5-6,43-44,268-299`;
  `index.html:153-155`.
- **UGC poster chain:** generation `thumbnail.web.js:17` + `speech.web.js:223`;
  persistence `storage.web.js:59-84,173-183`; plan
  `video-processor-logic.js:200-213`; upload `video-processor.web.js:1332-1352`;
  client `r2-upload.web.js:25-51`; Function
  `functions/api/upload-segment.js:25-27,88`; URL helpers `video-url.js:33-40`.
- **CI behaviour (unchanged files):** `.github/workflows/deploy.yml` runs on
  every push with generate → `--upload` → verify → build; upload is non-fatal.
  `.github/workflows/playwright.yml` also runs `verify-thumbnails.mjs`, which
  now checks R2, so a PR gate depends on R2 (media already does).

## Notes

- **`questions`-shaped intros are vestigial (confirmed by the user).** `gt2.json`
  stores steps under `questions`; the runtime normalizes `questions` → `steps`
  (`config-normalizer.js:50-52`), so loading a gt2 lesson would request posters
  for `gtests-1-2`, `gtests-0-1intro`, and `worried-UnitIntro`. The user confirmed
  these intro entries are vestigial and should be ignored (and deleted from
  `gt2.json` in a separate cleanup). `introTargets` therefore reads `steps[0]`
  from the raw config and does **not** normalize `questions`; the verifier only
  requires the 5 `steps`-shaped slugs. Two of the ignored slugs
  (`gtests-0-1intro`, `worried-UnitIntro`) have no source mp4 on R2 (`404`), so
  they could not be generated even if wanted. A gt2 lesson that still references
  one will fall back to the LQIP/gradient (poster 404), which is acceptable for
  vestigial data. Follow-up (out of scope): delete the vestigial
  `introBackgroundVideoUrl` fields from `gt2.json`.
- **No dev-time trigger (changed from earlier plan).** The original request tied
  poster creation to `npm run dev`, which assumed posters were served locally.
  With posters R2-only, a local generation shows nothing, and the push pipeline
  already uploads them on every push (the same event as captions). If a
  dev-time **generate + upload** is still wanted, it is a one-line `predev`
  (`node scripts/generate-thumbnails.mjs --upload`) — but it requires
  `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` on the dev machine and would
  duplicate CI. Confirm before adding.
- **LQIP module remains committed.** `src/generated/poster-lqips.js` holds tiny
  base64 placeholders (not poster files) and is imported by
  `IncomingVideoWidget`; the app falls back to a gradient if it is absent. If
  "no poster data in the repo" is meant to include this, drop LQIP and the
  `getPosterLqip` call — say so and the story will be adjusted.
- **UGC scope.** Generation, persistence, the Function, and the naming helper
  already exist; the only missing link is that `generatePlan()` drops the thumb,
  so nothing uploads. Task 4 fixes one field-passing bug plus tests.
- **Frame time.** `FRAME_AT_SECONDS = 0.2` retained (not `0`) because the first
  frame of these mp4s is frequently black; the UGC thumb already uses 0.2
  (`speech.web.js:223`).
- **Poster optimization.** `POSTER_QUALITY` moves from ffmpeg `-q:v 4` to `8`,
  cutting the detailed poster 28.6 KB → 19.7 KB and the simple one 7.5 KB → 6.5 KB
  at SSIM 0.993 (invisible under the 50% overlay). If more aggressive loading is
  wanted, dropping `POSTER_WIDTH` to 480 gives 4.1–13.5 KB at a slight softness on
  2x displays; 640 was chosen to keep 1.78x coverage. A 32 KiB `POSTER_MAX_BYTES`
  budget only logs a `WARN` (network/encode variance must not fail the build).
  The JPEG format is kept (not WebP/AVIF) so the uniform `.mp4`→`.jpg` rule holds.
- **R2 verification.** Because there are no local posters, `verify-thumbnails.mjs`
  now reports on R2 state; run it after `--upload`. `deploy.yml`'s upload step is
  non-fatal, so a credentials/R2 failure surfaces at the verify step.
- **The 5 teacher posters are not yet on R2.** As of this story the migration
  upload has not run (this environment has no Cloudflare credentials;
  `wrangler whoami` → not authenticated). Until `--upload` runs once, the live
  `node scripts/verify-thumbnails.mjs` exits non-zero (correct gate behaviour)
  and the app falls back to the LQIP/gradient for teacher intros. The automated
  acceptance contract is therefore the hermetic fake-R2 test
  (`POSTER_CDN_BASE`), not the live check; publishing is the one-time
  operational step below. The `.mp4` sources are all `200`, so only the `.jpg`
  uploads are pending.
- **Migration (implementer/operator):** `git rm -r public/assets/posters`; run
  `POSTER_OUT_DIR=/tmp/uff-posters node scripts/generate-thumbnails.mjs --force`
  then `--upload` (needs Cloudflare creds) once to publish
  `assets/videos/<slug>.jpg` for the 5 slugs; delete the old
  `assets/posters/<lessonId>.jpg` R2 objects in the dashboard.
- **Manual check:** load `http://localhost:3000/course/model/lesson/t` — the
  poster request (`/assets/videos/do_you_have_rolls_too.jpg`) is proxied to R2
  and renders with no broken icon; `/course/t/lesson/y` covers a slug that only
  existed after this change. Publish a friend lesson and confirm a sibling `.jpg`
  on R2 next to each `-response-NN.mp4`.
- **`docs/product.md`** is updated in this planning commit; the implementer adds
  the README/`agents.md` notes described in Task 5.
