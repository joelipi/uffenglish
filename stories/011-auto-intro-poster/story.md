# Auto-generate intro-video posters for every course on `npm run dev`

## Context

The lesson-intro poster (the still image shown behind/over the first frame of an
intro video) is currently keyed by `lessonId`:
`getPosterUrl(lessonId)` resolves to `/assets/posters/<lessonId>.jpg` in dev or
`https://r2.ultrafastfluency.com/assets/posters/<lessonId>.jpg` in production
(`src/modules/video/video-url.js:27-31`), paired with
`getPosterLqip(lessonId)` from `src/generated/poster-lqips.js`
(`IncomingVideoWidget.jsx:43-44`). The poster's source is the slug in
`lessons[].steps[0].introBackgroundVideoUrl`.

Two problems make this unreliable:

1. **One config file per course, but only `model.json` is scanned.** There are
   five configs in `src/config/` (`friend.json`, `gt2.json`, `model.json`,
   `t.json`, `test-api.json`) and `AppLayout.jsx` loads whichever the
   `/course/:courseId` route names (`fetch('/src/config/${courseId}.json')`).
   `scripts/generate-thumbnails.mjs` and `scripts/verify-thumbnails.mjs` hardcode
   `src/config/model.json`, so intro videos in every other course can never get a
   poster.
2. **`lessonId` is not unique across configs, so it is the wrong poster key.**
   Evidence: `t` → `do_you_have_rolls_too` in `model.json` but `gtests-1-0` in
   `t.json`; `a` → `gtests-1-0` in `model.json` but `testvideo01` in
   `friend.json`. `getPosterUrl(lessonId)` cannot distinguish those, so course
   `t` lesson `t` would render `model` lesson `t`'s poster. Videos do not have
   this problem: `getVideoUrl(slug)` keys R2 by the slug
   (`assets/videos/<slug>.mp4`, `video-url.js:13-25`), and slugs are unique
   identifiers for the actual media. A poster is a frame of that media, so it
   must be keyed the same way.

The full set of first-step intro slugs across all configs is
`testvideo01`, `do_you_have_rolls_too`, `do_you_have_dark_chocolate`,
`gtests-1-0`, `gtests-0-1-1` (5 slugs; `testvideo01` and
`do_you_have_dark_chocolate` are each reused by multiple lessons, and
`gt2.json`'s 6 `introBackgroundVideoUrl` occurrences are non-first-step replays
that need no poster). All 5 mp4s are live on R2 (verified `HEAD` → `200`).

Additionally the current pipeline is heavy: `generateOne()` calls
`resolveSource()` *before* checking whether the poster is up to date
(`scripts/generate-thumbnails.mjs:88-103`), so every run re-downloads every
intro mp4; LQIP is a second extraction from the video; and nothing poster- or
caption-related runs on `npm run dev` (`package.json` has no `predev`).

**Trigger reality check.** The auto-caption pipeline is *not* triggered by
`npm run dev`. New `simpleVideoUrl` slugs are captioned by
`.github/workflows/captions.yml` on **push to any branch**
(`.github/scripts/captions-changed.sh` → `scripts/generate-captions.mjs`).
Posters already run on that same push via `.github/workflows/deploy.yml`
(`generate-thumbnails` → `--upload` → `verify`). The cloud/push half is covered;
what is missing is the local `npm run dev` trigger and a generator that scans
every config without re-downloading everything.

## Out of Scope

- **No change to the caption pipeline.** `scripts/generate-captions.mjs`,
  `.github/scripts/captions-changed.sh`, and `captions.yml` are untouched.
- **No changes to `.github/workflows/*`.** `deploy.yml` keeps generating,
  uploading, and verifying; the script's default mode changes but the workflow
  still drives it.
- **No deletion of old R2 poster objects.** After the key change, the old
  `assets/posters/<lessonId>.jpg` objects are orphaned on R2; removing them is a
  manual Cloudflare cleanup and is not required for correctness.
- **No `courseId` in the poster key.** The slug already disambiguates courses;
  adding `courseId` would reintroduce the config-file-name-vs-`config.courseId`
  mismatch (`friend.json` has `courseId: "20260921"` while the runtime route uses
  `friend`).
- **No backfill beyond the current 5 slugs and no `--force` re-render as part of
  the default path.** Default generation is missing-only; `--force` re-renders.
