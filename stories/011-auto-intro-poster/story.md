# Auto-generate intro/UGC video posters on `npm run dev` and at publish time

## Context

Every video shown in the app is addressed by a **slug**:
`getVideoUrl(slug)` resolves teacher media to `assets/videos/<slug>.mp4` and
friend/UGC media to `videos/<...-response-NN>.mp4` (`video-url.js:13-25`,
`video-source.js:10-16`). A poster is a still frame of that media, so posters
must share the same key.

### A. Teacher/lesson-intro posters (config-driven)

The lesson-intro poster is currently keyed by `lessonId`:
`getPosterUrl(lessonId)` → `/assets/posters/<lessonId>.jpg` in dev or
`https://r2.ultrafastfluency.com/assets/posters/<lessonId>.jpg` in production
(`video-url.js:27-31`), paired with `getPosterLqip(lessonId)`
(`IncomingVideoWidget.jsx:43-44`). The source is the slug in
`lessons[].steps[0].introBackgroundVideoUrl`. Two defects:

1. **One config file per course, but only `model.json` is scanned.** There are
   five configs in `src/config/` (`friend.json`, `gt2.json`, `model.json`,
   `t.json`, `test-api.json`); `AppLayout.jsx` loads whichever the
   `/course/:courseId` route names (`fetch('/src/config/${courseId}.json')`).
   The generator/verifier hardcode `src/config/model.json`, so intro videos in
   every other course can never get a poster.
2. **`lessonId` is not unique across configs.** Evidence: `t` →
   `do_you_have_rolls_too` in `model.json` but `gtests-1-0` in `t.json`; `a` →
   `gtests-1-0` in `model.json` but `testvideo01` in `friend.json`. A
   `lessonId`-keyed poster is therefore wrong for one of every colliding pair.

The full first-step intro slug set across all configs is `testvideo01`,
`do_you_have_rolls_too`, `do_you_have_dark_chocolate`, `gtests-1-0`,
`gtests-0-1-1` (5 slugs; `gt2.json`'s 6 `introBackgroundVideoUrl` occurrences are
non-first-step replays needing no poster). All 5 mp4s are live on R2
(`HEAD` → `200`). The current generator also re-downloads every mp4 on every run
(`generateOne()` resolves the source before checking freshness,
`generate-thumbnails.mjs:88-103`), and nothing poster-related runs on
`npm run dev` (`package.json` has no `predev`).

### B. User-generated (UGC) friend posters — generated but never uploaded

The friend-challenge flow already has all the poster machinery **except one
link in the chain**:

- Recorded webcam clips get a JPEG thumb + LQIP via
  `generateThumbFromBlob` (`thumbnail.web.js:17`), called in
  `speech.web.js:223` and passed to `saveSpeechRecording`.
- `storage.web.js:59-84,173-183` persists it (`thumbBlob` / `thumbArrayBuffer`
  in IndexedDB) and restores it.
- `video-processor.web.js:1332-1352` (`exportSegmentsToR2`) intends to upload a
  **sibling** `videos/<shareCode>-<courseId>-<lessonId>-response-NN.jpg`
  alongside the `.mp4`, via `getUgcThumbKey(key)`.
- `functions/api/upload-segment.js:25-27,88` already accepts `.jpg`/`.jpeg` keys
  under the `videos/${shareCode}-` namespace.
- `video-url.js:33-40` defines `getUgcThumbUrl` / `getUgcThumbKey` (`.mp4` →
  `.jpg`).

**The bug:** `VideoRenderPlanner.generatePlan()`
(`video-processor-logic.js:200-213`) builds the webcam plan step with
`blob: rec.blob` but **drops `rec.thumbBlob`/`rec.thumbArrayBuffer`**. So
`exportSegmentsToR2`'s `step.thumbBlob` is always `undefined`, the thumb-upload
branch is a silent no-op (`Promise.resolve({url:null})`), and no UGC `.jpg` is
ever uploaded. `getUgcThumbUrl` has zero callers, so nothing consumes a UGC
poster either. This is exactly the user's concern.

**Trigger reality check.** The auto-caption pipeline is *not* triggered by
`npm run dev`; new `simpleVideoUrl` slugs are captioned by
`.github/workflows/captions.yml` on push. Teacher posters already run on that
same push via `.github/workflows/deploy.yml`
(`generate-thumbnails` → `--upload` → `verify`). The cloud/push half is covered;
this story adds the local `npm run dev` trigger, a config-agnostic scan, and the
missing UGC thumb link.

## Out of Scope

