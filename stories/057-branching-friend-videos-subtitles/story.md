# Never show app subtitles over a friend-recorded clip

## Context

`wouldyourather` lesson `b` opens with a `branching` step whose `simpleVideoUrl` is `{friendCode}wouldyourather-a-response-01` — the friend's recorded question, a UGC clip published per-segment with its speaker's caption **burned into the video** (stories 035/036). The committed `src/config/wouldyourather.json` also gives that step a `subtitles` object, so `SimpleVideoPlayer` draws the same SRT a second time over the clip.

Where the field comes from: on the overlay master (gid `242913338`) the lesson-`b` row with `video_file = {friendCode}wouldyourather-a-response-01` (`response_type` `branching`, `order` `1`, no `join`, **no `filename`**) has a non-blank `srt` column (and `srt_es`/`srt_pt`/`srt_bn`). The generator groups that one row into one step and `buildMasterSteps` → `srtSubtitlesFor` emits `step.subtitles` from `srt`, which is why the app shows the caption.

**The `srt` cell is machine-written, so deleting it does not stick.** `scripts/write-srt-to-sheet.mjs` `planSrtWrites` matches sheet rows to rendered groups **by `filename`**, and the master has several `filename`-less rows. The rendered `wouldyourather_a01` group's config-only rows (lesson `b`, rows 17-20) are `filename`-less too, so they set the map's `''` key to `wouldyourather_a01`'s SRT; every `filename`-less sheet row — the branching row and the `intro` rows — then matches `''` and is overwritten with a01's SRT. Running the repo's own `planSrtWrites` against the live master plans a write to the branching row (sheet row 7) with a01's SRT, and `sync-srt` runs on every render. The stray value comes straight back.

Every other friend-clip step in every `src/config/*.json` (`wouldrather`, `friendchain`, `test`, `friend`) already has **no** `subtitles`; this one is the sole exception. Two fixes are needed: the write-back must stop stamping a rendered group's SRT onto unrelated rows, and the generator must stop emitting `subtitles` for a friend UGC step regardless of the sheet cell. A `row_purpose` informational column is added to the master so the operator can see what each row produces without reverse-engineering the generator.

## Out of Scope

