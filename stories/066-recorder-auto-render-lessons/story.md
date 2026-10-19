# Recorder auto-renders finished lessons (lesson-level incremental render)

## Context

The operator records 108 takes in `public/recorder.html` and then presses one giant START RENDER that POSTs the full 108-filename list to `/api/pipeline/render` (`node_btn_render.onclick`, `public/recorder.html:1120`). That single job is all-or-nothing on one Modal container: a preemption vaporizes the whole attempt, nothing publishes until all 108 takes finish every stage, and the operator watches one status line for an hour.

This story adds a recorder-only incremental path: after every successful take upload (`node_btn_accept.onclick` success path, `public/recorder.html:1088-1094`), the page checks the uploaded take's lesson — when ALL filename-bearing rows of that `lesson_id` have been uploaded, it auto-POSTs just that lesson's filenames to the unchanged `/api/pipeline/render`. Each lesson is an independent Modal job (6 jobs for the current course: lessons `a`–`f` with 12/12/12/24/24/24 takes), so a preemption loses at most one lesson's container work, finished lessons publish while later ones are still being recorded, and raw takes stay safe in `raw/` regardless.

The rows already carry everything needed: every take row in `public/wouldyourather.master.csv` has a non-blank `filename` plus `lesson_id` (header row lowercased by the loader, so `entry_object.lesson_id`), and the recorder's `global_script_phrases` already excludes blank-`filename` rows — so iterating the in-memory list for completeness automatically satisfies "non-take rows never block".

## Out of Scope

- **No server-side change of any kind.** No edit to `functions/api/pipeline/*`, `docs/video-pipeline/*` (Modal app, pipeline stages, R2 layout), `.github/workflows/*` (sync-srt, translate, configs, one-click chain), or `scripts/*` (generator, translator, SRT merge). Task 4 pins each relied-on contract with a source guard; if any guard fails during implementation, stop and report — do not silently expand scope.
- **No step-level splitting.** 27 `video_file` steps would mean 27 containers; lesson-level (6) fits preemption intervals and matches the operator's mental model (record a lesson, it renders). See Notes.
- **No retry/backoff beyond the existing polling.** A failed lesson POST is logged and left unrendered; the next re-take into that lesson re-triggers it (Task 2). No queues, no exponential backoff, no cross-session resume of in-flight jobs.
- **No change to the manual escape hatch.** The existing START RENDER (full file list) handler stays byte-identical in behavior; all current `recorder-page.test.js` guards keep passing unmodified.
- **No refactor of the vendored page.** `public/recorder.html` stays vendored static JS in its existing style (`var`/top-level `function`, no modules/frameworks, inline handlers) per the file's own header comment.
- **No new dependency.** `jsdom ^29.1.1` (already in `package.json`) covers the behavior tests.

## Implementation approach

### 1. Lesson-completeness check on the upload success path (decision)

Hook the existing success path only: inside the `.then` of the `fetch('/api/pipeline/upload-raw')` in `node_btn_accept.onclick` (after the `"Upload complete: "` log, alongside the `advanceAfterAccept()` call), call a new top-level `function maybeAutoRenderLesson(uploadedFilename)`. It resolves the lesson key for that filename from `global_script_phrases` (`lessonKeyForTake`: `(course_id || '') + '\0' + (lesson_id || '')` — filenames are globally unique so the POST body is unambiguous regardless, but the key must be course-qualified because one CSV can define several courses, e.g. story 046), then checks every filename-bearing row with that key against the uploaded-takes set (Task 2). If all are present and the lesson is not already rendered, POST `{ files: <that lesson's filenames in `global_script_phrases` order> }` to `/api/pipeline/render` with the same `x-operator-key` header pattern, log the per-lesson jobId via `appCoreLog`, add the lesson to the rendered set, and hand the jobId to the multi-job poller (Task 3).

Explicit rules (no guessing at implementation time):

