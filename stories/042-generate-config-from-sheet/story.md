# Generate `src/config/<courseId>.json` course configs from the published Google Sheet

## Context

Course configs (`src/config/*.json`) are currently hand-authored JSON. The published Google Sheet already carries the authoring content (per-sentence rows keyed by `filename`, grouped into rendered videos by `video_file`), and the render pipeline (`docs/video-pipeline/video_pipeline.py`) already computes exact SRT timings into a `srt` CSV column. Today an operator must manually translate the sheet into config JSON — error-prone, and it drifts from the sheet that the recorder (`public/recorder.html:886`) treats as source of truth.

This story adds an **operator-invoked, manual** Node CLI (`scripts/generate-config-from-sheet.mjs`, like `posters`/`videos:optimize`/`pipeline:upload-assets`) that fetches the published CSV, transforms it with **pure, unit-testable functions**, and writes a **new** `src/config/<courseId>.json`. The sheet becomes the source of truth for both videos (via the render pipeline) and configs.

English-only for now: generated configs carry only `en` values. `es`/`pt`/`bn` localization is a later pass that reuses the DeepSeek `translateReal` path already in `scripts/generate-captions.mjs`.

**The generator never overwrites an existing config.** Its output is always a new file; hand-tuned configs (including `wouldrather.json`) are untouched. A generated course must have a `courseId` that does not already exist in `src/config/`.

## Out of Scope

- Localization. No `es`/`pt`/`bn`/`fr`/`hi` translation in this story; generated `title`/`mission`/`cue`/`subtitles` carry only `en`. The hook for the later pass is documented, not implemented.
- Whisper transcription of timings. Exact SRT timings are consumed from the pipeline's `srt` column when present; otherwise `subtitles` is omitted. Whisper is the documented later path.
- Changing the render pipeline (`video_pipeline.py`), the recorder page, the Modal/Pages Functions, or the R2 layout.
- Editing or overwriting any existing `src/config/*.json`.
- Deriving structural fields by naming convention. Every structural field that can change gets its own explicit sheet column.
- Wiring the generator into `.github/workflows`/CI or `deploy.yml`; it stays manual, like the poster/optimize tools.

## Implementation approach

### Split: pure module + thin CLI

Mirror the established `scripts/lib/*-utils.js` + `scripts/<cli>.mjs` pattern (poster-utils, video-optimize-utils, caption-utils): **all logic in `scripts/lib/sheet-config-utils.js` is pure** (no `fs`, no `fetch`, no `process`); the CLI (`scripts/generate-config-from-sheet.mjs`) does fetch, `fs` read/write, and `process.argv`. This is what makes every transform testable with an in-memory CSV string and a fake `fetch`.

Reuse the existing helpers rather than reinvent: `flagValue` from `scripts/lib/cli-utils.js` for `--name=value` flags; `loadConfigs` from `poster-utils.js` as the "which configs already exist / collision" loader. The pure module does **not** build SRT timings — the pipeline already writes them into the `srt` column; the module only normalises the string into the config's `subtitles` shape.

### CSV parsing

The published CSV is fetched from the URL hardcoded in `public/recorder.html:886`:
`https://docs.google.com/spreadsheets/d/e/2PACX-1vSDgWLQRezvKde57LsHzm6YPrwanYJgCBOXkz_1r6GxEilauIudDxsg5IUjiQ7F7CP4OwZQg82LSbfT/pub?gid=289451687&single=true&output=csv`

The recorder's naive splitter (`recorder.html:897-912`) is a reference for the *shape* of the data, but the generator must parse CSV correctly (quoted fields may contain commas — `cue`, `subtitle_text`, `phrase`, `directions` routinely do). Implement a small standard RFC-4180-style parser in the pure module: quoted fields with `""` escapes, optional `\r`, a trailing newline allowed, blank lines skipped. Header names are trimmed and lower-cased (matching the recorder).

### Grouping, ordering, and the join semantics (established, not derived)

