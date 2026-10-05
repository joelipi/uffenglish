# One master sheet: the overlay master drives both the video pipeline and the app config (plus SRT write-back)

## Context

The operator's real production sheet is the **overlay master** (`title_text, Order, phrase, subtitle_text, character, directions, props, previousline, filename, join, video_file, …`), read by `public/recorder.html:886` and by `docs/video-pipeline/video_pipeline.py` (which renders the videos and writes an SRT into the CSV `srt` column). The operator's mental model — stated explicitly — is **one master spreadsheet for both the video and the app config**. That is not true today: `scripts/generate-config-from-sheet.mjs` requires the *authoring-sheet* columns (`course_id, course_name, lesson_id, lesson_title, response_type, video_file, filename, order`, plus optional `unit, mission, cue, cue_alt, subtitle_text, srt, recap_sources, recap_overlay`) and cannot read the overlay master, which lacks every config column.

The current live master is a different spreadsheet from the one the tooling hardcodes: spreadsheet id `1Lfoj7yLyGtgDKIuq8SQvQ8ZK5KpwlJzeAcHEBLzjV6o`, gid `242913338`, published CSV `https://docs.google.com/spreadsheets/d/e/2PACX-1vQZ7jFMJNnmylDoHxaqb1W8VyXi0OV4pSubCbqMGYkRgGimqWx3cs74n43-cFxqfue4KCiqWlhzvPkK/pub?gid=242913338&single=true&output=csv`. The generator (`SHEET_URL`), the translator (`PUBLISHED_GID = 289451687`) and the recorder (`spreadsheet_url`) all still point at the old sheet (gid `289451687`), so none of them read the operator's current data.

This story makes the master sheet the single source: it adds the config-only columns to the master (operator-filled, pre-filled where a value is genuinely fixed), teaches the generator to read the master's shapes (a per-row `phrase` → the app's cue **array**; `join` → the joined step; `srt` → the app subtitles; `intro_video`/`success_video` → synthesized intro/success steps), repoints all three consumers at gid `242913338`, and adds the SRT write-back path (the pipeline persists the computed `srt`; a GitHub Action writes it into the sheet for record-keeping).

The live master today: 108 rows, 24 columns, only 8 populated (`title_text, Order, character, phrase, filename, join, video_file, subtitle_text`). 27 `video_file` groups × 4 takes (`Order` 01–04). Six lessons a–f, three topics each; lessons a/c/e are single question videos, lessons b/d/f are two option videos joined into one (`join` → `wouldyourather_b01`, `_ii` etc.).

## Out of Scope

- **No new translation transport and no change to the caption pipeline's behavior.** This story extends the existing DeepSeek client only if `phrase` translation is included; it never adds a second client.
- **No SRT localization.** SRT timing localization stays the caption pipeline's job; the sheet carries the English SRT, and `success_srt_<lang>` is consumed when present but not produced here.
- **No change to the video render path, R2 layout, or Modal stages.** The only pipeline change is persisting the already-computed `srt` column to R2 so the write-back Action can read it.
- **No automatic `repository_dispatch` from Modal.** The SRT write-back Action is manual (`workflow_dispatch`) and accepts a `repository_dispatch (render-complete)` trigger for a later wiring, mirroring `configs.yml`.
- **No replacement of Google Sheets**, and no service-account key on the sandbox.
- **No derivation of config fields the operator chose to keep explicit** (`course_id, course_name, lesson_id, lesson_title, response_type, unit, mission, recap_sources, recap_overlay`): these are columns, not inferred, per the operator's decision. The only derived values are ones that are literally the data (`phrase` → cue array) or fixed (`success_video`/`success_srt` pre-fill).
- **No changes to `friendchain.json` / `wouldrather.json`** beyond using them as the reference for the friend-chain `{friendCode}` intro pattern and the success SRT.
- **No `--force`-style overwrite of the operator's sheet content** beyond the `srt` column (which is machine-derived) and the new config columns being added.