- No player/runtime change: `loadVideoForStep` keeps mapping `step.subtitles` straight to the player. The generator is authoritative (it overwrites configs) and a config test guard enforces the invariant over every course, so a runtime guard would duplicate the rule in two places.
- No required sheet edit — after the write-back fix the operator *may* clear the branch row's `srt` cell (it then stays clear), but the generator guard makes that unnecessary.
- No change to `srt` behavior for system/teacher steps (they keep app subtitles) and no change to the recap (story 036 already nulls a friend clip's recap subtitle).
- `row_purpose` is **master-only**: the authoring sample (`scripts/write-sample-sheet.mjs` / `docs/video-pipeline/sample-sheet.csv`) is not changed, and the frozen `docs/video-pipeline/master-seeded.csv` snapshot is not regenerated (it is unreferenced and story 055 deliberately left it frozen).
- No new dependency.

## Implementation approach

### Sheet → config mapping (the answer to "which row makes which field")

On the overlay master a **step** is the `join` value when non-blank, else `video_file`; a step's rows are all rows sharing that key within the lesson. Per step:

| Master column(s) | Config field |
|---|---|
| `join` else `video_file` | step key → `simpleVideoUrl` (or `introBackgroundVideoUrl` for a synthesized `lessonIntro`) |
| `response_type` | `responseType` |
| `phrase` (ordered by `Order` within the step) | `cue` (array) |
| `srt` / `srt_<lang>` | `subtitles` (localized) — system steps only |
| `subtitle_text` | burnt-in overlay markup — never app `subtitles` |
| `next_step` | `nextStep` |
| `choose_step_next` + `choose_step_text` | `chooseStep` |

The friend row in question groups alone (`join` blank) under `video_file = {friendCode}wouldyourather-a-response-01`, and its `srt` was the column producing `steps[1].subtitles`.

### Fix 1 — generator omits `subtitles` for friend-video steps

A step whose key matches the shared friend/UGC convention `FRIEND_VIDEO_REGEX` (`/-response-\d+$/i`, `src/modules/video/video-source.js`) is a friend's published clip and must get **no** `subtitles`, regardless of `srt`/`srt_<lang>`/`subtitle_text`. Reuse `isFriendVideoSlug` in `scripts/lib/sheet-config-utils.js` and skip the subtitle call in both builders:

- `buildMasterSteps` (around line 485): `if (!isFriendVideoSlug(key)) { const subtitles = srtSubtitlesFor(stepRows, \`video_file "${key}"\`); if (subtitles !== undefined) step.subtitles = subtitles; }`
- `buildAuthoringSteps` (around line 554): guard the `subtitlesFor(groupRows, \`video_file "${videoFile}"\`)` call the same way with `videoFile`.

Skipping the call (rather than only dropping its result) also skips `srt_<lang>` timing validation for a friend step, so a stray/mistimed translation on a friend row can never skip the whole course.

### Fix 2 — `planSrtWrites` keys by step, not `filename`

`planSrtWrites` (`scripts/write-srt-to-sheet.mjs`) already builds `groupSrt` keyed by `groupKeyForRow` (`video_file || filename prefix`) — the same key `write_srt_column` rendered under. The defect is only the second hop: it re-maps through `filename`, so every `filename`-less sheet row collapses onto the `''` key. Replace the `byFilename` map with a direct `groupSrt` lookup by the sheet row's own key:

```js
const plan = [];
(rows || []).forEach((row, i) => {
    const value = groupSrt.get(groupKeyForRow(row));
    if (value === undefined || !value.trim()) return;
    plan.push({ row: i, sheetRow: sheetRows ? sheetRows[i] : i + 2, column: 'srt', value });
});
```

Consequences (all intended): a `filename`-less row is written only when its own `video_file` is a rendered group (so the lesson-`b` `wouldyourather_a01` rows keep tracking a01's SRT), the branching row and the `intro` rows are no longer written, and a cell is still never cleared (blank group SRT → no write). Joined steps keep working: `write_srt_column` puts the join's cumulative SRT on the sub-rows, so `groupSrt[subVideoFile]` is the joined SRT and the sub-rows match by their `video_file`.

### Fix 3 — `row_purpose` informational column on the master

`scripts/seed-master-columns.mjs` appends a `row_purpose` column (kept out of `CONFIG_COLUMNS` — it is informational, never consumed by the generator) and fills it per row with the config output that row produces. Derivation (`rowPurposeFor(row)`, exported for tests), non-blank columns only, joined with `; `:

- no `join` and no `video_file` → `no step key (missing video_file/join) — ignored`.
- else `step "<key>"`, then append each that applies:
  - `video_file` non-blank and no `join` → `→ simpleVideoUrl`; `join` non-blank → `→ joined step "<join>" (part "<video_file>")`.
  - `phrase` → `→ cue`; `choose_step_next`/`choose_step_text` → `→ chooseStep`; `next_step` → `→ nextStep`; `publish_lesson_id` → `→ publishLessonId`.
  - `intro_video` → `→ lessonIntro "<intro_video>"`; `success_video` → `→ success "<success_video>"`.
  - step key matches `FRIEND_VIDEO_REGEX` → `friend UGC clip — no app subtitles (caption burned in)`; else if `srt` non-blank → `→ subtitles`.

The generator ignores the column (unknown headers are not read); the seeded master is regenerated by re-running the seed script.

## Tasks

### Task 1 - Generator omits subtitles for friend-video steps

Files: `scripts/lib/sheet-config-utils.js`, `scripts/lib/sheet-config-utils.test.js`.

- master-format lesson, a `branching` step keyed by `video_file: '{friendCode}wouldyourather-a-response-01'` with a non-blank `srt` and a deliberately timing-inconsistent `srt_es` + `buildCourseConfig(rows)`
  - → the step has no `subtitles` key
  - → no throw (the friend step's `srt_es` is not validated)
- the same lesson containing a system step (`video_file: 'wouldyourather_b01_i'`, non-blank `srt`) + `buildCourseConfig(rows)`
  - → that step's `subtitles.en` equals `unescapeSrt(srt)` (unchanged)
- authoring-format lesson, friend `video_file: 'ab12-x-a-response-01'` with a non-blank `srt`
  - → the step has no `subtitles`
- authoring-format lesson, friend `video_file` with only a non-blank `subtitle_text` (no `srt`)
  - → the step has no `subtitles` (the `subtitle_text` fallback is skipped too)
- authoring-format lesson, system `video_file: 'my-response-video'` (contains `response`, not `-response-NN`) with a non-blank `srt`
  - → `subtitles.en` is set (no false positive)
- `buildCourseConfigs` over two courses where only one has a friend step with `srt`
  - → the friend course's step has no `subtitles`; the other course is unaffected
- `findMissingColumns` for a friend step with a blank `srt`
  - → `[]` for `srt` (not a required column; unchanged)

### Task 2 - SRT write-back keys by step key (no blank-`filename` collision)

Files: `scripts/write-srt-to-sheet.mjs`, `scripts/write-srt-to-sheet.test.js`.

- update the existing `planSrtWrites` fixtures to carry `video_file` (`{filename:'clip_a01', video_file:'group-a'}` etc.) + `planSrtWrites` with the CSV whose `group-a` carries an SRT and `group-b` is blank
  - → writes only rows 0 and 1, with `group-a`'s SRT (row 2 untouched; the existing expectation holds once the rows carry `video_file`)
- sheet row `{filename:'', video_file:'{friendCode}x-a-response-01'}` (the reported branching row) alongside a CSV whose `group-a` has an SRT + `planSrtWrites`
  - → the blank-`filename` row is **not** in the plan (the collision is gone)
- sheet row `{filename:'', video_file:'group-a'}` (a config-only row sharing a rendered step) + the same CSV
  - → the row **is** in the plan with `group-a`'s SRT
- a `join` step: CSV row `{join:'grp', video_file:'grp_i', srt:<joined>}` and sheet row `{filename:'grp_i01', join:'grp', video_file:'grp_i'}`
  - → the sheet row is written with the joined SRT
- `runWriteSrtToSheet` with the updated sheet rows
  - → still exactly one RAW `batchUpdate`, same ranges, and a blank group SRT still writes nothing (never clears)
- proven failable: reverting to the `filename`-based map makes the blank-`filename` branching row appear in the plan

### Task 3 - Committed config + all-config invariant

Files: `src/config/wouldyourather.json`, `src/modules/video/model-config.test.js`.

- read `src/config/wouldyourather.json`
  - → lesson `b`'s `branching` step (index 1) has no `subtitles` key
  - → its `simpleVideoUrl` (`{friendCode}wouldyourather-a-response-01`) and `chooseStep` are unchanged
- extend the `friend-slug invariant` describe over every `src/config/*.json`
  - → no step whose `simpleVideoUrl` / `introBackgroundVideoUrl` / `interactiveVideoUrl` matches `FRIEND_VIDEO_REGEX` has a `subtitles` key
  - → the guard is proven failable: adding a `subtitles` key to a friend-slug step throws
- full suite `npm test -- --run`
  - → passes, including `src/config/generated-config-contract.test.js` over the `wouldyourather` allow-list entry

### Task 4 - `row_purpose` informational column on the master

Files: `scripts/seed-master-columns.mjs`, `scripts/seed-master-columns.test.js`.

- `rowPurposeFor(row)` for a step-defining row (`video_file:'wouldyourather_a01'`, non-blank `phrase` and `srt`)
  - → contains `step "wouldyourather_a01"`, `→ simpleVideoUrl`, `→ cue`, `→ subtitles`
- `rowPurposeFor` for the branching row (`video_file:'{friendCode}wouldyourather-a-response-01'`, non-blank `srt`, `choose_step_next`/`choose_step_text`)
  - → contains `→ chooseStep` and `friend UGC clip — no app subtitles`
  - → does not claim `→ subtitles`
- `rowPurposeFor` for a `join` row, an `intro_video`/`success_video` row, a `next_step`/`publish_lesson_id` row, and a row with no `video_file`/`join`
  - → each mentions the matching field (`joined step`, `lessonIntro`, `success`, `→ nextStep`, `→ publishLessonId`, `no step key`)
- `buildSeededCsv(masterFixture(), { friendchain })`
  - → header contains `row_purpose` exactly once
  - → every content row's `row_purpose` is non-blank
  - → `row_purpose` is not in `CONFIG_COLUMNS` and not in `LOCALIZATION_COLUMNS`
- generator ignores the column: `buildCourseConfig(seededRows)` deep-equals `buildCourseConfig(rowsWithRowPurposeRemoved)`
  - → no `row_purpose` key appears anywhere in the built config

### Task 5 - Docs

Files: `docs/video-pipeline/authoring-sheet.md`, `docs/product.md`, `scripts/generate-config-from-sheet.test.js`.

- `docs/video-pipeline/authoring-sheet.md` gains an "Overlay master → config fields" section with the mapping table, the `join`/`video_file` grouping rule, the `row_purpose` column (what it shows, that it is informational/ignored), and the rule that a step whose clip ends in `-response-NN` gets no `subtitles` because its caption is already burned in
- `docs/product.md` Features gains an entry for the app behavior (link `stories/057-branching-friend-videos-subtitles/story.md`) and an authoring entry for the `row_purpose` column / collision-free write-back
- a source-guard test in `scripts/generate-config-from-sheet.test.js` (raw source, no comment stripping) asserts the pinned doc tokens (mapping section `join`/`video_file` wording, `row_purpose`, the `-response-NN` no-`subtitles` rule, and the product entries + story link) and is proven failable per token

## Technical Context

- No new dependencies. Unit tests: `npm test -- --run` (vitest 4.1.6 + jsdom 29.1.1, colocated `*.test.js`).
- `FRIEND_VIDEO_REGEX`/`isFriendVideoSlug` live in `src/modules/video/video-source.js` (pure — no browser globals). `scripts/lib/pipeline-assets-utils.js` already imports from `src/modules/video/`, so `scripts/lib/sheet-config-utils.js` importing `../../src/modules/video/video-source.js` (and `seed-master-columns.mjs` importing `../src/modules/video/video-source.js`) matches precedent.
- Generator grouping: `groupMasterRowsByKey` (master; key = `join || video_file`) and the `video_file` group loop in `buildAuthoringSteps`. Subtitle helpers: `srtSubtitlesFor` (master; `srt` only) and `subtitlesFor` (authoring; `srt` else `subtitle_text`).
- Write-back: `groupKeyForRow`/`groupPrefixForFilename`/`planSrtWrites`/`runWriteSrtToSheet` in `scripts/write-srt-to-sheet.mjs`; `groupKeyForRow` already mirrors `pipeline_lib.group_key_for_filename` (parity test shells out to Python). `runWriteSrtToSheet`'s existing `makeClient()` sheet already carries `video_file`, so only the `planSrtWrites` row fixtures need the column added.
- Seed: `CONFIG_COLUMNS`/`LOCALIZATION_COLUMNS`/`buildSeededCsv` in `scripts/seed-master-columns.mjs`; the seed test asserts each `CONFIG_COLUMNS` entry appears in the header and that the seeded rows round-trip through `buildCourseConfig`.
- Player path: `step.subtitles` → `src/modules/video/video-loader.web.js` (`getLocalizedTranslation(step.subtitles, lang)`) → `SimpleVideoStateController.initSubtitles` → `src/components/SimpleVideoPlayer.web.jsx`. A `branching` step loads the `simpleVideo` phase (story 054), which is why the caption appeared on the branch clip.
- `wouldyourather` is the sole entry in `scripts/lib/generated-configs.json`, so `src/config/generated-config-contract.test.js` already validates the shipped config on every test run.

## Notes

- A sheet-data-only fix (delete the `srt` cell) is not viable: the cell is machine-rewritten by `planSrtWrites`' blank-`filename` collision on the next `sync-srt` run (verified by running the repo's own `planSrtWrites` against the live master). Fix 2 removes the collision; Fix 1 makes the app correct even while the existing cell is still present.
- Fix 2 changes `intro`-row maintenance: the `intro` cell was previously supplied only by the collision, so it is left as-is (the write-back never clears) rather than tracked to any rendered group. No rendered step relies on that coupling.
- The `row_purpose` column is derived (refreshed on re-seed) and informational; hand notes in it are not preserved across a re-seed. It is deliberately excluded from `CONFIG_COLUMNS` so no generator/translator path reads it.
- Not automatable: an operator confirming on a real device that the branch clip shows only its own burned-in caption and no second subtitle line. The contract is the absent `subtitles` key, which is exactly what the player consumes.