- **No change to the caption pipeline.** `scripts/generate-captions.mjs`,
  `.github/scripts/captions-changed.sh`, and `captions.yml` are untouched.
- **No changes to `.github/workflows/*`.** `deploy.yml` keeps generating,
  uploading, and verifying.
- **No deletion of old R2 poster objects.** The old `assets/posters/<lessonId>.jpg`
  objects are orphaned after the key change; removing them is manual Cloudflare
  cleanup and not required for correctness.
- **No `courseId` in the poster key.** The slug already disambiguates courses;
  `courseId` would reintroduce the config-file-name-vs-`config.courseId` mismatch
  (`friend.json` has `courseId: "20260921"` while the route uses `friend`).
- **No new player rendering of UGC thumbs.** The players already build a canvas
  FOUC poster after `loadeddata` (`SimpleVideoPlayer.web.jsx:117-130`). Wiring
  the uploaded UGC thumb in as the player's initial `poster` is a UI change left
  for a follow-up; this story makes the thumb exist and resolve
  (`getUgcThumbUrl`), and `getPosterUrl` already returns it for UGC slugs.
- **No new npm packages, no headless-browser screenshot.** Frame grabs stay
  ffmpeg (server) and canvas (`thumbnail.web.js`, client).
- **No backfill beyond the current 5 teacher slugs.** Default generation is
  missing-only; `--force` re-renders.

## Implementation approach

**1. New pure module `scripts/lib/poster-utils.js`** (mirrors
`scripts/lib/caption-utils.js`). Config-agnostic — it takes parsed configs, not a
path:

```js
export const FRAME_AT_SECONDS = 0.2; // avoid the black frame at t=0
export const POSTER_WIDTH = 640;
export const LQIP_WIDTH = 32;

// Every first-step intro slug across all configs, deduped, first-seen order.
// A lesson contributes iff steps[0].introBackgroundVideoUrl is truthy.
export function introTargets(configs) { … }        // -> [{ slug }]

export function posterFilename(slug) { return `${slug}.jpg`; }

// Pure run planner (fs/network stay in the CLI via the injected predicate).
export function planPosterRun({ configs, posterExists, moduleText }) { … }

// Byte format of src/generated/poster-lqips.js, keyed by slug.
export function formatLqipModule(lqipsBySlug) { … }
```

`planPosterRun` rules:

- `targets` = `introTargets(configs)` whose `posterExists(slug)` is false,
  preserving discovery order.
- `moduleText == null` → `rebuild: true`.
- Some slug not found as `"<slug>"` or `'<slug>'` in `moduleText` → `rebuild: true`.
- `targets.length > 0` → `rebuild: true`.
- Otherwise `{ targets: [], rebuild: false }` (idempotent no-op).

**2. Teacher poster key becomes the slug.** Files
`public/assets/posters/<slug>.jpg`; R2 `assets/posters/<slug>.jpg`;
`getPosterUrl(slug)` / `getPosterLqip(slug)`;
`POSTER_LQIPS = { "<slug>": "data:image/jpeg;base64,…" }`. Same key videos use,
removing the `t`/`a` collisions.

**3. Teacher runtime wiring (4 edits).**

- `video-url.js`: `getPosterUrl(slug)`; for a friend/UGC slug
  (`isFriendVideoSlug`), return `getUgcThumbUrl(getVideoUrl(slug))` — the
  sibling `.jpg`; otherwise the `assets/posters/<slug>.jpg` base. `null` for a
  falsy slug.
- `video-loader.web.js:58-69`: add `posterSlug: step.introBackgroundVideoUrl`
  to the intro `currentVideo.config`.
- `IncomingVideoWidget.jsx`: use
  `const posterSlug = show ? currentVideo.config?.posterSlug : null;` for both
  `getPosterUrl` / `getPosterLqip` (replaces `activeLessonId`).
- `index.html:153-155`: preload calls
  `buildPosterUrlFn(lessonData?.steps?.[0]?.introBackgroundVideoUrl)` (the
  existing guard skips a null result).

**4. `scripts/generate-thumbnails.mjs` rework.** Loads every
`src/config/*.json` and generates slug-keyed teacher posters. Flags:

| flag | behavior |
| --- | --- |
| *(none)* | Missing-only: generate `targets`; rebuild the LQIP module only when `planPosterRun().rebuild`. Exit non-zero **only** if ffmpeg is required but absent. |
| `--dev` | Same as default but **always exits 0** (logs `WARN`); its exit-0 guarantee wins even combined with `--force`. Called by `predev`. |
| `--force` | Ignore existing posters; re-render every intro slug. |
| `--upload` | `wrangler r2 object put` each poster as `uff/assets/posters/<slug>.jpg` (version-aware `--remote`). |
| `--check` | Non-zero if any intro slug lacks a poster or LQIP entry. |
| `--help` | Prints flags, exits 0. |