- Completeness iterates `global_script_phrases` filtered by lesson key — blank-`filename` rows are already absent from that list, so branching/reuse rows can never block a lesson.
- An empty filename list never POSTs (the server 400s on `[]` per `render.js:22`); log and skip.
- A take whose row has a blank `lesson_id` uploads normally but never triggers auto-render; log `NO LESSON ID — SKIPPING AUTO-RENDER` and continue. All 108 current takes carry `lesson_id` (`a`–`f`), so this is a forward-compat guard only.
- The checkbox gate (`dom-check-auto-render`, default ON) is read at trigger time; when unchecked, upload + advance behave exactly as today and the rendered/uploaded sets are untouched.
- The check runs only on upload *success*. The offline path (`catch` → `take kept for retry`) and the 401 path (`!response.ok` → take kept) never touch the uploaded set and never POST a render.
- If the auto-render POST itself fails (non-OK or throw), the take stays advanced (its upload succeeded) but the lesson is NOT added to the rendered set; log `LESSON RENDER FAILED` so a later re-take retries it.
- `global_script_phrases` is sorted by character then filename, not by lesson — the check must be key-membership over the whole list, never positional (no "last index of lesson" logic).

### 2. Dedupe: two sessionStorage sets, reload-safe, re-take re-triggers (decision)

Follow the existing `uff_operator_key` precedent (`getOperatorKey`/`saveOperatorKey`, `public/recorder.html:1021-1036`): two new keys holding JSON arrays, read once at boot into `var global_uploaded_takes = []` / `var global_rendered_lessons = []`, written back on every mutation.

- `uff_uploaded_takes`: appended on each upload success (upload path only — never on render, never on boot).
- `uff_rendered_lessons`: appended only after a render POST returns OK for that lesson (never optimistically before the POST, never on POST failure).
- Double-fire guard: the rendered-set membership test-and-add for a lesson happens synchronously in the same tick that decides to POST (before the `fetch` promise resolves), so two rapid success callbacks for the final take produce exactly one POST.
- Re-take rule: on upload success, delete that take's lesson key from the rendered set BEFORE the completeness check. A re-upload into a finished lesson therefore re-arms it, and since every other take of the lesson is still in the uploaded set, the check goes true on that single re-upload and re-POSTs exactly that lesson.
- Corrupt JSON in either key (hand-edited storage) is treated as empty; never throw on boot.

### 3. UI: one checkbox, logging, multi-job poller (decision)

- New checkbox `id="dom-check-auto-render"` beside the existing `dom-check-auto` row, label `auto-render finished lessons`, rendered `checked` by default. Same inline-style row pattern, no new CSS classes.
- `node_btn_render.onclick` is untouched (full-list manual POST stays the escape hatch).
- Per-lesson jobIds go to the existing debug log: `appCoreLog("LESSON <lesson_id> render job started: " + jobId)` (same `dom-debug-log` window the operator already watches).
- `pollRenderStatus(jobId)` becomes multi-job: keep one 5s `global_render_poll_timer`, but walk a `global_render_jobs` map (`jobId → { lesson, done }`). Each tick polls every unfinished job via the unchanged `/api/pipeline/status?id=` contract; a job reporting `done`/`error` is marked and no longer polled (timer clears only when all jobs are done). Factor the per-tick walk into a named top-level `function pollUnfinishedRenderJobs()` that the interval calls, so tests can invoke one tick directly instead of waiting out real 5s intervals (fake timers also acceptable). The `dom-render-status` line shows a per-lesson summary (e.g. `LESSON b: running / stage3; LESSON a: done`). A manual full render registers as one job under its jobId with lesson label `full`, preserving today's single-job behavior.

### 4. Zero server changes — each reliance pinned before use (decision)

Task 4 writes one source guard per claim below, each over raw file text in a slice scoped to the owning function (never whole-file `toContain` for repeated tokens, never comment-stripped source), each proven failable by mutating the pinned token. The implementation diff itself must touch only `public/recorder.html`, `src/modules/video/recorder-page.test.js`, `docs/product.md`, and the story — a guard asserts no other tracked path changed (enumerate `git diff --name-only` against an allowlist in the test; new untracked files fail loudly rather than passing vacuously).