- **No new npm packages, no headless-browser screenshot.** The frame grab stays
  ffmpeg, already required by the pipeline.
- **No cross-course poster sharing semantics change** beyond dedup: lessons that
  reuse a slug (`testvideo01`) intentionally share one poster file.

## Implementation approach

**1. New pure module `scripts/lib/poster-utils.js`.** Mirrors
`scripts/lib/caption-utils.js` so both media pipelines share one shape. Config
agnostic — it takes parsed configs, not a path:

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

`planPosterRun` rules, explicitly:

- `targets` = `introTargets(configs)` whose `posterExists(slug)` is false,
  preserving discovery order.
- `moduleText == null` → `rebuild: true`.
- Some slug not found as `"<slug>"` or `'<slug>'` in `moduleText` → `rebuild: true`.
- `targets.length > 0` → `rebuild: true`.
- Otherwise `{ targets: [], rebuild: false }` (idempotent no-op).

**2. Poster key becomes the slug (contract change).**

- Files `public/assets/posters/<slug>.jpg`; R2 `assets/posters/<slug>.jpg`.
- `getPosterUrl(slug)` and `getPosterLqip(slug)`;
  `POSTER_LQIPS = { "<slug>": "data:image/jpeg;base64,…" }`.
- This is the same key videos use (`getVideoUrl(slug)`), and it removes the
  `t`/`a` collisions above.

**3. Runtime wiring (4 small edits).**

- `src/modules/video/video-url.js`: `getPosterUrl(slug)` (rename the parameter;
  body/`POSTER_BASE` unchanged). Returns `null` for a falsy slug.
- `src/modules/video/video-loader.web.js:58-69`: add
  `posterSlug: step.introBackgroundVideoUrl` to the intro `currentVideo.config`.
- `src/components/IncomingVideoWidget.jsx`: derive
  `const posterSlug = show ? currentVideo.config?.posterSlug : null;` and pass it
  to `getPosterUrl` / `getPosterLqip` (replaces `activeLessonId`).
- `index.html:153-155`: the preload calls
  `buildPosterUrlFn(lessonData?.steps?.[0]?.introBackgroundVideoUrl)` instead of
  `lessonData.lessonId` (only a first-step intro has a poster; `getPosterUrl`
  returns `null` otherwise, and the existing guard skips it).

**4. `scripts/generate-thumbnails.mjs` rework.** Loads every
`src/config/*.json` (a config with no first-step intro simply yields no targets)
and generates slug-keyed posters. Flag semantics:

| flag | behavior |
| --- | --- |
| *(none)* | Missing-only: generate posters for `targets`; rebuild the LQIP module only when `planPosterRun().rebuild`. Exit non-zero **only** if ffmpeg is required but absent. |
| `--dev` | Same as default but **always exits 0** (logs `WARN` on missing ffmpeg / per-slug failure); its exit-0 guarantee wins even combined with `--force`. This is what `predev` calls. |
| `--force` | Ignore existing posters; re-render every intro slug. |
| `--upload` | Unchanged mechanics: `wrangler r2 object put` each poster as `uff/assets/posters/<slug>.jpg` (version-aware `--remote`). |
| `--check` | Non-zero if any intro slug lacks a poster or LQIP entry. |
| `--help` | Prints flags, exits 0. |

Generation per target (ffmpeg unchanged):

- Source: `--video-dir=<dir>/<slug>.mp4` if present → `public/assets/videos/<slug>.mp4`
  if present → download `https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4`
  into `os.tmpdir()/uff-posters-cache/<slug>.mp4`.
- Poster: `ffmpeg -y -loglevel error -ss 0.2 -i <src> -vframes 1 -vf scale=640:-2 -q:v 4 <slug>.jpg`.

**5. LQIP is derived from the poster, not the video.** For every intro slug that
has a poster file, run
`ffmpeg -y -loglevel error -i <slug>.jpg -vframes 1 -vf scale=32:-2 -q:v 15 <tmp>`,
base64 it, and write `formatLqipModule(...)` to `src/generated/poster-lqips.js`.
This removes the second video extraction and lets LQIP be rebuilt with no
network; the module is only rewritten when `rebuild` is true, so a no-op run
leaves the committed file byte-identical.

**6. Migration of committed artifacts (part of this change).**