Per target: source `--video-dir/<slug>.mp4` → `public/assets/videos/<slug>.mp4` →
download `https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4` into
`os.tmpdir()/uff-posters-cache/`; poster
`ffmpeg -y -loglevel error -ss 0.2 -i <src> -vframes 1 -vf scale=640:-2 -q:v 4 <slug>.jpg`.

**5. LQIP is derived from the poster, not the video.** For every intro slug with
a poster file, run `ffmpeg -i <slug>.jpg -vframes 1 -vf scale=32:-2 -q:v 15 <tmp>`,
base64 it, and write `formatLqipModule(...)` to
`src/generated/poster-lqips.js`. Removes the second video extraction; module is
rewritten only when `rebuild` is true (no-op runs stay byte-identical).

**6. UGC poster: carry the thumb into the publish plan.** Add
`thumbBlob: rec.thumbBlob || null` and
`thumbArrayBuffer: rec.thumbArrayBuffer || null` to the webcam step in
`video-processor-logic.js:200-213`. `exportSegmentsToR2` then uploads the sibling
`.jpg` via the existing `getUgcThumbKey` branch (non-fatal, already coded). This
is the only production-code fix needed for UGC; generation
(`speech.web.js`/`thumbnail.web.js`), persistence (`storage.web.js`), the
Function (`upload-segment.js`), and the URL helpers already exist. The key is
the video key with `.mp4` → `.jpg`, so UGC posters are "named the same way" as
their video.

**7. Migration + trigger + verification.**
`node scripts/generate-thumbnails.mjs --force` produces the 5
`public/assets/posters/<slug>.jpg`; delete the old `lessonId` files
(`a.jpg g.jpg h.jpg t.jpg test.jpg w.jpg wa.jpg wf.jpg wfa.jpg x.jpg`);
regenerate `poster-lqips.js`; update `tests/poster-check.spec.js:11` to
`/assets/posters/do_you_have_rolls_too.jpg`. `package.json` gains
`"predev": "node scripts/generate-thumbnails.mjs --dev"`. `verify-thumbnails.mjs`
imports `introTargets`, scans all configs, and checks each slug's poster + LQIP
entry (and R2 with `--remote`); it remains the gate in `playwright.yml` and
`deploy.yml`.

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
- `posterFilename('do_you_have_rolls_too')` / `posterFilename('testvideo01')`
  - → `do_you_have_rolls_too.jpg` / `testvideo01.jpg`
- `planPosterRun` where `posterExists` is false for one slug and true for the rest, with a `moduleText` containing every slug
  - → `targets` equals `[{ slug: <that slug> }]`; `rebuild === true`
- `planPosterRun` where every poster exists and `moduleText` contains every slug
  - → `targets` is `[]`, `rebuild === false`
- `planPosterRun` where every poster exists and `moduleText` is `null`
  - → `targets` is `[]`, `rebuild === true`
- `planPosterRun` where every poster exists and `moduleText` omits one slug
  - → `rebuild === true`
- module constants
  - → `FRAME_AT_SECONDS === 0.2`, `POSTER_WIDTH === 640`, `LQIP_WIDTH === 32`
- `formatLqipModule({ do_you_have_rolls_too: 'data:image/jpeg;base64,AAA' })`
  - → contains `POSTER_LQIPS`, `getPosterLqip`, `"do_you_have_rolls_too"`, and the data URI; output is valid JS
- `formatLqipModule({})`
  - → empty `POSTER_LQIPS` map and still exports `getPosterLqip`

### Task 2 - Slug-keyed, all-config teacher generator + committed artifacts

- source of `scripts/generate-thumbnails.mjs`
  - → imports `introTargets`/`planPosterRun` from `./lib/poster-utils.js`
  - → scans all `src/config/*.json` (no hardcoded `model.json`-only read)
  - → contains the poster ffmpeg filter `scale=640`
- `node scripts/generate-thumbnails.mjs --help`
  - → exits 0 and prints `--force`, `--dev`, `--upload`, `--check`
- default run (`node scripts/generate-thumbnails.mjs`) in this repo after migration
  - → exits 0
  - → `src/generated/poster-lqips.js` is byte-identical before and after
  - → no poster file changes size/content
- `node scripts/generate-thumbnails.mjs --dev` in this repo → exits 0
- `node scripts/generate-thumbnails.mjs --check` in this repo → exits 0
- `--force` + no ffmpeg on PATH (spawn with a PATH lacking ffmpeg)
  - → exits non-zero with a message naming ffmpeg
