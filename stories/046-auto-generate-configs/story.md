# Auto-generate course configs from the sheet, committed to git by a GitHub Action

> Superseded in part by [047-overwrite-configs](../047-overwrite-configs/story.md): the generator now **overwrites** existing configs unconditionally. The "never overwrite without `--force`" rule, the `--force` flag, and the "existing-course update gap" note below no longer apply.

## Context

Story 042 shipped `scripts/generate-config-from-sheet.mjs`: an **operator-invoked, manual** Node CLI that fetches the published Google Sheet CSV and writes one English-only `src/config/<courseId>.json` (grouping rows by `video_file`, consuming the pipeline's `srt` column, registering the `courseId` in `scripts/lib/generated-configs.json`, and refusing to overwrite without `--force`). It is deliberately wired to nothing — it is not in any workflow.

Two gaps block using it in the cloud lesson-video workflow (`docs/video-pipeline/modal_app.py` + `functions/api/pipeline/render.js`, stories 040/041):

1. **It only understands one course per sheet.** `buildCourseConfig` calls `singleValue(videoRows, 'course_id', 'course')`, which **throws** when rows disagree on `course_id`. A sheet that defines several courses (the intended end state) therefore fails outright, and there is no way to generate one config per course.
2. **It only runs on an operator's laptop.** The cloud workflow renders web videos to R2 but does not update `src/config/`, so the sheet's config content has to be re-run and pushed by hand every time. The config and the videos drift.

This story makes config generation a **best-effort, fully automatic step that lands the config in git**, on GitHub Actions, reusing the established `captions.yml` pattern (checkout with a PAT, a bot identity, a `[skip …]` loop guard, and a commit-and-push step that only commits when there is a diff). A sheet may now define **several courses**; each course is generated independently, and a course whose required columns are incomplete is **skipped whole** (no partial config) with a precise report of *which columns are missing and where* — never blocking the other courses and never blocking the video render (the render already happened).

**Trigger now = the manual `workflow_dispatch` button.** The workflow is written to *also* accept `repository_dispatch` so a later, one-line addition can fire it from the Modal render completing; **wiring Modal → GitHub is explicitly out of scope here** (a Modal-held GitHub token is an invisible-failure/rotation risk the operator chose to defer).

## Out of Scope

- **Wiring Modal → GitHub.** No change to `docs/video-pipeline/modal_app.py` (`orchestrator`, `_write_status`, `plan_publish`) or `functions/api/pipeline/render.js`. The `repository_dispatch` trigger is *accepted* by the workflow but nothing sends it; the Modal side is a later story.
- **Changing the render path, the R2 layout, or the pipeline.** This story only reads the sheet and writes `src/config/**.json` + the allow-list.
- **Localization.** Generated configs stay English-only (`en`); the DeepSeek `translateReal` pass is still later.
- **Editing or overwriting hand-authored configs.** The generator only creates files; `--force` is the sole overwrite path and the Action never passes it.
- **New npm dependencies.** All parsing/transform work stays in the existing pure module; the CLI uses only Node built-ins (`node:fs`, global `fetch`).
- **Changing the singular-course `buildCourseConfig` contract.** It stays the single-course primitive; the multi-course entry point is new (`buildCourseConfigs`).
- **A GitHub Action that fails red on skips.** Skips are annotated (`::error` + job summary) but the job exits 0, because the render already succeeded and this is a git-only action.

## Implementation approach

### 1. Multi-course, best-effort pure transform (`scripts/lib/sheet-config-utils.js`)

Add a new exported pure function alongside the existing single-course primitive. `buildCourseConfig(rows)` is **kept unchanged** as "assemble exactly one course from a non-empty row set" (its internal `singleValue(videoRows, 'course_id', …)` still throws if the passed rows disagree — by construction, partitions never do).

```js
// New exports (pure; no fs/fetch/process):
export const REQUIRED_COLUMNS = ['course_id', 'course_name', 'lesson_id', 'lesson_title', 'response_type', 'video_file', 'order'];
export function findMissingColumns(rows) -> Array<{ column: string, where: string }>
export function buildCourseConfigs(rows) -> Array<
    | { courseId: string, config: object }
    | { courseId: string, error: { kind: 'missing-columns', missing: Array<{column, where}> } }
    | { courseId: string, error: { kind: 'error', message: string } }
>
```

**`buildCourseConfigs(rows)`** — the multi-course entry point:

1. `const videoRows = rows.filter(isVideoRow)` (the same row filter 042 uses).
2. Partition `videoRows` by the **trimmed `course_id` column value**, first-seen order preserved (`Map`). Rows whose `course_id` is blank form a partition keyed `''`.
3. For each partition, in order:
   - `const missing = findMissingColumns(partitionRows)`.
   - If `missing.length > 0` → `{ courseId, error: { kind: 'missing-columns', missing } }` and **do not** call `buildCourseConfig` (all-or-nothing).
   - Else `try { const config = buildCourseConfig(partitionRows); return { courseId, config } }` and `catch (e) { return { courseId, error: { kind: 'error', message: e.message } } }`.
4. **Every partition is independent.** A skip or a throw in one partition never affects another — no shared mutable state, no early return.

The single-course `buildCourseConfig` still throws for **structural** (non-missing) problems — unknown `response_type`, a `cue`/`cue_alt` conflict, conflicting single-valued fields, an invalid `recap_sources`/`recap_overlay` value, a non-numeric `order`. Those surface as `{kind:'error', message}` for that one course and do not block the rest.

### 2. The missing-columns detector (`findMissingColumns`) — exact shape

`findMissingColumns(rows)` is a **pure, non-throwing** function over one course's selected (video) rows. It returns a **deduplicated, deterministically ordered** list of `{ column, where }`, one entry per (column, location) pair that is blank:

| Required column | Check | `where` when missing |
|---|---|---|
| `course_id` | blank on every row | `'course'` |
| `course_name` | blank on every row | `'course'` |
| `lesson_id` | blank on a row | `'row "<filename>"'` |
| `lesson_title` | blank on every row of a lesson partition | `'lesson "<lessonId>"'` |
| `response_type` | blank on every row of a `video_file` group | `'video_file "<video_file>"'` |
| `video_file` | blank on a row | `'row "<filename>"'` |
| `order` | blank or non-numeric (`/^-?\d+$/` fails) on a row | `'video_file "<video_file>" row "<filename>"'` |

Rules:

- A column is **missing** only where it is *required*: `course_id`/`course_name` course-wide; `lesson_id`/`lesson_title` per lesson; `response_type`/`video_file`/`order` per non-skipped row/group. A blank optional column (`recap_sources`, `recap_overlay`, `unit`, `mission`, `cue`, `cue_alt`, `subtitle_text`, `srt`) is **never** reported.
- Grouping mirrors `buildSteps`: lessons partition by trimmed `lesson_id`; steps partition by trimmed `video_file`. A `video_file`-less row is reported as a `video_file` miss on that row (not a group).
- Ordering is **stable and deterministic**, independent of input row order, so tests can assert the exact array: sort by `column` (the `REQUIRED_COLUMNS` order), then by `where` lexicographically. Deduplicate identical `{column, where}` pairs.
- `findMissingColumns([])` returns `[]`.

### 3. CLI (`scripts/generate-config-from-sheet.mjs`)

Replace the single `buildCourseConfig` call with `buildCourseConfigs(rows)`, then:

- **Write one file per successful course** at `path.join(CONFIG_DIR, `${courseId}.json`)` (default `CONFIG_DIR = src/config`), `JSON.stringify(config, null, 2) + '\n'`.
- **Never overwrite without `--force`, per file.** If a target exists and `--force` is absent → that course is a skip with reason `'<path> already exists; refusing to overwrite (use --force to replace)'`. With `--force` it is replaced.
- **`courseId` validation** (path-traversal guard, unchanged from 042): each `courseId` is checked with `isValidCourseId` **before** it becomes a filename; a sheet-supplied `../evil` makes that course an error and writes nothing.
- **Register each successfully-written course** in `scripts/lib/generated-configs.json` (idempotent append + sort), only when writing to the **default** directory. A `--out`/test run never touches the tracked allow-list.
- **`--course=<courseId>`** filters the run to one course (test seam + operator override). If no partition has that id → exit non-zero (`no course "<id>" in the sheet`). It no longer rewrites `courseId`.
- **`--out=<dir>`** is now an **output *directory*** override (was a file path in 042). `CONFIG_OUT_DIR` env is the equivalent seam; `--out` wins over the env var. This resolves `--out` for multi-course; the existing 042 CLI tests that pass a `*.json` file path are updated to pass a directory (or use `CONFIG_OUT_DIR`).
- **`--dry-run`** writes nothing and prints, per course, `[dry-run] would write <path> (courseId=… lessons=…)` or `[dry-run] skip course "…": missing …`.
- **`--check`** = CI mode: run fully (still write the successful courses), but treat **skips as non-fatal** — exit `0` and print a machine-readable skip report. Any **hard** failure (sheet fetch non-OK, CSV parse throw, no video rows, no valid course) still exits non-zero. Without `--check`, a skipped course makes the run exit non-zero (`ERROR: N course(s) skipped`) after writing the successful ones.
- **Skip/error report format** (stderr, so CI can echo it): for each skipped course exactly one line:
  ```
  SKIP course "<courseId>": missing required column(s): <column> (<where>), <column> (<where>)
  ```
  and for a structural error:
  ```
  SKIP course "<courseId>": <message>
  ```
  `--check` prints a final summary line: `SKIPPED <n> course(s), WROTE <m>`. The CLI also prints `WROTE <path>` per written file (unchanged from 042).
- **`--help`** documents `--course`, `--out` (directory), `--sheet-url`, `--dry-run`, `--check`, `--force`.

The default sheet URL constant `SHEET_URL` and its source guard against `public/recorder.html` are unchanged.

### 4. GitHub Action (`.github/workflows/configs.yml`)

Model directly on `.github/workflows/captions.yml`. Fields, reasoning stated:

- `name: Generate Course Configs`.
- Triggers: **both** now —
  ```yaml
  on:
    workflow_dispatch:
    repository_dispatch:
      types: [render-complete]
  ```
  `repository_dispatch` is accepted but nothing sends it yet (Modal wiring deferred, see Out of Scope). This is the "small later addition" — enabling it later is a sender on the Modal side only.
- `permissions: { contents: read }` (like captions: the push uses the PAT, not `GITHUB_TOKEN`).
- `concurrency: { group: configs-${{ github.ref }}, cancel-in-progress: false }`.
- Job guard, **null-safe across all three events** (only `push` has `head_commit`, and the loop guard must also cover the bot's own commit):
  ```yaml
  if: github.actor != 'github-actions[bot]' && !contains(github.event.head_commit.message || '', '[skip configs]')
  ```
- Steps:
  1. `actions/checkout@v4` with `fetch-depth: 0` and `token: ${{ secrets.GH_NEW_TOKEN }}` (the PAT captions uses, so the push triggers downstream workflows).
  2. `actions/setup-node@v4` with `{ node-version: 20, cache: npm }`.
  3. `npm ci`.
  4. Generate: `node scripts/generate-config-from-sheet.mjs --check 2>&1 | tee /tmp/configs.log` (with `set -o pipefail` omitted so the tee's exit status is the CLI's; or use `PIPESTATUS[0]`). `--check` exits 0 when courses were merely skipped.
  5. **Report skips**: a `run` step that reads `/tmp/configs.log` (the same step or a following one, `if: always()`), greps the `SKIP course ` lines, and for each writes the line into `$GITHUB_STEP_SUMMARY` and emits `::error::<line>`. Because step 4 exited 0 on skips, the job stays green and nothing downstream is blocked; the annotations make the missing columns visible on the run page.
  6. **Commit configs** only when there is a diff, using the captions bot identity:
     ```bash
     git config user.name "uff-configs-bot"
     git config user.email "11131426+joelipi@users.noreply.github.com"
     git add src/config scripts/lib/generated-configs.json
     if git diff --cached --quiet; then
       echo "no config changes"
     else
       git commit -m "chore(configs): regenerate course configs from the sheet [skip configs]"
       git push origin "HEAD:${{ github.ref_name }}"
     fi
     ```
     The repo email `11131426+joelipi@users.noreply.github.com` is reused from `captions.yml` (same attribution account); the committer **name** is `uff-configs-bot` so the commit is self-describing.
- The workflow file's shape is pinned by a **source guard** test (see Task 6).

### 5. Keeping the generated-config contract guard valid for N files

`src/config/generated-config-contract.test.js` already loops the allow-list and applies the contract per file. This story:

- Adds a **multi-course fixture** (`buildCourseConfigs` → two courses) and asserts the contract helper passes for each, so the loop is proven to handle more than one generated file (per `docs/learnings.md`: a guard over an empty/one-element set is under-tested).
- Keeps the allow-list (`scripts/lib/generated-configs.json`) the single source of generated `courseId`s; this story still commits no real generated course (the sheet is not committed), so the list stays `[]` unless a fixture test writes to a temp list.

### 6. Docs

- **README** (operator section, next to the existing "Generate a course config from the sheet" paragraph, `README.md:102`): how the automatic auto-commit works, the manual "Run workflow" button, the `[skip configs]` loop guard, the multi-course behavior, and **how to add a required column** (add the column to the sheet header *and* to `REQUIRED_COLUMNS`); note skips are reported and non-fatal.
- **`docs/product.md`**: extend the existing "Course configs generated from the published sheet" feature entry (or add a sibling entry) to state that a GitHub Action auto-generates and commits them, one config per course, best-effort with a missing-columns report.
- **`docs/learnings.md`**: add an entry only if the implementation surfaces a non-obvious trap (candidate: "a workflow trigger with no `head_commit` makes the captions loop guard throw / never match" — pattern-copy hazards). Decide at implementation time; do not add a low-value entry.

## Tasks

### Task 1 - `findMissingColumns`: the pure missing-columns detector

- one course's rows where `course_name` is blank on every row + `findMissingColumns(rows)` called
  - → returns exactly `[{ column: 'course_name', where: 'course' }]`
- rows with a non-blank `course_name` but one row missing `lesson_id` + called
  - → includes `{ column: 'lesson_id', where: 'row "<filename>"' }` with the offending row's `filename`
- a lesson partition whose `lesson_title` is blank on every row + called
  - → includes `{ column: 'lesson_title', where: 'lesson "<lessonId>"' }`
- a `video_file` group whose `response_type` is blank on every row + called
  - → includes `{ column: 'response_type', where: 'video_file "<video_file>"' }`
- a row with a blank/non-numeric `order` + called
  - → includes `{ column: 'order', where: 'video_file "<vf>" row "<filename>"' }`
- a row with a blank `video_file` + called
  - → includes `{ column: 'video_file', where: 'row "<filename>"' }`
- only optional columns blank (`recap_sources`, `recap_overlay`, `unit`, `mission`, `cue`, `cue_alt`, `subtitle_text`, `srt`) + called
  - → returns `[]`
- a fully-populated valid course + called
  - → returns `[]`
- input rows in shuffled order + called twice
  - → both calls return the identical array (deterministic ordering)
- duplicate missing locations (two rows blank `order` in the same group) + called
  - → each distinct `{column, where}` appears once (deduplicated)
- an empty array + called
  - → returns `[]`

### Task 2 - `buildCourseConfigs`: multi-course partitioning, best-effort

- a sheet whose rows carry two distinct `course_id`s + `buildCourseConfigs(rows)`
  - → returns exactly two entries, one per course, in first-seen order
  - → each entry with a config has `entry.config.courseId === entry.courseId`
- a two-course sheet + called
  - → each returned config contains only that course's lessons/steps (no cross-contamination)
- one course's rows have a complete required set and the other course is missing `lesson_title` + called
  - → the complete course returns `{ courseId, config }`
  - → the incomplete course returns `{ courseId, error: { kind: 'missing-columns', missing: [...] } }` naming `lesson_title` and the offending lesson
  - → the incomplete course has **no** `config` key (all-or-nothing, no partial object)
- a course whose only defect is a structural error (unknown `response_type`) and a second valid course + called
  - → the structural course returns `{ kind: 'error', message }` containing the bad value
  - → the valid course still returns its `config` (one course's failure does not block another)
- rows whose `course_id` is blank + called
  - → they form their own entry with `courseId: ''` and `error.kind === 'missing-columns'` naming `course_id`
- `buildCourseConfig` called on a single non-empty partition with a constant `course_id` + compared to `buildCourseConfigs` on a one-course sheet
  - → the single-course primitive's output deep-equals the multi-course entry's `config` (primitive retained, unchanged contract)
- a fixture CSV + `buildCourseConfigs(parseCsv(csv).rows)` for a two-course sheet
  - → returns the two expected configs (deep-equal), each English-only
- rows where every row is a blank spacer row + called
  - → returns `[]`

### Task 3 - Contract guard covers multiple generated files

- a two-course fixture generated via `buildCourseConfigs` + the contract helper applied to each returned config
  - → passes for both (the loop is exercised with N > 1)
- the second generated course's `title` mutated to add an `es` key + contract helper applied
  - → throws (the multi-file path can fail, not just the first file)
- the allow-list lists two courseIds whose files both satisfy the contract + `every listed generated config satisfies the contract` runs
  - → passes, iterating both
- one listed course's config contains a non-canonical `recapSources` + runs
  - → throws naming that course

### Task 4 - CLI: one config per course, never-overwrite per file, allow-list per course

- a two-course fixture sheet served by the local fake + CLI run with `CONFIG_OUT_DIR=<tmp>`
  - → exits 0; writes `<tmp>/<courseA>.json` and `<tmp>/<courseB>.json`, each with the matching `courseId`
  - → stdout contains `WROTE` for each path
- the two-course fixture re-run with the same `CONFIG_OUT_DIR` and no `--force`
  - → exits non-zero; both existing files are byte-identical (no course overwritten)
- the two-course fixture re-run with `--force` + same dir
  - → exits 0; both files are replaced
- a two-course sheet where course A is missing a required column and course B is complete + CLI run (default mode)
  - → exits non-zero with `ERROR: 1 course(s) skipped`
  - → only course B's file is written (no partial/skipped file for A)
  - → stderr contains `SKIP course "A": missing required column(s):` and each missing column name + its `where`
- the same mixed sheet + CLI run with `--check`
  - → exits **0**
  - → course B's file is still written; course A's is not
  - → stderr contains the `SKIP course "A"` line and a `SKIPPED 1 course(s), WROTE 1` summary
- a sheet with an unknown `response_type` in one course and a valid other + `--check`
  - → exits 0; the valid course's file is written; stderr reports `SKIP course "<bad>": <message>` with no missing-columns list
- default-path run (via `CONFIG_OUT_DIR` + `GENERATED_CONFIGS_ALLOWLIST=<tmp>`) on a two-course sheet
  - → the allow-list temp file contains **both** generated courseIds, sorted
- `--out=<tmpdir>` two-course run
  - → writes both files into that directory; the **tracked** `scripts/lib/generated-configs.json` is byte-identical before/after
- `--course=<B>` on the two-course sheet
  - → writes only course B's file and reports no course A
- `--course=<missing>` + run
  - → exits non-zero with `no course "<missing>" in the sheet`; writes nothing
- an unsafe sheet-supplied `courseId` (`../evil`) + run
  - → exits non-zero with `invalid courseId`; no file written outside the output dir
- `--help` + invoked
  - → exits 0 and documents `--course`, `--out`, `--sheet-url`, `--dry-run`, `--check`, `--force`
- `--dry-run` on the two-course sheet
  - → exits 0; prints both would-be paths; writes neither file
- the default sheet URL constant + compared to `public/recorder.html`
  - → the URL appears verbatim in both (raw source, not comment-stripped)

### Task 5 - Workflow source guard (`.github/workflows/configs.yml`)

- `configs.yml` + parsed as text by the guard
  - → contains `workflow_dispatch:` and `repository_dispatch:` (prepared cloud trigger)
  - → contains `secrets.GH_NEW_TOKEN` in the checkout step
  - → contains the bot identity `11131426+joelipi@users.noreply.github.com`
  - → contains the loop guard token `[skip configs]` and the actor guard `github.actor != 'github-actions[bot]'`
  - → contains `node scripts/generate-config-from-sheet.mjs --check`
  - → contains `git add src/config scripts/lib/generated-configs.json`
  - → contains a conditional commit (`git diff --cached --quiet`) and `git push origin "HEAD:${{ github.ref_name }}"`
- the guard's target token mutated in a temp copy (e.g. remove `--check`, or the `[skip configs]` token) + guard re-run
  - → fails (the guard can fail; proven before trusting)
- `configs.yml` + guard checks the skip-report wiring
  - → contains a `tee /tmp/configs.log` capture and `GITHUB_STEP_SUMMARY`, and emits an `::error` annotation (skips are reported, not silently dropped)
- `configs.yml` + guard checks it does not pass `--force`
  - → the string `--force` does not appear in the generator invocation line (the Action never overwrites)

### Task 6 - Docs

- `README.md` + read
  - → documents the automatic `configs.yml` auto-commit, the manual "Run workflow" button, the `[skip configs]` guard, multi-course generation, and how to add a required column (sheet header + `REQUIRED_COLUMNS`)
  - → notes skips are reported and non-fatal (render unaffected)
- `docs/product.md` + read
  - → has a feature entry stating a GitHub Action auto-generates and commits one config per sheet course, best-effort with a missing-columns report
- the new workflow file + README reference
  - → the README names `.github/workflows/configs.yml`

## Technical Context

- **No new dependencies.** `package.json` is unchanged except, optionally, a `configs:generate:ci` script (`node scripts/generate-config-from-sheet.mjs --check`). The generator uses only Node built-ins (`node:fs`, `node:path`, global `fetch`). Do **not** add an npm package.
- **Node version in CI:** the workflows use `node-version: 20` (`captions.yml:20`, `deploy.yml:19`). Global `fetch` and the existing `.mjs` tooling work on Node 20. Local dev is Node 22.x.
- **Test tooling:** Vitest 4.1.6 (devDependency). Pure tests extend `scripts/lib/sheet-config-utils.test.js`; CLI tests extend `scripts/generate-config-from-sheet.test.js` (its `runCli`/`tmpDir`/`CONFIG_OUT_DIR`/`GENERATED_CONFIGS_ALLOWLIST` seams already exist). The workflow guard is a new `scripts/configs-workflow.test.js` (or a `describe` in a scripts test) reading `.github/workflows/configs.yml` as text.
- **Source-guard hygiene (`AGENTS.md`):** do not comment-strip before URL assertions; scope slices to the specific block; end function-body slices at the next top-level marker; prove every new guard can fail by temporarily mutating the target. The workflow guard asserts **tokens**, so it must be paired with a mutation test (Task 5).
- **`src/**` guard:** any new test under `src/` must not mention the literal `recorder.html`/`/recorder` token (`src/modules/video/recorder-page.test.js` scanner). The CLI URL guard stays under `scripts/`; the config-contract test in `src/config/` must not reference the recorder page.
- **Existing 042 tests that change:** `scripts/generate-config-from-sheet.test.js`'s `--out=<file>` cases become `--out=<dir>` / `CONFIG_OUT_DIR`; the rest of its assertions (never-overwrite, `--dry-run`, `--help`, URL guard, traversal, allow-list seams, `--force`) remain valid. `scripts/lib/sheet-config-utils.test.js`'s `buildCourseConfig` tests remain valid (the primitive is unchanged).
- **Single-course primitive:** `buildCourseConfig` (`sheet-config-utils.js:267`) keeps its `singleValue(videoRows, 'course_id', 'course')` call; partitions make it a no-op. `buildSteps` (`:206`) grouping by `video_file` and lesson partitioning by `lesson_id` are reused by `findMissingColumns` — mirror their trimmed-value grouping exactly so a detector and a builder never disagree.
- **Required vs optional columns** (the detector's allow-list of "required"): required = `course_id`, `course_name`, `lesson_id`, `lesson_title`, `response_type`, `video_file`, `order`; optional (default/omitted) = `recap_sources`, `recap_overlay`, `unit`, `mission`, `cue`, `cue_alt`, `subtitle_text`, `srt`. This matches 042's table.
- **Canonical vocabularies:** `RECAP_SOURCES = ['system','friend','none']`, `RECAP_OVERLAYS = ['fluency','shareCta','none']` (mirrored/guarded against `src/modules/video/video-processor-logic.js:125-126`); `FRIEND_VIDEO_REGEX = /-response-\d+$/i` (`src/modules/video/video-source.js:10`); `RESPONSE_TYPES` = the six canonical response types. `generated-config-contract.test.js` and `model-config.test.js` already enforce the invariants a generated file can break — the multi-course output must satisfy both.
- **`secrets.GH_NEW_TOKEN`** is the PAT `captions.yml:18` already uses for push; it is what lets the bot commit trigger downstream workflows. No new secret is needed for `workflow_dispatch` (the token is only used for the push).
- **Local clone note:** the branch is cut from local `main` at `840b0e5`, which is 9 commits behind `origin/main` (`d2a8d0c`, including story 045's ESLint flat config). The 042 files this story edits are unchanged on `origin/main`, so the plan is unaffected; the branch merges forward as normal. Do **not** force-push or rebase onto `origin/main` in this story.
- **`--check` semantics (locked):** writes the successful courses and exits 0 when courses were merely skipped; non-zero only on hard failures (fetch/parse/no-data). This is what lets the Action "continue" while still committing the courses that *can* be generated.
- **Multi-course error shape (locked)** — the exact object returned per failed course:
  ```js
  { courseId: 'demo', error: { kind: 'missing-columns', missing: [
      { column: 'lesson_title', where: 'lesson "a"' },
      { column: 'response_type', where: 'video_file "demo-v1"' },
  ] } }
  ```
  and the exact stderr line the CLI prints:
  ```
  SKIP course "demo": missing required column(s): lesson_title (lesson "a"), response_type (video_file "demo-v1")
  ```
  Structural failures use `{ kind: 'error', message: '<buildCourseConfig error message>' }` → `SKIP course "demo": <message>`.

## Notes

- **Existing-course updates are an operator decision (documented gap).** The Action never passes `--force`, and the CLI refuses an existing target, so a course config generated once is **not** overwritten by later runs — sheet edits to an already-generated course do not propagate automatically; the run shows a benign `SKIP … already exists` (summarized, not annotated as an error). This is deliberate for now (generated files are committed and may have hand-edits), but it means the auto-commit stops drift only for *new* courses. Making the Action refresh generated configs (e.g. `--force` scoped to allow-listed files) is a follow-up decision for the operator.
- The Action is **git-only**: it never renders, never touches R2, and never fails red on a skip. The render has already happened before this runs; a missing column just means the operator's sheet needs fixing, not that anything is broken downstream.
- **Deferred trigger**: to fire this from the Modal render completing, a later story adds a `repository_dispatch` POST (type `render-complete`) from `modal_app.py` with a scoped GitHub token — deliberately not done here because the token's rotation/visibility risk was the operator's stated reason to defer. The workflow already accepts the event, so that later change is sender-only.
- **Operator adding a required column**: add the header to the published sheet *and* add the name to `REQUIRED_COLUMNS` in `scripts/lib/sheet-config-utils.js`, or the detector ignores it. Document this in the README (Task 6).
- **Manual button**: the operator runs it from the Actions tab → "Generate Course Configs" → "Run workflow" (choose the branch/ref). The bot then commits to that ref if the sheet produced changes.
- Before trusting the workflow source guard and the multi-file contract guard, prove each can fail (mutate `--check` / inject an `es` key) per `AGENTS.md`.
- No change to `docs/video-pipeline/modal_app.py`, `functions/api/pipeline/render.js`, the recorder page, the R2 layout, or any existing `src/config/*.json`.