## Implementation approach

### 1. Master format detection and the column contract (decision)

The generator must read both the existing authoring-sheet shape and the overlay-master shape. **Decision:** format is detected from the header — `isMasterFormat(headers) === headers.includes('phrase')`. In master format the generator uses the master rules in §2–§4; otherwise it behaves exactly as today.

**Config columns the operator adds to the master** (the generator reads them first-non-blank across the course/lesson/step rows, so they are filled once, not per take):

| Column | Scope | Required | Notes |
|---|---|---|---|
| `course_id` | course | yes | operator-filled |
| `course_name` | course | yes | operator-filled |
| `lesson_id` | lesson | yes | operator-filled |
| `lesson_title` | lesson | yes | operator-filled |
| `response_type` | step | yes | operator-filled; `RESPONSE_TYPES` enum |
| `unit` | lesson | no | |
| `mission` | lesson | no | |
| `recap_sources` | lesson | no | `RECAP_SOURCES` enum; default `none` |
| `recap_overlay` | lesson | no | `RECAP_OVERLAYS` enum; default `shareCta` |
| `intro_video` | lesson | no | the `lessonIntro` step's `introBackgroundVideoUrl` |
| `success_video` | course | no | the `success` step's `simpleVideoUrl` |
| `success_srt` | course | no | the `success` step's English subtitle text |
| `success_srt_es` / `_pt` / `_bn` | course | no | optional localized success subtitles |
| `srt` | step | no | English SRT; pipeline-written (see §6) |

Existing master columns are reused: `Order` → `order` (the parser lower-cases headers), `video_file`, `filename`, `join`, `phrase`. `title_text` is not consumed by the config generator (course naming is the `course_name` column), and `subtitle_text` is read only to be ignored as app subtitles (§4).

### 2. Step identity: `join` wins, else `video_file` (decision)