- Run the generator with `--force` to produce `public/assets/posters/<slug>.jpg`
  for the 5 slugs, and delete the old `lessonId`-named files
  (`a.jpg g.jpg h.jpg t.jpg test.jpg w.jpg wa.jpg wf.jpg wfa.jpg x.jpg`).
- Regenerate `src/generated/poster-lqips.js` (slug keys).
- Update `tests/poster-check.spec.js:11` to expect
  `/assets/posters/do_you_have_rolls_too.jpg` (lesson `t` in `model.json`).

**7. Trigger + verification.** `package.json` gains
`"predev": "node scripts/generate-thumbnails.mjs --dev"`. With all committed
posters present and a complete LQIP module, `predev` does zero downloads/ffmpeg
and exits 0; when a lesson is added to any config, its missing slug poster is
generated before Vite starts. `scripts/verify-thumbnails.mjs` imports
`introTargets` from `scripts/lib/poster-utils.js`, scans all configs, and checks
each slug's local poster + LQIP entry (and R2 with `--remote`). It remains the
gate in `playwright.yml` and `deploy.yml`.

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
  - → at least one slug is shared by lessons in different config files (dedup is exercised by real data)
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

### Task 2 - Slug-keyed, all-config generator + committed artifacts

- source of `scripts/generate-thumbnails.mjs`
  - → imports `introTargets`/`planPosterRun` from `./lib/poster-utils.js`
  - → reads all `src/config/*.json` (contains no hardcoded `model.json`-only scan)
  - → contains the poster ffmpeg filter `scale=640`
- `node scripts/generate-thumbnails.mjs --help`
  - → exits 0 and prints `--force`, `--dev`, `--upload`, `--check`
- default run (`node scripts/generate-thumbnails.mjs`) in this repo after migration
  - → exits 0
  - → `src/generated/poster-lqips.js` is byte-identical before and after
  - → no poster file changes size/content
- `node scripts/generate-thumbnails.mjs --dev` in this repo
  - → exits 0
- `node scripts/generate-thumbnails.mjs --check` in this repo
  - → exits 0
- `--force` + no ffmpeg on PATH (spawn with a PATH lacking ffmpeg)
  - → exits non-zero with a message naming ffmpeg
- `--force --dev` + no ffmpeg on PATH
  - → exits 0 (the `--dev` override wins)
- committed `public/assets/posters/` after this change
  - → contains `testvideo01.jpg`, `do_you_have_rolls_too.jpg`, `do_you_have_dark_chocolate.jpg`, `gtests-1-0.jpg`, `gtests-0-1-1.jpg`
  - → contains none of `a.jpg`, `g.jpg`, `h.jpg`, `t.jpg`, `test.jpg`, `w.jpg`, `wa.jpg`, `wf.jpg`, `wfa.jpg`, `x.jpg`
- `src/generated/poster-lqips.js` after this change
  - → every `POSTER_LQIPS` key is one of the 5 slugs (no `lessonId` keys)

### Task 3 - Slug-keyed runtime contract

- `src/modules/video/video-url.js` via vitest
  - → `getPosterUrl('do_you_have_rolls_too')` matches `/assets\/posters\/do_you_have_rolls_too\.jpg$/`
  - → `getPosterUrl('')` and `getPosterUrl(undefined)` return `null`
- `src/generated/poster-lqips.js` via vitest
  - → `getPosterLqip('do_you_have_rolls_too')` returns a `data:image/jpeg;base64,` string
  - → `getPosterLqip('t')` returns `null` (old `lessonId` keys are gone)
- `src/modules/video/video-loader.web.js` source
  - → the intro `currentVideo.config` includes `posterSlug: step.introBackgroundVideoUrl`
- `src/components/IncomingVideoWidget.jsx` source
  - → passes `currentVideo.config?.posterSlug` (not `activeLessonId`) to `getPosterUrl` / `getPosterLqip`
- `index.html` source
  - → the poster preload passes a slug derived from `steps` / `introBackgroundVideoUrl` to `buildPosterUrlFn`, not `lessonData.lessonId`
- `tests/poster-check.spec.js` source
  - → the expected poster path is `/assets/posters/do_you_have_rolls_too.jpg`

### Task 4 - `predev` wiring, shared verifier, docs

- `package.json` read
  - → `scripts.predev === 'node scripts/generate-thumbnails.mjs --dev'`
  - → existing `posters`, `posters:upload`, `posters:check`, `predeploy` entries are unchanged