- `--force --dev` + no ffmpeg on PATH → exits 0 (`--dev` override wins)
- committed `public/assets/posters/` after this change
  - → contains `testvideo01.jpg`, `do_you_have_rolls_too.jpg`, `do_you_have_dark_chocolate.jpg`, `gtests-1-0.jpg`, `gtests-0-1-1.jpg`
  - → contains none of `a.jpg`, `g.jpg`, `h.jpg`, `t.jpg`, `test.jpg`, `w.jpg`, `wa.jpg`, `wf.jpg`, `wfa.jpg`, `x.jpg`
- `src/generated/poster-lqips.js` after this change
  - → every `POSTER_LQIPS` key is one of the 5 slugs (no `lessonId` keys)

### Task 3 - Slug-keyed runtime contract (teacher + UGC-aware)

- `src/modules/video/video-url.js` via vitest
  - → `getPosterUrl('do_you_have_rolls_too')` matches `/assets\/posters\/do_you_have_rolls_too\.jpg$/`
  - → `getPosterUrl('ab12-model-w-response-01')` equals `https://r2.ultrafastfluency.com/videos/ab12-model-w-response-01.jpg` (UGC sibling)
  - → `getPosterUrl('')` and `getPosterUrl(undefined)` return `null`
- `src/generated/poster-lqips.js` via vitest
  - → `getPosterLqip('do_you_have_rolls_too')` returns a `data:image/jpeg;base64,` string
  - → `getPosterLqip('t')` returns `null` (old `lessonId` keys are gone)
- `src/modules/video/video-loader.web.js` source
  - → the intro `currentVideo.config` includes `posterSlug: step.introBackgroundVideoUrl`
- `src/components/IncomingVideoWidget.jsx` source
  - → passes `currentVideo.config?.posterSlug` (not `activeLessonId`) to `getPosterUrl` / `getPosterLqip`
- `index.html` source
  - → the poster preload passes a slug from `steps` / `introBackgroundVideoUrl` to `buildPosterUrlFn`, not `lessonData.lessonId`
- `tests/poster-check.spec.js` source
  - → the expected poster path is `/assets/posters/do_you_have_rolls_too.jpg`

### Task 4 - UGC poster upload (friend recordings)

- `VideoRenderPlanner.generatePlan()` with a recording carrying `thumbBlob`
  - → the `webcam` plan step includes `thumbBlob` equal to that recording's thumb
- a recording carrying `thumbArrayBuffer` (IndexedDB-restored) + `generatePlan()`
  - → the `webcam` plan step includes that `thumbArrayBuffer`
- a recording with no thumb + `generatePlan()`
  - → the `webcam` step's `thumbBlob`/`thumbArrayBuffer` are null and no error is thrown
- `getUgcThumbKey('videos/ab12-model-w-response-01.mp4')` / `(undefined)`
  - → `videos/ab12-model-w-response-01.jpg` / `null`
- `getUgcThumbUrl('https://r2.ultrafastfluency.com/videos/ab12-model-w-response-01.mp4')`
  - → `https://r2.ultrafastfluency.com/videos/ab12-model-w-response-01.jpg`
- `src/modules/video/video-processor.web.js` source
  - → `exportSegmentsToR2` derives `getUgcThumbKey(key)` and uploads the sibling `.jpg` when a thumb is present
- `functions/api/upload-segment.js` source
  - → accepts `.jpg`/`.jpeg` keys under the `videos/${shareCode}-` namespace

### Task 5 - `predev` wiring, shared verifier, docs

- `package.json` read
  - → `scripts.predev === 'node scripts/generate-thumbnails.mjs --dev'`
  - → existing `posters`, `posters:upload`, `posters:check`, `predeploy` entries are unchanged
- `scripts/verify-thumbnails.mjs` source read
  - → imports `introTargets` from `./lib/poster-utils.js`
  - → no private `introLessons` / `model.json`-only read remains
- `node scripts/verify-thumbnails.mjs` in this repo → exits 0 and reports 5 intro slugs
- `README.md` read
  - → documents `npm run dev` teacher-poster generation (all courses, slug-keyed), the UGC sibling `.jpg`, and `--force`
- `agents.md` read
  - → states first-step intro posters auto-generate on `npm run dev` for every course and must not be hand-created
- `docs/product.md` read
  - → Features contains a bullet describing `npm run dev` slug-keyed poster generation and UGC sibling posters, linking to `stories/011-auto-intro-poster/story.md`

## Technical Context