- **`video_file` is the config's `simpleVideoUrl` slug** (e.g. `testvideointro`, `testvideoa01`, `enda`). Multiple rows share one `video_file`.
- **`filename` is the per-sentence render source** (e.g. `testvideointro01`..`08`, `testvideoa0101`, `enda01`..`06`). Rows are the sentences; a group of rows sharing one `video_file` renders to one video.
- **Grouping is by the `video_file` column value, never by row position.** Rows may be sorted freely. `srt`/`subtitles`/`title`/etc. are group-level (every row in the group must agree; first non-empty wins, and disagreement on a single-valued field is an error — see below).
- **Rows with no video-related values are skipped.** "Video-related" = `video_file`, `filename`, and `subtitle_text`/`srt` are all empty/blank. Such a row contributes no step and no lesson.
- **Ordering within a lesson:** group rows are ordered by the numeric `Order` column (ascending), never by CSV row index. `Order` is mandatory for every non-skipped row; a non-numeric/missing `Order` is an error. Ties are broken by first-seen CSV order for determinism.

### Added-sheet-column contract

The generator emits only fields that have an explicit column (or a documented default). Every column name below is matched case-insensitively after trimming.

**Course-level columns** (must be constant across all non-skipped rows; the first non-empty wins and any disagreement is an error):

| Config field | Sheet column | Required | Default / rule |
|---|---|---|---|
| `courseId` | `course_id` | yes (or `--course` flag) | filename stem of the output; must not collide with an existing `src/config/<courseId>.json` |
| `courseName` | `course_name` | yes | — |
| (`lessons[].unit`) | `unit` | optional | default `""` (empty string) |
| (`lessons[].mission`) | `mission` | optional | default `{}` (omit key if blank) |

**Lesson-level columns** (constant within a `lessonId` partition; disagreements error):

| Config field | Sheet column | Required | Default / rule |
|---|---|---|---|
| `lessonId` | `lesson_id` | yes | — |
| `recapSources` | `recap_sources` | optional | default `"none"`; must be one of `RECAP_SOURCES` = `system`/`friend`/`none` |
| `recapOverlay` | `recap_overlay` | optional | default `"shareCta"`; must be one of `RECAP_OVERLAYS` = `fluency`/`shareCta`/`none` |
| `title` | `lesson_title` | yes | becomes `{ en: <value> }` |
| `unit` | `unit` | optional | default `""` (omit key if blank) |
| `mission` | `mission` | optional | becomes `{ en: <value> }`; omit key if blank |

**Step-level columns** (per `video_file` group):

| Config field | Sheet column | Required | Default / rule |
|---|---|---|---|
| `responseType` | `response_type` | yes | must be one of the canonical vocabulary (see below) |
| `simpleVideoUrl` | `video_file` | yes (the group key) | the group's slug |
| (`lessonIntro` step: `introBackgroundVideoUrl`) | `video_file` on a row whose `response_type` is `lessonIntro` | — | intro steps use `video_file` as both the group key and `introBackgroundVideoUrl`; `cue` defaults to `""` |
| `cue` (single) | `cue` | optional | `{ en: <value> }`; omit key if blank |
| `cue` (alternatives) | `cue_alt` | optional | newline-separated alternatives; when present, `cue` becomes an **array** of `{ en }` objects (one per non-empty line); mutually exclusive with `cue` |
| `subtitles` | `srt` (preferred) or `subtitle_text` | optional | see "SRT sourcing" below |

`responseType` vocabulary is exactly the six in the repo (verified by grep over `src/config/*.json`): `friendClosedResponse`, `viewAndContinue`, `closedResponse`, `success`, `lessonIntro`, `openResponse`. Any other value is an error naming the offending row/group. The pure module exports the canonical list so tests and future callers share it. `recapSources`/`recapOverlay` allowed sets are re-exported from `scripts/lib/sheet-config-utils.js` as literals copied from `video-processor-logic.js` (the browser module imports runtime deps and is not importable from a Node script); a source guard pins them equal to the browser lists.

Defaults summary (explicit): `recapSources="none"`, `recapOverlay="shareCta"`, blank optional fields are **omitted from the emitted object** (never `null`, never `""`), except `lessonIntro.cue` which is `""` to match `wouldrather.json`.

### SRT sourcing (no guessing)

Priorities for a group's `subtitles.en`, first non-empty wins:

