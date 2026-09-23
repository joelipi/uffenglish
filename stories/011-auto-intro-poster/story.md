# Auto-generate intro-video posters on `npm run dev`

## Context

The lesson-intro poster (the still image shown behind/over the first frame of the
intro video) is keyed by `lessonId`: `getPosterUrl(lessonId)` resolves to
`/assets/posters/<lessonId>.jpg` in dev or
`https://r2.ultrafastfluency.com/assets/posters/<lessonId>.jpg` in production
(`src/modules/video/video-url.js:27-31`), and `IncomingVideoWidget.jsx:43-44`
pairs it with `getPosterLqip(lessonId)` from `src/generated/poster-lqips.js`
(`scripts/generate-thumbnails.mjs` writes both). The source of truth for a
poster is the slug in `lessons[].steps[0].introBackgroundVideoUrl`
(`src/config/model.json`; `scripts/generate-thumbnails.mjs:46-49`).

Posters exist and pass today (`node scripts/verify-thumbnails.mjs` → `verify OK:
10 intro lessons`), so the failure is ergonomic, not a missing file. The current
path is heavy and fragile for a new video:

- `scripts/generate-thumbnails.mjs` downloads **every** intro mp4 from R2 on
  **every** run — `generateOne()` calls `resolveSource()` *before* it checks
  whether the poster is up to date (`scripts/generate-thumbnails.mjs:88-103`), so
  a network hiccup on any one of the 10 videos fails that lesson and, after the
  `verify` step, blocks the deploy.
- LQIP is a second ffmpeg extraction from the video (32w), and the base64 module
  is only rebuilt for lessons whose video downloaded successfully
  (`scripts/generate-thumbnails.mjs:105-108,217`), so a download failure also
  drops that lesson's LQIP entry.
- Nothing poster-related (or caption-related) runs on `npm run dev`:
  `package.json` has no `predev` hook and `vite.config.js` has no poster plugin.
  A developer adding a lesson sees a gradient fallback until CI has run.

**Trigger reality check.** The auto-caption pipeline is *not* triggered by
`npm run dev`. New `simpleVideoUrl` slugs are detected and captioned by
`.github/workflows/captions.yml` on **push to any branch**
(`.github/scripts/captions-changed.sh` → `scripts/generate-captions.mjs` →
commit back). Posters already run on that same push event via
`.github/workflows/deploy.yml` (`generate-thumbnails` → `--upload` → `verify`).
So the cloud/push half of the user's ask is already satisfied; what is missing is
the local `npm run dev` trigger and a generator that does not re-download
everything.

## Out of Scope

- **Other course configs.** Only `src/config/model.json` is scanned, matching the
  existing pipeline. `t.json` (lessons `t`/`test`/`y`) and `friend.json`
  (lessons `a`/`b`) also have first-step `introBackgroundVideoUrl` steps but are
  not poster sources today; `gt2.json`'s 6 occurrences are non-first-step
  replays and need no poster. This is unchanged.
- **Cross-course `lessonId` collisions.** `getPosterUrl` is keyed by `lessonId`
  alone, so `model.json` `t`→`do_you_have_rolls_too` and `t.json`
  `t`→`gtests-1-0` share one `t.jpg`. Resolving that (courseId in the key/CSS)
  is a larger contract change and is not attempted here.
- **No R2 upload changes and no wrangler on dev.** `--upload`, the Cloudflare
  secrets, and `deploy.yml` are untouched. Dev only writes local files
  (`public/assets/posters/<lessonId>.jpg` + `src/generated/poster-lqips.js`).
- **No backfill and no re-render of existing posters.** Default generation is
  missing-only; existing committed posters are left byte-identical. `--force`
  exists to re-render deliberately.
- **No new npm packages, no headless-browser screenshot.** The frame grab stays
  ffmpeg, which the pipeline already requires.
- **No change to the runtime contract.** `getPosterUrl`, `getPosterLqip`,
  `POSTER_LQIPS`, and `IncomingVideoWidget` are untouched.
- **No change to `.github/workflows/*`.** The push pipeline already generates,
  uploads, and verifies posters; `deploy.yml` keeps working because the default
  missing-only mode still produces posters for any new lesson.

## Implementation approach