- **No new packages.** Zero `dependencies`/`devDependencies` added.
- **ffmpeg 6.1.1** — already required by the poster/caption pipelines (`deploy.yml`,
  `captions.yml`); confirmed locally.
- **All 5 teacher intro slugs verified live on R2** (`curl -I` → `200`), so a full
  `--force` re-render works locally without Cloudflare creds (downloads are public).
- **Node 20+** (CI `setup-node@v4`, local v22.23.2); global `fetch` available.
- **vitest** — `vitest.config.js` has no `include`, so `**/*.test.js` runs;
  `**/tests/**` and `**/*.spec.js` are excluded. Relevant existing tests:
  `src/modules/video/video-url.test.js` (getVideoUrl routing),
  `src/modules/video/video-processor-logic.test.js` (generatePlan). `npm test --
  --run` is the gate (eslint/knip not runnable — `docs/learnings.md`).
- **Poster contract call sites (all updated here):**
  `video-url.js:27-40`; `video-loader.web.js:52-70`;
  `IncomingVideoWidget.jsx:5-6,43-44,268-299`; `index.html:153-155`.
- **UGC poster chain:** generation `thumbnail.web.js:17` +
  `speech.web.js:223`; persistence `storage.web.js:59-84,173-183`; plan
  `video-processor-logic.js:200-213`; upload `video-processor.web.js:1332-1352`;
  client `r2-upload.web.js:25-51`; Function `functions/api/upload-segment.js:25-27,88`;
  URL helpers `video-url.js:33-40`.
- **CI gates already present:** `.github/workflows/deploy.yml` (generate →
  `--upload` → `verify`) and `.github/workflows/playwright.yml`
  (`node scripts/verify-thumbnails.mjs`).

## Notes

- **Trigger assumption (confirm before implementing).** The user says
  translations are created "when we do `npm run dev`"; in fact they are created
  by `.github/workflows/captions.yml` on push. This story takes the user at their
  literal word and adds the missing **`predev`** trigger, leaving the existing
  push pipeline (which already generates posters) in place. The alternative —
  hooking posters into `.github/scripts/captions-changed.sh` — would replace
  Task 5's `predev` wiring; say so before implementing.
- **UGC scope decision.** The user asked whether UGC videos can get a poster
  created and uploaded at the same time, "called the same way". Investigation
  showed generation, persistence, the R2 Function, and the naming helper all
  already exist — the only missing link is that `generatePlan()` drops the thumb,
  so nothing uploads. Task 4 therefore fixes one field-passing bug plus tests;
  it does not build a new pipeline. Rendering the UGC thumb inside the players is
  intentionally out of scope (they already have a canvas FOUC poster).
- **Why the key changed (not just the scan).** `lessonId` collides across configs
  with different slugs (`t`, `a`), so a `lessonId`-keyed poster is wrong for one
  of every colliding pair. Slug keying matches `getVideoUrl(slug)` and is
  collision-free; UGC posters use the same slug convention (`.mp4` → sibling
  `.jpg`).
- **Dedup is intended.** `testvideo01` (4 lessons), `do_you_have_dark_chocolate`
  (3), and `gtests-1-0` (2) share one poster each because they are the same
  media; UGC clips each get their own.
- **`predev` is non-fatal by design.** Missing ffmpeg or an unreachable R2 cannot
  block `npm run dev`; it logs `WARN` and leaves the gradient fallback.
  `verify-thumbnails.mjs` (and CI) is where a missing teacher poster fails loudly.
- **Frame time.** `FRAME_AT_SECONDS = 0.2` is retained (not `0`) because the
  first frame of these mp4s is frequently black; the user's "first screen" maps
  to this constant. The UGC thumb already uses the same 0.2s
  (`speech.web.js:223`).
- **UGC auth.** `upload-segment.js` verifies the Supabase JWT and that the key
  starts with `videos/${shareCode}-` before writing; the sibling `.jpg` rides the
  same namespace, so no Function change is needed.
- **One-time generation step (implementer):**
  `node scripts/generate-thumbnails.mjs --force`, then remove the old
  `lessonId`-named poster files. `--upload` (needs Cloudflare creds) is prod-only.
- **Manual end-to-end check:** load `http://localhost:3000/course/model/lesson/t`
  (poster renders, no broken icon) and `/course/t/lesson/y` (a slug that only
  existed after this change). Publish a friend lesson and confirm a sibling
  `.jpg` appears on R2 next to each `-response-NN.mp4`.
- **`docs/product.md`** is updated in this planning commit; the implementer adds
  the README/`agents.md` notes described in Task 5.