1. **`srt` column** — written by `video_pipeline.py`'s `write_srt_column` (JSON-escaped SRT string; the value is the same on every row of a group). The generator un-escapes the `\n`/`\"` JSON-string form back to the literal SRT text (the pipeline stores the JSON-escaped form; `wouldrather.json` stores literal `\n`, so the config value must be the literal newline form).
2. **`subtitle_text` column** — if `srt` is empty but `subtitle_text` is present, it is used verbatim as the `en` subtitle string (static text, matching how `SimpleVideoStateController.initSubtitles` treats a string with no `-->` as static text).
3. **Neither present** → `subtitles` is **omitted** from the step object.

The generator does **not** synthesize timings and does not call Whisper. When a group lacks both columns, the step ships without subtitles; the documented later path is to run the pipeline (writes `srt`) or Whisper (the `transcribeReal` path in `generate-captions.mjs`).

### English-only output and the locale-guard conflict

Generated configs contain only `en` in every translation object. This is deliberate for this story.

**Conflict found (must be stated, not silently ignored):** `src/config/wouldrather.test.js` requires all four locales (`en`/`es`/`pt`/`bn`) for the specific steps of `wouldrather.json` lesson `a`. That test is **scoped to the `wouldrather.json` import** and does not scan generated files, so it does **not** break when a new English-only config appears. `src/config/friend.test.js` likewise imports `friend.json` only. Therefore the existing per-file locale guards do **not** apply to generated files — they stay green.

**However**, `src/modules/video/model-config.test.js` globs **every** `src/config/*.json` (`readdirSync(CONFIG_DIR)`) and enforces config invariants that a generated file *can* violate:
- `recapSources`/`recapOverlay` values must be in the canonical lists,
- every step whose prompt video is a friend slug (`/-response-\d+$/i`) must live in a `recapSources: "friend"` lesson.

So: generated configs must be **invariant-clean** — the generator must emit only canonical `recapSources`/`recapOverlay` values, and a generated course that references `-response-NN` slugs must set `recapSources: "friend"` on that lesson. The generator's own tests assert these two invariants.

**Decision (stated):** the English-only contract is guarded by a **new** test, `src/config/generated-config-contract.test.js`, rather than by the existing per-file locale guards. To identify generated configs without leaking a marker key into the config body, a committed allow-list file `scripts/lib/generated-configs.json` lists the generated `courseId`s; the generator appends to it when it writes a new config. The test asserts, for each listed course: every translation object has **only** the key `en` with a non-empty string value; no `null`/`""`; `recapSources`/`recapOverlay` are canonical; friend-slug steps live in a `recapSources: "friend"` lesson. This test can fail (inject an `es` key → fails; inject a non-canonical recap value → fails; prove before trusting).

This story does **not** add a generated config to the repo (no sheet is committed and no course is being produced here); the allow-list starts empty. The contract test is exercised against a **fixture** generated in-memory by the pure module, plus the (empty) allow-list check, so it has real coverage now and applies automatically to the first generated course.

### Never-overwrite rule

The CLI writes to `src/config/<courseId>.json`. Before writing, it checks existence (via `fs`):

- If the file exists and `--force` is **not** passed → exit non-zero with `ERROR: <path> already exists; refusing to overwrite (use --force to replace)`. Nothing is written.
- If the file exists and `--force` **is** passed → it overwrites (explicit operator opt-in). `--force` is the only way any existing config is ever touched; the flag is required to be documented in `--help`.
- `--dry-run` prints the would-be path and a summary and writes nothing, even with `--force`.

Because `courseId` is the output filename stem, a collision is the same condition as "would overwrite".

### CLI surface

`node scripts/generate-config-from-sheet.mjs [--sheet-url=<url>] [--course=<courseId>] [--out=<path>] [--dry-run] [--force] [--help]`