Keep the existing single generator (`scripts/generate-thumbnails.mjs`) and make
it do less, instead of adding another script. No new dependencies: ffmpeg is
already a system prerequisite (`README.md:45`, installed in `deploy.yml` and
`captions.yml`), and Node's global `fetch` (Node 20+) is already used.

**1. Shared pure helpers — new `scripts/lib/poster-utils.js`.** Mirrors
`scripts/lib/caption-utils.js` (the caption pipeline's testable core) so both
media pipelines share one shape. Exports:

```js
export const FRAME_AT_SECONDS = 0.2; // avoid the black frame at t=0
export const POSTER_WIDTH = 640;
export const LQIP_WIDTH = 32;

// Lesson needs an intro poster iff its FIRST step carries the slug.
export function introLessons(lessons) {
  return (lessons || []).filter(l => l?.steps?.[0]?.introBackgroundVideoUrl);
}
export function introSlug(lesson) { return lesson.steps[0].introBackgroundVideoUrl; }
export function posterFilename(lessonId) { return `${lessonId}.jpg`; }

// Pure run planner; fs/network stay in the CLI (injected predicate).
// targets  = intro lessons whose poster file is absent
// rebuild  = true when a poster was generated OR the LQIP module is
//            missing/does not contain every intro lessonId
export function planPosterRun({ lessons, posterExists, moduleText }) { … }

// Byte format of src/generated/poster-lqips.js (same header/indent/API as today).
export function formatLqipModule(lqipsByLessonId) { … }
```

`planPosterRun` rules, explicitly:

- `targets` preserves `lessons` order; each entry is `{ lessonId, slug }`.
- `posterExists(lessonId) === true` → not a target (no download, no ffmpeg).
- `moduleText == null` → `rebuild: true`.
- Some intro `lessonId` not found as `"<lessonId>"` or `'<lessonId>'` in
  `moduleText` → `rebuild: true`.
- `targets.length > 0` → `rebuild: true`.
- Otherwise `{ targets: [], rebuild: false }` (idempotent no-op).

**2. `scripts/generate-thumbnails.mjs` rework.** Flag semantics:

| flag | behavior |
| --- | --- |
| *(none)* | Missing-only: generate posters for `targets`; rebuild LQIP only when `planPosterRun().rebuild`. Exit non-zero **only** if ffmpeg is required but absent, so a broken env is visible. |
| `--dev` | Same as default but **always exits 0** (logs `WARN` on missing ffmpeg / per-lesson failure); its exit-0 guarantee wins even when combined with `--force`. This is what `predev` calls, so `npm run dev` is never blocked. |
| `--force` | Ignore existing posters; re-render every intro lesson (previous unconditional behavior). |
| `--upload` | Unchanged: `wrangler r2 object put` each poster (version-aware `--remote`). |
| `--check` | Unchanged: non-zero if any intro lesson lacks a poster or the LQIP module entry. |
| `--help` | Prints flags, exits 0. |

Generation per target (ffmpeg command lines unchanged from today):

- Source: `--video-dir=<dir>/<slug>.mp4` if present → `public/assets/videos/<slug>.mp4`
  if present → download `https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4`
  into `os.tmpdir()/uff-posters-cache/<slug>.mp4`.
- Poster: `ffmpeg -y -loglevel error -ss 0.2 -i <src> -vframes 1 -vf scale=640:-2 -q:v 4 <lessonId>.jpg`.

**3. LQIP is derived from the poster, not the video.** After generation, for
every intro lesson that has a poster file, run
`ffmpeg -y -loglevel error -i <poster.jpg> -vframes 1 -vf scale=32:-2 -q:v 15 <tmp.jpg>`,
base64 the result into `data:image/jpeg;base64,<b64>`, and write
`formatLqipModule(...)` to `src/generated/poster-lqips.js`. This removes the
second video download/extraction dependency and means LQIP can be rebuilt for
existing posters with no network. The LQIP module is only rewritten when
`rebuild` is true, so a no-op run leaves the committed file byte-identical.

**4. Trigger.** `package.json` gains
`"predev": "node scripts/generate-thumbnails.mjs --dev"`. With all committed
posters present and a complete LQIP module (the normal worktree state), `predev`
does zero downloads/ffmpeg and exits 0. When a developer adds a new lesson, the
one missing poster is generated before Vite starts, and the run rebuilds the
LQIP module so dev serves a real poster immediately. The push path is unchanged
and already covers production.

**5. Verification.** `scripts/verify-thumbnails.mjs` imports `introLessons` from
`scripts/lib/poster-utils.js` (drop its private copy) so generator, checker, and
runtime all agree on "which lessons need a poster". `verify-thumbnails.mjs`
remains the gate used by `playwright.yml` and `deploy.yml`; run it after adding a
lesson. Playwright `tests/poster-check.spec.js` already asserts the real poster
renders and the 404→LQIP/gradient fallback still holds.

## Tasks

### Task 1 - Pure poster utilities

- `introLessons` given a lesson with a first-step `introBackgroundVideoUrl`, a lesson whose first step is not an intro, a lesson with no `steps`, a lesson whose `steps[0]` lacks the field, and a lesson with the field only in `steps[2]`
  - → returns only the first lesson
- `introLessons([])` and `introLessons(undefined)`
  - → `[]`
- `introLessons` on `src/config/model.json` imported as JSON
  - → exactly `t,g,h,a,test,x,w,wa,wf,wfa`, and `introSlug` matches each
    `steps[0].introBackgroundVideoUrl`
- `posterFilename('t')` / `posterFilename('test')`
  - → `t.jpg` / `test.jpg`
- `planPosterRun` where `posterExists` is true for every lesson except `g`, plus a `moduleText` containing every lessonId
  - → `targets` equals `[{ lessonId: 'g', slug: 'do_you_have_dark_chocolate' }]`, in `model.json` order; `rebuild === true`
- `planPosterRun` where every poster exists and `moduleText` contains every intro lessonId
  - → `targets` is `[]`, `rebuild === false`
- `planPosterRun` where every poster exists and `moduleText` is `null`
  - → `targets` is `[]`, `rebuild === true`
- `planPosterRun` where every poster exists and `moduleText` omits one intro lessonId
  - → `rebuild === true`
- module constants
  - → `FRAME_AT_SECONDS === 0.2`, `POSTER_WIDTH === 640`, `LQIP_WIDTH === 32`
- `formatLqipModule({ t: 'data:image/jpeg;base64,AAA' })`
  - → contains `POSTER_LQIPS`, `getPosterLqip`, `"t"`, and the data URI, and the
    output is valid JS (matches today's header/indent/export API)
- `formatLqipModule({})`
  - → contains `POSTER_LQIPS = {}`-style empty map and still exports `getPosterLqip`

### Task 2 - Missing-only generator with poster-derived LQIP

- source of `scripts/generate-thumbnails.mjs`
  - → imports from `./lib/poster-utils.js` (`planPosterRun` and/or `introLessons`)
  - → contains the poster ffmpeg filter `scale=640`
- `node scripts/generate-thumbnails.mjs --help`
  - → exits 0 and prints `--force`, `--dev`, `--upload`, `--check`
- default run (`node scripts/generate-thumbnails.mjs`) in this repo, where every intro poster is committed
  - → exits 0
  - → `src/generated/poster-lqips.js` is byte-identical before and after
  - → no file in `public/assets/posters/` changes size/content
- `node scripts/generate-thumbnails.mjs --dev` in this repo
  - → exits 0
- `node scripts/generate-thumbnails.mjs --check` in this repo
  - → exits 0
- `--force` + no ffmpeg on PATH (spawn with a PATH lacking ffmpeg)
  - → exits non-zero with a message naming ffmpeg
- `--force --dev` + no ffmpeg on PATH
  - → exits 0 (the `--dev` override wins; dev start must not be blocked)

### Task 3 - `predev` wiring, shared verifier, docs

- `package.json` read
  - → `scripts.predev === 'node scripts/generate-thumbnails.mjs --dev'`
  - → existing `posters`, `posters:upload`, `posters:check`, `predeploy` entries are unchanged
- `scripts/verify-thumbnails.mjs` source read
  - → imports `introLessons` from `./lib/poster-utils.js`
  - → no private `function introLessons` definition remains
- `node scripts/verify-thumbnails.mjs` in this repo
  - → exits 0 and prints `verify OK: 10 intro lessons`
- `README.md` read
  - → documents that intro posters generate on `npm run dev` and that `--force` re-renders all
- `agents.md` read
  - → states that first-step intro posters are auto-generated on `npm run dev` and must not be hand-created
- `docs/product.md` read
  - → Features contains a bullet describing `npm run dev` intro-poster generation linking to `stories/011-auto-intro-poster/story.md`

## Technical Context

- **No new packages.** The feature adds zero `dependencies`/`devDependencies`;
  nothing is installed in this story.
- **ffmpeg 6.1.1** — already required by the poster and caption pipelines;
  installed in `deploy.yml` and `captions.yml` (`sudo apt-get install -y ffmpeg`)
  and confirmed on this machine (`ffmpeg version 6.1.1-3ubuntu5`).
- **Node 20+** — CI uses `actions/setup-node@v4` (`node-version: 20`); local is
  v22.23.2. Global `fetch` (used for the R2 download) is available (Node 18+).
- **vitest** — `vitest.config.js` has no `include`, so default `**/*.test.js` is
  picked up; `**/tests/**` and `**/*.spec.js` are excluded. New tests live in
  `scripts/`. `npm test -- --run` is the verification gate (eslint/knip are not
  runnable — `docs/learnings.md`).
- **Runtime contract (unchanged):** `src/modules/video/video-url.js` `getPosterUrl`;
  `src/generated/poster-lqips.js` `POSTER_LQIPS`/`getPosterLqip`; consumer
  `src/components/IncomingVideoWidget.jsx:6,43-44,268-299`.
- **Existing ffmpeg invocations to preserve:** poster
  `-ss 0.2 -vframes 1 -vf scale=640:-2 -q:v 4`; LQIP `scale=32:-2 -q:v 15`.
- **R2 base** `https://r2.ultrafastfluency.com/assets/videos/` — matches
  `src/modules/video/video-url.js:6`; hardcoding it in the CI/dev script is the
  existing precedent (`scripts/generate-thumbnails.mjs:31`).
- **CI gates already present:** `.github/workflows/deploy.yml` (generate →
  `--upload` → `verify`) and `.github/workflows/playwright.yml`
  (`node scripts/verify-thumbnails.mjs`).

## Notes

- **Trigger assumption (the one fork to confirm).** The user says translations
  are created "when we do `npm run dev`"; in fact they are created by
  `.github/workflows/captions.yml` on push. This story takes the user at their
  literal word and adds the missing **`predev`** trigger, while leaving the
  existing push pipeline (which already generates posters) in place. If the
  intent was instead to hook poster generation into the caption changed-files
  workflow (`.github/scripts/captions-changed.sh`), that is the alternative
  design and would replace Task 3's `predev` wiring — say so before implementing.
- **Scoped to `model.json`.** Matches the existing pipeline. `t.json`/`friend.json`
  intro lessons and `model.json`↔`t.json` `lessonId` collision stay as known
  limitations (see Out of Scope; also `docs/product.md` Known Limitations).
- **`predev` is non-fatal by design.** A missing ffmpeg or an unreachable R2
  cannot block `npm run dev`; it logs `WARN` and leaves the gradient fallback.
  `node scripts/verify-thumbnails.mjs` (and CI) is where a missing poster must
  fail loudly.
- **Frame time.** `FRAME_AT_SECONDS = 0.2` is retained (not `0`) because the
  first frame of these mp4s is frequently black, which would produce a black
  poster. The user's "first screen" maps to this constant.
- **`--force` needs the network** (it re-downloads sources) unless the mp4s are
  under `--video-dir` or `public/assets/videos/`. No ffmpeg/network is touched by
  the default no-op path.
- **Determinism.** With all posters committed, the default run must not rewrite
  `src/generated/poster-lqips.js`; the Task 2 byte-identity check is the guard.
  When the module *is* rebuilt, LQIP is re-derived from the same poster files, so
  repeated runs converge to identical bytes.
- **Manual end-to-end check** (implementer): add a throwaway lesson whose
  `steps[0].introBackgroundVideoUrl` points at an existing R2 slug, run
  `npm run dev`, confirm `public/assets/posters/<lessonId>.jpg` appears and
  `http://localhost:3000/course/model/lesson/<lessonId>` shows it (no broken
  icon), then revert the config change. Cross-check with
  `node scripts/verify-thumbnails.mjs`.
- **`docs/product.md`** is updated in this planning commit; the implementer adds
  the README/`agents.md` notes described in Task 3.
