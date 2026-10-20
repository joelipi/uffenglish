# Generate the ABABAB config shape, and make the toolchain course-agnostic

## Context

`src/config/wouldyourather-test.json` is the hand-written model of the config the
generator should produce (story 075). The generator
(`scripts/generate-config-from-sheet.mjs` + `scripts/lib/sheet-config-utils.js`) still
emits the old shape, and the whole toolchain is hardcoded to one course.

Two things must change:

1. **The output format.** The generated config must be the ABABAB shape: every lesson
   after the first is respond-then-record, steps are per *take*, `chooseStep` is nested
   (2 groups × 4 leaves), and a step's subtitle is the phrase it speaks.
2. **Course-agnostic.** "Hundreds of JSONs": duplicating `wouldyourather.source.txt`,
   renaming it and editing the values must be enough. Nothing may name one course.

### The authoring loop (unchanged)

The author edits `*.source.txt` → `source-to-csv.yml` converts it to
`public/*.master.csv` → `translate-master.yml` fills the translations in the CSV → the
Modal render reads **that same CSV** and renders the videos → `sync-srt.yml` writes the
measured SRT back into the CSV → `configs.yml` runs the generator to write
`src/config/<courseId>.json`. The CSV is the shared middle: the same rows drive the
render and the config.

### The lesson chain is derived, never authored

The author writes each phrase once. The chain falls out of the `pairs` order:

| lesson | respond phase (answers) | record phase (records) |
|---|---|---|
| pair 1 ask | — (no previous set) | pair 1's questions |
| pair 1 answer | pair 1's answers | pair 1's questions |
| pair 2 ask | pair 1's answers | pair 2's questions |
| pair 2 answer | pair 2's answers | pair 2's questions |
| pair 3 ask | pair 2's answers | pair 3's questions |
| pair 3 answer | pair 3's answers | pair 3's questions |

Rule: **a pair's ask lesson answers the previous pair's answer set; every pair's answer
lesson answers its own answer set; a lesson always records its own pair's question set.**
The first pair's ask lesson has no respond phase (there is no previous set).

Each video set is therefore used by two lessons — set 1's answers by lessons 2 and 3, set
2's questions by lessons 3 and 4 — and the second use is what makes the chain continuous.

## The CSV contract (new)

The CSV stays **one row per take**, so the render's row set (and its per-row work) is
untouched. The bridge adds five structural columns, and the generator derives the
placements from them:

| column | meaning |
|---|---|
| `pair_index` | 1-based pair number |
| `set_role` | `question` (the pair's question takes) or `answer` (its answer takes) |
| `topic_index` | 1-based topic within the set |
| `group_index` | 1-based group within the topic (questions: the phrasing itself; answers: the option) |
| `variant_index` | 1-based take within the group (the phrasing) |

Plus a course-level `tags` column (a pipe-separated list on every row).

## Implementation

### 1. The source file

- Add a course-level `tags` array (the generated `wouldyourather.json` has a
  hand-added `tags` today that a regeneration silently drops — the generator must emit
  it).
- Everything else stays: the author still writes each phrase exactly once.

### 2. The bridge (`scripts/lib/source-bridge-utils.js`)

- Emit `pair_index`, `set_role`, `topic_index`, `group_index`, `variant_index` on every
  row, plus `tags`.
- The row count is unchanged (153 rows, 108 takes) — the render sees exactly the same
  rows it saw before.

### 3. The generator (`scripts/lib/sheet-config-utils.js`, master path)

- Build the lessons from the derived chain (see the table above) instead of from the
  row order.
- One step per **take**: `simpleVideoUrl` = the take slug (`filename`), not the group
  (`video_file`).
- `chooseStep` becomes **nested**: the respond branching is 2 groups × 4 leaves (group
  labels from `choose_step_text`, leaf labels from the answer takes' phrases); the
  ask/record branching is 4 flat leaves (labels from the question takes' phrases).
- The routing (`nextStep` on steps and on leaves) is **computed** from the new step
  order, not read from `next_step` / `choose_step_next` — those columns describe the
  old layout.
- Subtitles: the step's own PHRASE — a plain string with no timings, which the player
  shows for the video's whole length. The sheet's `srt` describes the take-GROUP, so a
  take step must not use it (that was the 4-cue-on-a-2.8s-video defect).
- Emit `tags` from the source.
- `publishLessonId`: the namespace of the **video set** the step plays, when that
  differs from the lesson's own id.
- `recapSources`: `friend` when the lesson plays a friend clip (derived from the
  steps), else the sheet's value — a pair's ask lesson also answers the previous
  pair's clips, so the sheet's per-set column would be wrong for it.

### 4. Course-agnostic toolchain

Remove every hardcoded course name:

| file | now | becomes |
|---|---|---|
| `scripts/generate-master-csv.mjs` | `MASTER_CSV_REL = 'public/wouldyourather.master.csv'`, default source `wouldyourather.source.txt` | `masterCsvRelFor(sourcePath)` derives `public/<course>.master.csv`; `defaultSourcePath()` finds the repo's `*.source.txt` |
| `scripts/generate-config-from-sheet.mjs` | `MASTER_CSV_REL` | `MASTER_CSV_GLOB = 'public/*.master.csv'` + `masterCsvPaths()` |
| `scripts/translate-master-csv.mjs` | defaults to the one master CSV | loops over every master CSV |
| `scripts/write-srt-to-csv.mjs` | defaults to the one master CSV | loops over every master CSV (the step keys are course-prefixed, so one course's SRTs cannot land in another's) |
| `.github/workflows/translate-master.yml` | `add-paths: public/wouldyourather.master.csv` | `public/*.master.csv` |
| `.github/workflows/sync-srt.yml` | `add-paths: public/wouldyourather.master.csv` | `public/*.master.csv` |
| `docs/video-pipeline/pipeline_lib.py` | `MASTER_CSV_URL` points at one course | `master_csv_url(course_id)`; `PIPELINE_SHEET_URL` still overrides it |
| `public/recorder.html` | `spreadsheet_url = 'wouldyourather.master.csv'` | `?course=<id>` (REQUIRED; the same-origin path is derived from it) |
| `functions/api/pipeline/render.js` | the render spec carried only `files` | it also carries `course`, validated as a slug (it goes into the CSV's URL path) |
| `docs/video-pipeline/trigger_app.py` | the spec needed only `jobId` + `files` | it also requires `course` |
| `docs/video-pipeline/modal_app.py` | `resolve_sheet_url()` with no course | `resolve_sheet_url(course_id=spec['course'])` |

### 5. `--require-videos` (unchanged semantics)

It still holds a whole course out of the config until every step's video has been
rendered — the gate reads the `srt` column, which the render fills. It keeps working
because a take's group carries the `srt`.

## Verification

- The generated `src/config/wouldyourather.json` and the hand-written
  `src/config/wouldyourather-test.json` agree **step for step** (deep equality, with
  the model's friend-UGC slugs normalized to the real course) — 0 differing steps
  across all six lessons.
- Duplicating the source file was run end to end: `mynewcourse.source.txt` →
  `public/mynewcourse.master.csv` → `src/config/mynewcourse.json` (16/43/43/43/43/43
  steps, `mynewcourse-a-01-01` takes, `{friendCode}{selfCode}-mynewcourse-a-01`
  friend clips) with no code change. The proof course was removed afterwards.

## Tests

- `src/config/ababab-generated-contract.test.js` (new) — the generated config and the
  hand-written model agree step for step, the tags match the source, every response
  step plays a take with a 6-locale plain-phrase subtitle, and no step references a
  take-group video.
- `scripts/lib/source-bridge-utils.test.js` — the round-trip through the real
  generator now asserts the new shape (one take per step, a nested branch, the
  republish step's take slug).
- `src/config/wouldyourather.test.js` — the generated file's subtitles are plain
  phrases now, so the "parses as timed SRT" assertions became "is a plain phrase
  equal to its cue".
- `src/modules/video/model-config.test.js` — lesson b's branch is nested now.
- `scripts/lib/poster-utils.test.js` — the intro slugs are the takes.
- `docs/video-pipeline/tests/test_pipeline_parity.py` — the three readers' DERIVATION
  must agree, and the guard is still proven failable.
- `scripts/generate-config-from-sheet.test.js` — the glob pin, with the mutation fixed
  to `replaceAll` (the filter appears twice, so mutating one left the guard green).

## The recorder picks its course from a dropdown

The studio never named a course, so working on a second one meant editing
the page. It now lists the courses the repo can author:

- `public/courses.json` — `{ "courses": [...] }`, generated from the repo's
  `*.source.txt` files by `scripts/generate-course-index.mjs`
- the studio fetches that index and fills a **Course** dropdown (first in the
  setup panel, on its own row)
- the chosen course is what the studio reads, uploads for, and names on
  every render request, so the studio and the pipeline always agree
- `?course=<id>` still wins when present, and the choice is remembered for
  the session; a plain `/recorder` works again

## The bots are course-agnostic

Three workflow changes make the authoring/translation bots handle every course
rather than one named course:

- `sync-srt.yml` / `translate-master.yml` — commit EVERY course's master CSV
  (`public/*.master.csv`), not one named course's. Without it a second
  course's SRTs and translations are never committed.
- `source-to-csv.yml` — regenerate `public/courses.json` whenever the
  authoring flow runs, so a new course appears in the recorder's picker
  without a separate step.

The render's one-click chain also needs the dispatch credentials, which live
in the Modal `uff-github` secret (`GH_DISPATCH_REPO` / `GH_DISPATCH_TOKEN`) —
the pipeline reads nothing else from it, so it holds exactly those two keys.

## Out of Scope

- The video render's internals (per-course Modal deployments, batching several
  courses into one render). What it needed from this story was the COURSE: it now
  travels with the render (recorder -> render Function -> trigger -> orchestrator ->
  `master_csv_url(course_id)`), because a render that fetched a default course's
  rows would silently render the wrong course's takes. `PIPELINE_SHEET_URL` still
  overrides the URL entirely.
- The eight hand-authored `src/config/*.json` files.
- `wouldyourather-test.json` stays as the hand-written test course.
- The render's internals: one Modal deployment per course, and batching
  several courses into one render.