- `--sheet-url` overrides the published CSV URL (test seam; defaults to the recorder's URL constant). The constant is defined once in the CLI and also asserted (source guard) to equal the URL in `public/recorder.html`.
- `--course` overrides the `course_id` column (and thus the output filename). If absent, `course_id` from the sheet is used; if both absent → error.
- `--out` overrides the output path (default `src/config/<courseId>.json`); a test seam, must still respect never-overwrite.
- All flags use `flagValue` semantics (`--name=value`); a bare `--course` errors.

### Errors (fail loud, write nothing)

Any of these exits non-zero with a message naming the offending group/row, before any file is written: unknown `response_type`; missing `video_file` on a non-skipped row; missing/non-numeric `Order`; conflicting values for a single-valued field within a `video_file` group or `lessonId` partition; missing `course_id`/`course_name`/`lesson_id`/`lesson_title`; colliding `courseId` without `--force`; `cue` and `cue_alt` both set on one group.

## Tasks

### Task 1 - Pure CSV parser and row normalization

- a raw CSV string with quoted comma-containing fields + parsed
  - → the field value is the unquoted text including the comma
  - → `""` inside a quoted field is a literal `"`
- a CSV string with `\r\n` line endings, a trailing newline, and a blank line + parsed
  - → blank lines are skipped
  - → the number of parsed rows equals the number of non-blank data rows
- a header row with mixed case and surrounding whitespace + parsed
  - → header keys are lower-cased and trimmed (matching `recorder.html`)
- a row missing a trailing field + parsed
  - → the missing field resolves to `""` (not `undefined`) for every header, and the parser does not throw
- a row where `video_file`, `filename`, and `subtitle_text`/`srt` are all blank + passed to the row filter
  - → the row is skipped (contributes no group/step)

### Task 2 - Pure sheet→config transform (group, order, emit)

- two rows sharing one non-blank `video_file` + transformed
  - → exactly one step is emitted for that `simpleVideoUrl` (the group collapses, not one step per row)
  - → the step's `cue`/`subtitles` come from the group's rows, not one arbitrary row
- rows interleaved across two `video_file`s and CSV order shuffled + transformed
  - → grouping is by `video_file` value only; each group emits exactly one step; CSV row position has no effect on membership
- a group whose rows carry `response_type=friendClosedResponse`, `cue=Q1`, and `cue_alt` blank + transformed
  - → the step's `cue` is the object `{ en: "Q1" }`
- a group with `cue` blank and `cue_alt` containing two newline-separated lines + transformed
  - → the step's `cue` is the array `[{ en: line1 }, { en: line2 }]`
- a group with both `cue` and `cue_alt` non-blank + transformed
  - → throws an error naming the `video_file`
- a group whose `response_type` is not one of the six canonical values + transformed
  - → throws an error naming the offending value and group
- a group with non-blank `srt` (JSON-escaped `\n` form) + transformed
  - → `subtitles.en` is the literal multi-line SRT text (contains real newlines and `-->`)
- a group with blank `srt` but non-blank `subtitle_text` + transformed
  - → `subtitles.en` equals `subtitle_text` verbatim
- a group with both `srt` and `subtitle_text` blank + transformed
  - → the step object has no `subtitles` key (asserted via `'subtitles' in step === false`)
- a non-skipped row with missing or non-numeric `Order` + transformed
  - → throws an error naming the row's `filename`/`video_file`
- two rows in one lesson with conflicting non-empty `lesson_title` values + transformed
  - → throws an error naming the `lessonId`

### Task 3 - Pure lesson/course assembly

- non-skipped rows for one `lessonId` whose `Order`s are 3,1,2 across three `video_file`s + assembled
  - → the lesson's `steps` are ordered by ascending `Order`, ties by first-seen
- a lesson where a row's `response_type=lessonIntro` + assembled
  - → the emitted step is `{ cue: "", responseType: "lessonIntro", introBackgroundVideoUrl: <video_file> }`
- a lesson with no `mission` column value + assembled
  - → the lesson object has no `mission` key
- a lesson with `mission=Talk about X` + assembled
  - → `mission` is `{ en: "Talk about X" }`
- rows spanning two `lessonId`s + assembled
  - → `lessons` contains two lesson objects; each holds only its own steps; course-level `courseId`/`courseName` disagreeing across rows → throws
- blank `recap_sources`/`recap_overlay` on a lesson + assembled
  - → defaults `"none"` / `"shareCta"`
- a `recap_sources` value outside `{system,friend,none}` + assembled
  - → throws an error naming the lesson
- every emitted translation object (title/mission/cue/subtitles) + inspected
  - → contains exactly the single key `en` with a non-empty string
- a fully-formed fixture CSV string + `buildCourseConfig(fixture)` 
  - → deep-equals the committed expected config JSON fixture (shape identical to `wouldrather.json` but English-only)

### Task 4 - Contract guard for generated English-only configs

- the allow-list file lists a generated course and that config contains an `es` key in any translation object + contract test runs
  - → fails (proves the guard can fail)
- the allow-list lists a generated course whose friend-slug step is in a `recapSources: "friend"` lesson + contract test runs
  - → passes
- the allow-list lists a generated course whose friend-slug step is in a non-friend lesson + contract test runs
  - → fails naming the file/lesson
- the allow-list is empty + contract test runs
  - → passes and asserts `src/config/*.json` are otherwise unconstrained (existing hand-tuned configs with es/pt/bn remain valid)
- `scripts/lib/sheet-config-utils.js` exports `RESPONSE_TYPES`/`RECAP_SOURCES`/`RECAP_OVERLAYS` + compared to `video-processor-logic.js` source text
  - → each literal list matches the browser module's literals (a source guard; parse the arrays and compare, assert on the raw source for the tokens)

### Task 5 - CLI surface and never-overwrite

- `--help` + invoked
  - → exits 0 and documents `--sheet-url`, `--course`, `--out`, `--dry-run`, `--force`
- a `--course` flag with no value + invoked
  - → exits non-zero with `--course requires a value`
- a fixture sheet served by a local fake (injected/dir) and `--dry-run` + invoked
  - → exits 0, prints the would-be path, and writes no file (assert file absence)
- output path already exists and no `--force` + invoked
  - → exits non-zero with `already exists; refusing to overwrite` and leaves the file byte-identical
- output path already exists and `--force` + invoked
  - → exits 0 and replaces the file
- sheet with unknown `response_type` + invoked (non-dry-run)
  - → exits non-zero naming the value and writes nothing (no partial file left)
- the CLI's default sheet URL constant + compared to `public/recorder.html`
  - → the URL appears verbatim in both (source guard, raw source, not comment-stripped)
- a generated course whose `courseId` already exists in `src/config/` and no `--force` + invoked
  - → refuses exactly as the existence case above

## Technical Context

- **Node 22.23.3** (repo `engines`-free; the repo already runs `.mjs` scripts). No new npm dependency: CSV parsing and SRT un-escaping are hand-written pure functions in `scripts/lib/sheet-config-utils.js`; `flagValue`/`loadConfigs` already exist.
- **No new package versions to pin.** This story adds zero dependencies.
- **Test tooling:** Vitest 4.1.6 (already a devDependency). Pure-module tests live at `scripts/lib/sheet-config-utils.test.js`; CLI tests at `scripts/generate-config-from-sheet.test.js` (mirroring `optimize-videos.test.js`: `runCli` via `execFile('node', …)`, temp dirs outside the repo, `mkdtemp`/`rmSync`). Contract test at `src/config/generated-config-contract.test.js`.
- **CSV URL source of truth:** `public/recorder.html:886`. Do not hand-copy a different URL — a source guard pins the CLI constant to the recorder's literal.
- **Canonical sets to mirror:** `RECAP_SOURCES = ['system','friend','none']`, `RECAP_OVERLAYS = ['fluency','shareCta','none']` (`src/modules/video/video-processor-logic.js:125-126`); `FRIEND_VIDEO_REGEX = /-response-\d+$/i` (`src/modules/video/video-source.js:10`); responseType vocabulary from the config grep (`friendClosedResponse`, `viewAndContinue`, `closedResponse`, `success`, `lessonIntro`, `openResponse`).
- **Reference config shape:** `src/config/wouldrather.json` — `{ courseId, courseName, lessons: [{ lessonId, recapSources, recapOverlay, title:{en,…}, unit, mission:{en,…}, steps:[…] }] }`. Generated output matches this shape but with `en` only.
- **`model-config.test.js` globs all `src/config/*.json`** — generated configs must satisfy its invariants (canonical recap values; friend-slug steps in a `recapSources: "friend"` lesson). This is the one existing guard a generated file can actually break; the generator's tests assert both invariants.
- **SRT format:** the pipeline's `srt` column is the JSON-escaped SRT form (`video_pipeline.py` `to_json_subtitle_string`: `\n`→`\\n`, `"`→`\\"`). `src/config` stores literal newlines. The generator must un-escape JSON-string escapes only, not generic backslashes, so a literal backslash in a subtitle survives.
- **`SimpleVideoStateController.initSubtitles`** (`simple-video-controller.js:54-88`) treats a string containing `-->` as timed cues, otherwise static text — so both `srt`-sourced and `subtitle_text`-sourced values render correctly with no config change.
- **Source-guard rules (AGENTS.md):** new guards must be provably failable; do not comment-strip before URL assertions; scope slice-based guards to the specific block; end function-body slices at the next top-level marker. The contract test's allow-list starts empty and is exercised against an injected fixture so it has live coverage now.
- **`src/**` guard:** any new test under `src/` must not mention the literal `recorder.html`/`/recorder` token (the `recorder-page.test.js` scanner); the contract test in `src/config/` must not reference it, and the CLI-URL source guard lives under `scripts/`, not `src/`.

## Notes

- Manual/operator-invoked only: not added to `package.json` scripts' critical path or `.github/workflows`/`deploy.yml`. Optionally add an `npm run configs:generate` script, but it must not run on `pretest`, `predeploy`, or `deploy` (it fetches the network and is not deterministic in CI).
- The local Windows flow and all existing configs are untouched: the generator only creates new files and refuses to overwrite.
- The recorder/pipeline/Modal work on `main` is unaffected: this story reads the sheet and writes configs; it does not touch `public/recorder.html`, `docs/video-pipeline/**`, `functions/**`, or R2.
- Before trusting the contract guard and the CLI URL guard, prove each can fail (inject an `es` key / alter the URL) per AGENTS.md.
- **Implemented shape:** pure module `scripts/lib/sheet-config-utils.js` (+ tests) exports `parseCsv` (RFC-4180-ish), `isVideoRow`, `unescapeSrt`, `buildSteps`, `buildCourseConfig`, `isValidCourseId`, and the `RESPONSE_TYPES`/`RECAP_SOURCES`/`RECAP_OVERLAYS` vocabularies; CLI `scripts/generate-config-from-sheet.mjs` (+ tests) does fetch/fs/argv. `npm run configs:generate` added; it is not on `pretest`/`predeploy`/`deploy`. Contract guard `src/config/generated-config-contract.test.js` reads the (currently empty) `scripts/lib/generated-configs.json` allow-list and is exercised against an in-memory fixture. Verified guards can fail: the contract guard (defaced en-only check → 2 tests red), the vocabulary-parity guard (drifting `RECAP_SOURCES` → red), and the CLI URL guard (asserts the recorder literal on raw source).
- **Review-round hardening (post-implementation):** (1) `courseId` is validated against `COURSE_ID_PATTERN` before it becomes a filename — a URL-sourced `../evil` is rejected (path-traversal guard, behaviorally tested); (2) the CLI appends the new `courseId` to `scripts/lib/generated-configs.json` after a successful **default-path** write, so the contract guard actually covers generated configs — a `--out`/test run never touches the tracked allow-list (`GENERATED_CONFIGS_ALLOWLIST`/`CONFIG_OUT_DIR` are the test seams); (3) `cueFor` now errors on conflicting single `cue` values within a group instead of silently taking the first; (4) the contract guard walks the known translation slots (`title`/`mission`/`cue`/`subtitles`) instead of keying on `en`'s presence, so a `{es:…}`-only object is caught (with a test).
- **Excel column naming:** the sheet's real header for the step-order column is `Order` (capital O), which the parser lower-cases to `order`; the operator must ensure these columns exist: `course_id, course_name, lesson_id, lesson_title, recap_sources, recap_overlay, unit, mission, response_type, video_file, filename, order, cue, cue_alt, subtitle_text, srt`.