In master format a step is **one video**: the `join` value when non-blank, else the `video_file` value. `step.simpleVideoUrl` is that value. This makes `wouldyourather_b01_i` + `wouldyourather_b01_ii` (both `join=wouldyourather_b01`) one step whose URL is the join value — the published slug. The app step order within a lesson is the first-seen order of the groups (the master's `Order` is take order, not step order); the generator does not sort master steps by `order`.

### 3. The app cue is an ordered array built from `phrase` (decision)

For a master step, `step.cue` is an **array of `{en, es?, pt?, bn?}` objects**, one element per row of the step in take order (`Order` ascending; groups concatenated in first-seen order for a joined step). Length is variable (ask lessons ≈ 4; answer lessons with both options ≈ 8). Each element's English is that row's `phrase`; `phrase_es`/`phrase_pt`/`phrase_bn` supply the localized value when present. This is the overlay-master form of the authoring sheet's `cue_alt` array, and the app already consumes it: `getCueText` shows element [0] (basic), `answers.js`/`findMatchingCueText` match the response against every element, and `getLocalizedCueTranslation` localizes the matched one.

### 4. App subtitles come from `srt` only (decision)

In master format `step.subtitles` is built from the group's `srt` column (English), localized by `srt_<lang>` if present. The master's `subtitle_text` is the **burnt-in English overlay markup** (`<aside>🅰1️⃣…</aside>`) and is **never** used as app subtitles: in master format `subtitlesFor` must not fall back to `subtitle_text`. A group with no `srt` emits no `subtitles` (rather than overlay markup).

### 5. Synthesized `lessonIntro` / `success` steps (decision, Option A)

Master rows do not include intro/success steps. When the corresponding columns are present, the generator **prepends** a `lessonIntro` step per lesson and **appends** a `success` step per lesson:

- `lessonIntro`: `{ cue: "", responseType: "lessonIntro", introBackgroundVideoUrl: <intro_video> }` (omitted when `intro_video` is blank).
- `success`: `{ responseType: "success", simpleVideoUrl: <success_video> }` plus `subtitles` from `success_srt`/`success_srt_<lang>` (omitted when `success_video` is blank).

### 6. SRT write-back: pipeline persists, Action writes the sheet (Option B)

Today `video_pipeline.write_srt_column` writes the computed SRT into the CSV it read, and the Modal run (`docs/video-pipeline/modal_app.py` `orchestrator`) **never uploads that CSV back** — the cloud SRT is lost. Change:

1. **Modal persists** the updated `video_data.csv` (now carrying the `srt` column) back to R2 at the same `pipeline-assets/video_data.csv` key after concatenation (`storage.upload_file`). One extra upload; no stage change.
2. **A GitHub Action** (`.github/workflows/sync-srt.yml`) downloads that CSV from R2 (via the existing Cloudflare/wrangler credentials) and runs a Node script that writes the `srt` column into the master sheet with one `spreadsheets.values.batchUpdate` (`valueInputOption: 'RAW'`), reusing the 049 service-account path.
3. **Overwrite `srt` unconditionally** — it is derived, so blanks-only does not apply. Rows are matched by `filename`; the script writes each group's SRT to every row of that group's `video_file` (matching `write_srt_column`'s per-group value).

### 7. Repoint the three consumers (decision)

- `scripts/generate-config-from-sheet.mjs` `SHEET_URL` → the new published URL (gid `242913338`).
- `scripts/translate-sheet.mjs` `PUBLISHED_GID` → `242913338`.
- `public/recorder.html` `spreadsheet_url` → the new published URL.
The existing source guards that pin `SHEET_URL` (against `public/recorder.html`) must be updated to the new literal, kept in sync.

### 8. Pre-filled CSV (decision)

Because the sandbox has no Google credentials, the operator uploads the columns/values by hand. Provide `scripts/seed-master-columns.mjs` that fetches the published master CSV, appends the new config columns, and pre-fills: `success_video = success` and `success_srt` = the standard friend-lesson success SRT (identical in `wouldrather.json` and `friendchain.json`), plus `intro_video` following the friend-chain `{friendCode}` pattern (with the first lesson's intro a plain `intro` slug). It writes a CSV the operator imports; it performs no sheet write. Other config columns are emitted blank for the operator to fill.

## Tasks

### Task 1 - Pure master-format parsing in `sheet-config-utils.js`

- `isMasterFormat(headers)` + a header containing `phrase`
  - → returns true; a header with `cue`/`cue_alt` and no `phrase` → false
- `buildCourseConfig` over master rows with `phrase` on 4 rows of one `video_file`, `Order` 01–04
  - → the step's `cue` is an array of 4 `{en}` objects in `Order` order
  - → the array length varies with the row count (1, 4, and 8-row fixtures each yield that length)
- master rows with `phrase` + `phrase_es`/`phrase_bn` on some rows
  - → each cue element is `{en, es?, bn?}` with the localized key omitted when blank
- master rows where two `video_file`s share `join = wouldyourather_b01`
  - → one step whose `simpleVideoUrl === "wouldyourather_b01"`, cue array spanning both groups in first-seen order
- master rows with `srt` on the group
  - → `step.subtitles === { en: <unescaped srt> }`
- master rows with non-blank overlay `subtitle_text` and no `srt`
  - → `step.subtitles` is undefined (overlay markup is never used)
- master rows with `intro_video` on a lesson
  - → the lesson's first step is `{ cue: "", responseType: "lessonIntro", introBackgroundVideoUrl: <value> }`
- master rows with `success_video` + `success_srt`
  - → the lesson's last step is `{ responseType: "success", simpleVideoUrl: <value>, subtitles: { en: <value> } }`
- master rows with a blank `intro_video` / `success_video`
  - → no synthesized step is emitted for it
- an authoring-sheet header (no `phrase`)
  - → output is byte-identical to today (existing tests stay green)

### Task 2 - Generator CLI reads the master

- `scripts/generate-config-from-sheet.mjs` with `SHEET_URL` repointed to gid `242913338`
  - → the existing source guard for `SHEET_URL` (pinning it to `public/recorder.html`) is updated and passes
- a master CSV fixture with the config columns filled
  - → writes a valid `src/config/<courseId>.json` whose lessons/steps match the fixture
- a master CSV missing a required config column (`course_id`/`lesson_id`/`lesson_title`/`response_type`)
  - → reports it via `findMissingColumns` (never reports the optional new columns)

### Task 3 - Repoint the recorder + translator

- `public/recorder.html` `spreadsheet_url`
  - → contains gid `242913338` (source-guarded)
- `scripts/translate-sheet.mjs` `PUBLISHED_GID`
  - → `242913338` (source-guarded)
- a guard asserting `SHEET_URL` and the recorder URL are the same published URL
  - → passes after both are updated

### Task 4 - `scripts/seed-master-columns.mjs` pre-filled CSV

- run against the published master CSV
  - → output header contains every new config column
  - → every row has `success_video = success` and a non-blank `success_srt` equal to the `wouldrather.json` success `subtitles.en`
  - → each lesson's rows carry the `intro_video` value for that lesson
  - → `course_id`/`course_name`/`lesson_id`/`lesson_title`/`response_type` cells are present (blank where not pre-filled)
- the emitted CSV parsed by `parseCsv` + `buildCourseConfig`
  - → still generates a structurally valid course (once the operator fills the required blanks)

### Task 5 - SRT write-back (pipeline persists + Action writes the sheet)

- `docs/video-pipeline/modal_app.py` after concatenation
  - → uploads the updated `video_data.csv` to `pipeline-assets/video_data.csv`
- `scripts/write-srt-to-sheet.mjs` with an injected Sheets client and a CSV carrying `srt`
  - → issues exactly one `values.batchUpdate`
  - → each group's SRT is written to every sheet row of that group's `video_file` (matched by `filename`)
  - → `valueInputOption === 'RAW'`
  - → a second run with identical input is idempotent (same values written; no error)
- `scripts/write-srt-to-sheet.mjs` with a group whose `srt` is blank
  - → writes nothing for that group (does not clear the cell)
- `.github/workflows/sync-srt.yml` source guard
  - → contains `workflow_dispatch`, `repository_dispatch` (`render-complete`), the Cloudflare R2 credentials, `secrets.GOOGLE_SERVICE_ACCOUNT_JSON`, `vars.GOOGLE_SHEET_ID`/`secrets.GOOGLE_SHEET_ID`, `node scripts/write-srt-to-sheet.mjs`; does not contain `git commit`/`git push`/`GH_NEW_TOKEN`
  - → each pinned token, when mutated, makes the guard throw

### Task 6 - Translate `phrase` (cue localization)

- `TRANSLATABLE_FIELDS` gains `phrase` (step-level, per-row)
  - → `localizedColumn('phrase','es') === 'phrase_es'`
- `planSheetTranslations` over master rows
  - → plans `phrase_<lang>` for every row with a non-blank `phrase` and a blank target (per row, not per group)
  - → a filled `phrase_<lang>` is skipped (blanks-only), unless `--force`
- the translate CLI against a master sheet
  - → writes `phrase_es`/`phrase_pt`/`phrase_bn` cells and leaves `subtitle_text` untouched
- the authoring-sheet path
  - → unchanged (no `phrase` column → no plan)

## Technical Context

- **Live master:** spreadsheet id `1Lfoj7yLyGtgDKIuq8SQvQ8ZK5KpwlJzeAcHEBLzjV6o`, gid `242913338`, published CSV `2PACX-1vQZ7jFMJNnmylDoHxaqb1W8VyXi0OV4pSubCbqMGYkRgGimqWx3cs74n43-cFxqfue4KCiqWlhzvPkK`. Columns: `title_text, Order, app-repeat, app-ai, mirror, background, character, phrase, directions, props, effect, bgSound, endSoundEffect, h3, previousline, filename, join, video_file, footer_text, bgMusic, subtitle_text, foreground, overlay, image`. Only 8 carry data; `join` is set on lessons b/d/f (`wouldyourather_b01`…).
- **Generator field/enum definitions:** `REQUIRED_COLUMNS`, `RESPONSE_TYPES`, `RECAP_SOURCES`, `RECAP_OVERLAYS`, `isVideoRow`, `buildCourseConfig`, `buildSteps`, `cueFor`, `subtitlesFor`, `parseCsv` all live in `scripts/lib/sheet-config-utils.js`; the CLI is `scripts/generate-config-from-sheet.mjs`.
- **Translator:** `scripts/lib/sheet-translate-utils.js` (`TRANSLATABLE_FIELDS`, `planSheetTranslations`, `buildBatchUpdatePayload`, `rowsFromValues`) + `scripts/translate-sheet.mjs`; service account scope `https://www.googleapis.com/auth/spreadsheets`; secret `GOOGLE_SERVICE_ACCOUNT_JSON`; repo variable `GOOGLE_SHEET_ID`.
- **Video pipeline SRT:** `docs/video-pipeline/video_pipeline.py` `build_group_srt` (1483), `to_json_subtitle_string` (1576), `write_srt_column` (1582, called at 1765). The pipeline does not consume the `Order` column; group order is by filename natural sort.
- **Modal:** `docs/video-pipeline/modal_app.py` `orchestrator` (102) downloads `pipeline-assets/video_data.csv` (79) and calls `storage.upload_file`/`upload_json`; `storage.py` routes `pipeline-assets/` to the private bucket via `R2_*` env.
- **Existing R2/Cloudflare secrets in Actions:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (`.github/workflows/deploy.yml`); `configs.yml` accepts `repository_dispatch (render-complete)`.
- **Reference configs:** `src/config/wouldrather.json`, `src/config/friendchain.json` — friend-chain intros are `{friendCode}<courseId>-<lessonId>-response-NN`; `success` uses `enda` with the same localized SRT in both.
- **Guard hygiene (`AGENTS.md`):** assert raw source (no comment stripping — URLs contain `//`); scope whole-file assertions to tokens that appear once; prove every guard can fail by mutation. New `src/**` files must not mention `/recorder`/`recorder.html`.
- **Node 20 / deps:** no new npm dependency is required (global `fetch`; `googleapis@178.0.0` already added by 049).

## Notes

- **Pre-fill assumptions for review:** `success_video = success` and `success_srt` = the `wouldrather.json` success `subtitles.en`. `intro_video` follows the friend-chain pattern adapted from `wouldrather`, with the first lesson's intro a plain conventional slug: `a → intro`, `b → {friendCode}wouldyourather-a-response-01`, `c → {friendCode}wouldyourather-b-response-04`, `d → {friendCode}wouldyourather-c-response-04`, `e → {friendCode}wouldyourather-d-response-04`, `f → {friendCode}wouldyourather-e-response-04`. These are a starting point the operator edits in the sheet; the story only requires that `intro_video`/`success_video`/`success_srt` are explicit columns and are pre-filled.
- **The operator fills the required config columns once** (`course_id`, `course_name`, `lesson_id`, `lesson_title`, `response_type`); the generator reads them first-non-blank, so they are not repeated per take. `recap_sources`/`recap_overlay` default as today.
- **`subtitle_text` is overloaded** (overlay markup on the master vs app subtitles on the authoring sheet); the format detection in §1 is what prevents cross-contamination, and master subtitles come only from `srt`.
- **The published CSV lags an API write** (Google re-publishes after a Sheets API update), so a config run immediately after the SRT write may read a stale `srt`; the write-back is for record-keeping and the next run picks it up.
- **No sheet write from the sandbox.** The pre-fill is a CSV the operator uploads; the only automated sheet writers are the 049 translate Action and the new sync-srt Action, both with the service account.