## Tasks

### Task 1 - Lesson-completeness check + auto-render POST on upload success

- Fixture CSV (2 lessons × 2 takes each + 1 blank-`filename` branching row in lesson A) booted through the REAL page script (the `bootPage` jsdom pattern in `recorder-page.test.js:347-372`: stub `fetch` in `beforeParse`, wait for the `load` event exactly once) + all takes of lesson A uploaded except the last via real accept-clicks (fake `Blob` in `global_last_final_blob`, operator key set)
  - → zero `fetch` calls to `/api/pipeline/render`
  - → every take still POSTs its own slug to `/api/pipeline/upload-raw`
- Same fixture + final take of lesson A uploaded via a real accept-click
  - → exactly one POST to `/api/pipeline/render`
  - → its `files` body is exactly lesson A's take filenames as a set (blank-`filename` row absent; lesson B filenames absent)
  - → POST carries the `x-operator-key` header with the entered key
- Same fixture + take whose row has a blank `lesson_id` uploaded
  - → upload POST succeeds and the take advances
  - → no render POST; debug log contains `NO LESSON ID`
- Real page + upload `fetch` rejecting (offline) or resolving `!ok` (401)
  - → no render POST for any lesson
  - → take kept for retry (review mode stays up, `advanceAfterAccept` not run — existing behavior preserved)
- Real page + render POST resolving `!ok` or rejecting after a completed lesson
  - → take still advances (its upload succeeded)
  - → lesson absent from the `uff_rendered_lessons` set; debug log contains `LESSON RENDER FAILED`
- `node_btn_render.onclick` source inspected (raw text, slice from `node_btn_render.onclick` to `function pollRenderStatus`)
  - → still builds `files` from every `global_script_phrases` filename and POSTs the full list (manual escape hatch byte-identical in behavior; existing render/poll guards pass unmodified)

### Task 2 - Rendered-lessons dedupe in sessionStorage, reload-safe, re-take re-triggers

- Real page + lesson A auto-rendered + all takes of lesson B then uploaded to completion
  - → render POSTs total exactly two: one with lesson A files, one with lesson B files (A never re-POSTs)
- Real page + final take of a lesson completing twice via two rapid success callbacks (invoke the accept success path twice before the first render POST resolves)
  - → exactly one render POST for that lesson