- `scripts/verify-thumbnails.mjs` source read
  - → imports `introTargets` from `./lib/poster-utils.js`
  - → no private `function introLessons` / `model.json`-only read remains
- `node scripts/verify-thumbnails.mjs` in this repo
  - → exits 0 and reports 5 intro slugs
- `README.md` read
  - → documents that intro posters generate on `npm run dev` (all courses, slug-keyed) and that `--force` re-renders all
- `agents.md` read
  - → states that first-step intro posters are auto-generated on `npm run dev` for every course and must not be hand-created
- `docs/product.md` read
  - → Features contains a bullet describing `npm run dev` slug-keyed intro-poster generation linking to `stories/011-auto-intro-poster/story.md`

## Technical Context

- **No new packages.** The feature adds zero `dependencies`/`devDependencies`.
- **ffmpeg 6.1.1** — already required by the poster and caption pipelines;
  installed in `deploy.yml` and `captions.yml`; confirmed locally
  (`ffmpeg version 6.1.1-3ubuntu5`).
- **All 5 intro slugs verified live on R2** (`curl -I` →
  `https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4` = `200`), so a full
  `--force` re-render works locally.
- **Node 20+** (CI `setup-node@v4`, local v22.23.2); global `fetch` available.
- **vitest** — `vitest.config.js` has no `include`, so default `**/*.test.js` runs;
  `**/tests/**` and `**/*.spec.js` are excluded. New unit tests live in
  `scripts/`; `video-url` behaviour can be covered in `src/modules/video/`.
  `npm test -- --run` is the gate (eslint/knip not runnable — `docs/learnings.md`).
- **Runtime call sites of the poster contract (all updated here):**
  `src/modules/video/video-url.js:27-31`;
  `src/modules/video/video-loader.web.js:52-70`;
  `src/components/IncomingVideoWidget.jsx:5-6,43-44,268-299`;
  `index.html:153-155`.
- **Existing ffmpeg invocations to preserve:** poster
  `-ss 0.2 -vframes 1 -vf scale=640:-2 -q:v 4`; LQIP `scale=32:-2 -q:v 15`.
- **R2 video base** `https://r2.ultrafastfluency.com/assets/videos/` matches
  `video-url.js:6`; hardcoding it in the script is the existing precedent
  (`generate-thumbnails.mjs:31`).
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
  Task 4's `predev` wiring; say so before implementing.
- **Why the key changed (not just the scan).** Scanning all configs is not
  enough: `lessonId` collides across configs with *different* slugs (`t`:
  `do_you_have_rolls_too` vs `gtests-1-0`; `a`: `gtests-1-0` vs `testvideo01`),
  so a `lessonId`-keyed poster is wrong for one of every colliding pair. Keying
  by slug matches the existing video convention (`getVideoUrl(slug)`) and is
  collision-free. This is the one intentional runtime-contract change.
- **Dedup is intended.** `testvideo01` (4 lessons), `do_you_have_dark_chocolate`
  (3), and `gtests-1-0` (2) share one poster each because they are the same
  media. If per-lesson posters are ever wanted, that is a separate change.
- **`predev` is non-fatal by design.** Missing ffmpeg or an unreachable R2
  cannot block `npm run dev`; it logs `WARN` and leaves the gradient fallback.
  `node scripts/verify-thumbnails.mjs` (and CI) is where a missing poster must
  fail loudly.
- **Frame time.** `FRAME_AT_SECONDS = 0.2` is retained (not `0`) because the
  first frame of these mp4s is frequently black; the user's "first screen" maps
  to this constant.
- **Manual generation step (implementer, one-time):**
  `node scripts/generate-thumbnails.mjs --force` then remove the old
  `lessonId`-named poster files; this needs network + ffmpeg but no Cloudflare
  creds (video download is public). `--upload` (needs creds) is only for prod.
- **Manual end-to-end check** (implementer): load
  `http://localhost:3000/course/model/lesson/t` and confirm the poster renders
  (no broken icon); load a course whose poster existed only after this change
  (`/course/t/lesson/y`) to confirm config-agnostic coverage. Cross-check with
  `node scripts/verify-thumbnails.mjs`.
- **`docs/product.md`** is updated in this planning commit; the implementer adds
  the README/`agents.md` notes described in Task 4.