- Fresh boot with `sessionStorage` pre-seeded (`beforeParse`: set `uff_rendered_lessons` to `[<lesson-A key>]`, `uff_uploaded_takes` to lesson A's filenames) + lesson B completed
  - → render POSTs only lesson B files (persisted rendered set is honored across reload)
- Fresh boot with corrupt (non-JSON) `uff_rendered_lessons` / `uff_uploaded_takes`
  - → page boots without throwing; both sets behave as empty
- Real page + lesson A rendered + one more take with lesson A's `lesson_id` uploaded (re-take)
  - → exactly one new render POST carrying exactly lesson A's filenames (re-trigger, same-lesson only)
- Real page with `dom-check-auto-render` unchecked + a full lesson uploaded to completion
  - → uploads succeed and takes advance; zero render POSTs; neither sessionStorage set gains the lesson

### Task 3 - Checkbox UI, per-lesson logging, multi-job poller

- Real page DOM after boot
  - → `#dom-check-auto-render` exists beside `#dom-check-auto`, is `checked` by default, and its label reads `auto-render finished lessons`
- Real page + lesson render POST returning `{ jobId }`
  - → debug log (`#dom-debug-log`) contains `LESSON <lesson_id> render job started: <jobId>`
- Real page + two lessons auto-rendered (two jobIds, status stub returns `running` for both, then `done` for the first)
  - → the 5s poller fetches `/api/pipeline/status?id=` for both unfinished jobs each tick
  - → after the first reports `done`, later ticks poll only the second (finished job is never re-polled)
  - → `#dom-render-status` names each lesson and its state (both `running` visible before either finishes)
- Real page + manual START RENDER click (full list, one jobId)
  - → poller polls that single job until `done`/`error` exactly as today (existing `starts a render and polls status until done/error` guard passes unmodified)
- `public/recorder.html` source inspected (raw text, slices scoped to the new checkbox markup, `maybeAutoRenderLesson`, and the poller)
  - → new code uses only `var`/`function` top-level declarations and the existing `appCoreLog`/`getOperatorKey` seams (no `import`/`require`, no framework); each pinned token fails on mutation

### Task 4 - Server-side zero-change verification guards

- `functions/api/pipeline/render.js` source inspected (raw text, slice of `onRequestPost`)
  - → `files` is accepted as any non-empty array of valid slugs with no whole-course cardinality check (pins `Array.isArray(files)`, the non-empty test, and `isValidPipelineSlug` with no length/set comparison); mutating the slice to require a full course breaks the guard
- `docs/video-pipeline/modal_app.py` source inspected (raw text, slice of `def orchestrator`)
  - → silence removal, background removal, `process_video_batch`, and `plan_publish` all receive `only=files`; removing any one `only=` breaks the guard
- `docs/video-pipeline/pipeline_lib.py` source inspected (raw text, slices of `def select_rows` and `def plan_publish`)
  - → `select_rows` scopes by filename membership in `only`; `plan_publish` dedups by slug first-wins (`seen` set); mutating either breaks the guard
- `scripts/write-srt-to-csv.mjs` source inspected (raw text, header-comment slice)
  - → pins the never-clear contract (`a group whose \`srt\` is blank is not cleared`); mutating it breaks the guard
- `scripts/lib/sheet-translate-utils.js` source inspected (raw text, module-comment slice)
  - → pins the blanks-only contract (`Translation ONLY fills blanks`); mutating it breaks the guard
- `scripts/generate-config-from-sheet.mjs` source inspected (raw text, slices of the header comment and the skip branch)
  - → pins best-effort whole-course skip (`SKIP course`, skipped whole, non-fatal); mutating it breaks the guard
- Implementation diff inspected (`git diff --name-only` against tracked files at test time)
  - → only `public/recorder.html`, `src/modules/video/recorder-page.test.js`, `docs/product.md`, and `stories/066-recorder-auto-render-lessons/story.md` changed; any change outside the allowlist (especially `functions/`, `docs/video-pipeline/`, `.github/`, `scripts/`) fails

### Task 5 - Product entry, local verification, push

- `docs/product.md` Features list
  - → contains the lesson-level auto-render bullet (Task wording in Technical Context) referencing this story; entry matches the surrounding `([story](stories/NNN-slug/story.md))` format
- Local verification with no CI dispatch
  - → `npx vitest run` green (full suite, including all new describes and every pre-existing recorder guard)
  - → `npm run lint` green
  - → no `gh workflow run`, no push to `main`/`staging`, no dispatched Action used as a test
- Story branch
  - → pushed to `origin` (`066-recorder-auto-render-lessons`); merging to `main` is separate and not done here

## Technical Context

- **Recorder (only production file touched):** `public/recorder.html` — `loadScriptDataFromSheets` (:889, rows carry lowercased `lesson_id`; blank-`filename` rows skipped; sorted by character then filename, NOT by lesson), `getOperatorKey`/`saveOperatorKey` (:1021-1036, `uff_operator_key` sessionStorage precedent), `advanceAfterAccept` (:1038), `node_btn_accept.onclick` (:1063, upload POST + success/failure paths), `node_btn_render.onclick` (:1120, full-list manual POST — untouched), `pollRenderStatus` (:1160, single-job 5s poller — extended to multi-job), `appCoreLog` (:594, debug-log seam), `global_render_poll_timer` (:561).
- **Server contracts relied on (read-only, pinned by Task 4 guards):** `functions/api/pipeline/render.js:22` (any non-empty valid-slug array accepted; `isValidPipelineSlug` from `src/modules/video/pipeline-keys.js`; all 108 current filenames already satisfy the slug pattern — verified); `docs/video-pipeline/modal_app.py:210-273` (`orchestrator` scopes every stage + `plan_publish` via `only=files`); `docs/video-pipeline/pipeline_lib.py:294-342` (`select_rows` membership filter, `plan_publish` first-wins slug dedup, concatenated outputs only); `scripts/write-srt-to-csv.mjs:8` (blank `srt` never cleared); `scripts/lib/sheet-translate-utils.js:8` (translation fills blanks only); `scripts/generate-config-from-sheet.mjs:11,85` (incomplete course skipped whole, non-fatal). Downstream chain (`pipeline.yml` srt → translate → configs) is per-CSV-file and idempotent across lesson jobs by the same three properties.
- **Current course shape (verified 2026-10-15):** 153 master rows → 108 takes; lessons `a:12, b:24, c:12, d:24, e:24, f:12`; 27 distinct `video_file` steps; zero non-blank `join` values. Lesson-level granularity = 6 jobs; step-level would be 27.
- **Test home:** extend the existing `src/modules/video/recorder-page.test.js` (its `bootPage`/`waitFor` jsdom harness boots the REAL page with stubbed `fetch`; the file self-excludes from its own hidden-page scan). Do NOT create a new `src/**` test mentioning the recorder page — per `AGENTS.md`, that trips the hidden-page guard. New behavior tests reuse `bootPage` with a small inline 2-lesson CSV fixture (plus blank-`filename` and blank-`lesson_id` rows); drive real accept-clicks with a fake `Blob` + operator key; assert render POST bodies, ordering independence, and sessionStorage state. Source-guard style per `AGENTS.md`: raw text, slices scoped to the owning function/handler, every guard proven failable by mutation before trust.
- **Product entry wording (Task 5):** `**Lesson-level auto-render in the recorder** — after each take upload the recorder checks that take's lesson and, when every filename-bearing row of the lesson is uploaded, auto-renders just that lesson as its own Modal job (re-takes re-trigger only their lesson; a manual full-course START RENDER remains as the escape hatch), so a preemption loses at most one lesson's container work instead of the whole 108-take session ([story](stories/066-recorder-auto-render-lessons/story.md)).`

## Notes

- **Why lesson-level, not step-level:** 6 lesson jobs vs 27 step jobs for the current course. One Modal container per lesson fits comfortably inside preemption intervals (a lesson is 12–24 takes through 3 stages), while 27 containers multiply dispatch/poll overhead 4× for no additional fault-isolation the operator asked for. It also matches the operator's mental model: finish recording a lesson → that lesson renders and publishes while the next lesson is recorded.
- **Why not full-course incremental (render-on-every-take):** re-rendering the whole course per take would redo finished work on every upload; lesson scoping renders each take's lesson exactly once (plus once per re-take).
- **Failure posture (shape of the design, not an AC):** per-lesson jobs are independent — preemption loses at most one lesson's container work; takes are safe in private `raw/` regardless; published lessons stay published (publish plan dedups by slug, SRT/translate/configs merge idempotently). A failed lesson POST is retried by the next re-take, not by machinery in this story.
- **Status-line real estate:** with up to 6 concurrent lesson jobs the single `dom-render-status` line carries a compact per-lesson summary; per-job detail lives in the debug log. No new panels, no layout change to the vendored page.
- **No manual operator steps.** Nothing to delete, rotate, or configure after merge — the checkbox defaults ON and the server needs nothing.
- **Scope-halt rule (process, not app behavior):** if any Task 4 guard fails against current `main` during implementation — i.e. a server-side claim in this story proves false — the implementer stops and reports which claim failed instead of expanding scope. A false claim is never silently worked around with server changes.
