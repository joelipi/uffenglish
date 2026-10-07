# Author `branching` choices and per-step `nextStep` from the sheet

## Context

Story 054 added the app's `branching` step type: a question step whose `chooseStep: [{ nextStep, text }]` entries render as multiple-choice buttons that jump to a target step, and a per-step `nextStep` offset that `loadNextStep` honors so alternative steps converge on one shared continuation. The app reads those fields from `src/config/*.json`, but the sheet is the source of truth and `scripts/generate-config-from-sheet.mjs` **overwrites** configs unconditionally — so until the generator emits `chooseStep`/`nextStep`, any hand-authored branching config is wiped on the next generation.

This story makes the sheet able to author both fields: new step-level columns `next_step`, `choose_step_next`, `choose_step_text` (plus `choose_step_text_es/_pt/_bn` filled by the existing translate round-trip), read by the generator in **both** sheet shapes (overlay master and authoring sheet) and translated by the existing DeepSeek pass. It is tooling-only: no `src/**` runtime change (the app contract is already implemented in 054) and no pipeline/recorder change.

## Out of Scope

- No app/runtime changes — `src/modules/**`, `src/components/**`, and `src/config/*.json` are untouched (054 owns the contract).
- No Google Sheet edits and no `master-seeded.csv` rewrite — the operator regenerates the live master by re-running the seed script; the committed snapshot stays.
- No pipeline (`docs/video-pipeline/*.py`) or recorder (`public/recorder.html`) change: the pipeline groups takes by `video_file`/`join` and ignores the new columns; the recorder reads the sheet by header.
- No range validation of choice offsets (a target past the lesson end is dropped by the app at runtime, as specified in 054).
- No new dependencies.

## Implementation approach

### Sheet schema (step-level, both shapes)

| Column | Meaning |
|---|---|
| `next_step` | Integer ≥ 1. The step-level advance override emitted as `step.nextStep` (a **number**). Optional. |
| `choose_step_next` | Newline-separated 1-based offsets, one line per choice (English/source). Optional. |
| `choose_step_text` | Newline-separated choice labels, line-paired with `choose_step_next` (English). Optional. |
| `choose_step_text_es` / `_pt` / `_bn` | Translations, line-paired with `choose_step_text`; filled by `scripts/translate-sheet.mjs`. |

Both source columns mirror `cue_alt`: a multi-line cell whose lines are the choices, with a per-language sibling whose lines pair with the English lines **by index**. They flatten across the step's rows in row order (same as `cue_alt`), so a step may carry its choices on one row or spread them.

### Generator rules (`scripts/lib/sheet-config-utils.js`)

- Add `'branching'` to `RESPONSE_TYPES`.
- Add a `chooseStepFor(stepRows, context)` helper used by **both** `buildAuthoringSteps` (group = `video_file`) and `buildMasterSteps` (group = `join || video_file`, rows = all sub-group rows):
  - Flatten `groupCueAltLines` over each row for `choose_step_next`, `choose_step_text`, and each `choose_step_text_<lang>` (per-row language pairing, exactly like `cueFor`'s `cue_alt` branch: row *r*'s English line *i* pairs with that same row's `choose_step_text_<lang>` line *i*).
  - If neither source column is non-blank anywhere in the step → return `undefined` (no `chooseStep` key).
  - If exactly one is non-blank → throw `video_file "<key>": choose_step_next and choose_step_text must both be set`.
  - If their line counts differ → throw `video_file "<key>": choose_step_next has N lines but choose_step_text has M`.
  - Each `choose_step_next` line must match `/^\d+$/` and `Number(line) >= 1`, else throw `video_file "<key>": choose_step_next line <i> is not an integer >= 1 ("<line>")`.
  - Emit `step.chooseStep = [{ nextStep: <number>, text: { en, es?, pt?, bn? } }]` in line order; a missing/out-of-range language line omits that language for that choice (never a blank-string value).
  - If `chooseStep` is produced for a step whose `response_type` is not `branching` → throw `video_file "<key>": choose_step_* is only valid on a branching step`.
- `next_step`: `singleValue(stepRows, 'next_step', context)`; when non-blank it must match `/^\d+$/` and `Number > 0`, else throw `video_file "<key>": next_step must be an integer >= 1 ("<value>")`; emit `step.nextStep` as a **number**. Emitted for any response type, including `branching` (its empty-choices Continue fallback honors it).
- Neither `next_step` nor `choose_step_*` is required: a `branching` step with no choices generates fine (the app falls back to Continue), and `findMissingColumns` must not report them.

### Translator rules (`scripts/lib/sheet-translate-utils.js`, `scripts/translate-sheet.mjs`)

- Add `{ field: 'choose_step_text', source: 'choose_step_text', level: 'step', lines: true }` to `TRANSLATABLE_FIELDS` **immediately after `cue_alt`**, and mark `cue_alt` with `lines: true`.
- Export `isLinePairedField(field)` (backed by a `LINE_PAIRED_FIELDS` set of `cue_alt` + `choose_step_text`) and replace the two hard-coded `field === 'cue_alt'` checks:
  - `planSheetTranslations`: a line-paired field plans **one item per source-bearing row of the group** (was cue_alt-only), every other field one item on the first row.
  - `translate-sheet.mjs` `runTranslateSheet`: the "line count must not change" guard applies to every `isLinePairedField(item.field)` (error message names the column, e.g. `choose_step_text`).
- `countPresentTranslations` uses the same `lines` grouping (per group), so the report stays correct.

### Seed script, sample sheet, docs

- `scripts/seed-master-columns.mjs` `CONFIG_COLUMNS`: append `'next_step', 'choose_step_next', 'choose_step_text'`. `LOCALIZATION_COLUMNS` derives from `TRANSLATABLE_FIELDS`, so `choose_step_text_es/_pt/_bn` appear automatically.
- `scripts/write-sample-sheet.mjs`: add the four new columns to `HEADER` and a worked branching example — a `branching` step followed by two alternative steps, each carrying `next_step` so they converge — then regenerate `docs/video-pipeline/sample-sheet.csv`.
- `docs/video-pipeline/authoring-sheet.md`: add `branching` to the `response_type` row and document the four columns, the line-pairing rule, and the "malformed choice data → the course is not generated" behavior.

### Strictness

Malformed choice data is a **structural error**: the offending course is not generated and the error names the step (`video_file "<key>"`), while other courses in the same sheet still generate — matching the generator's existing per-course error handling. Bad lines are never silently dropped.

## Tasks

### Task 1 - Generator reads `next_step` and `choose_step_*`

Files: `scripts/lib/sheet-config-utils.js`, `scripts/lib/sheet-config-utils.test.js`.

- `RESPONSE_TYPES` + a `branching` authoring step with `choose_step_next: '1\n2'`, `choose_step_text: 'Yes\nNo'`
  - → `step.chooseStep` equals `[{ nextStep: 1, text: { en: 'Yes' } }, { nextStep: 2, text: { en: 'No' } }]`
- the same columns on a master-format step (rows carry `phrase`, grouped by `join`)
  - → the same `chooseStep` is emitted
- `choose_step_text_es` / `_bn` set alongside `choose_step_text`
  - → line *i*'s translation lands on choice *i* (`text.es` / `text.bn`)
  - → a blank or out-of-range language line omits that language on that choice (no empty-string locale)
- `next_step: '3'` on an authoring step and on a master step
  - → `step.nextStep === 3` (a number, not a string)
- a `branching` step with no `choose_step_*`
  - → no `chooseStep` key and no throw
- a step with no `next_step` / `choose_step_*`
  - → neither key is emitted
- `choose_step_next: '1\nx'` / `'1\n0'`
  - → throws naming the `video_file` and the offending line
- `choose_step_next: '1\n2'` with `choose_step_text: 'Yes'`
  - → throws naming both line counts
- only `choose_step_next` set, or only `choose_step_text` set
  - → throws
- `choose_step_text` on a `closedResponse` step
  - → throws ("only valid on a branching step")
- `next_step: 'x'` / `'0'`
  - → throws naming the `video_file`
- `findMissingColumns` for a `branching` step with blank `choose_step_*`/`next_step`
  - → `[]` (not required columns)

### Task 2 - Translator translates `choose_step_text`

Files: `scripts/lib/sheet-translate-utils.js`, `scripts/translate-sheet.mjs`, `scripts/lib/sheet-translate-utils.test.js`, `scripts/translate-sheet.test.js`.

- `TRANSLATABLE_FIELDS`
  - → contains `{ field: 'choose_step_text', source: 'choose_step_text', level: 'step', lines: true }`
  - → `cue_alt` also carries `lines: true`
- `planSheetTranslations` for a step row with `choose_step_text: 'Yes\nNo'` and blank `choose_step_text_es`
  - → plans exactly one `choose_step_text_es` item whose `sourceText` is `'Yes\nNo'`
- the same row with a non-blank `choose_step_text_es`
  - → plans nothing (unless `force: true`)
- `planSheetTranslations` for a step group with `choose_step_text` on two rows
  - → emits one item per source-bearing row (mirrors the `cue_alt` rule)
- `runTranslateSheet` where the fake translator changes `choose_step_text`'s line count
  - → rejects with an error naming `choose_step_text` and writes nothing (`batchUpdate` not called)
- `cue_alt` planning and its line-count guard
  - → unchanged (existing tests still pass)
- `countPresentTranslations` for a group with a non-blank `choose_step_text_es`
  - → counts one `es` translation

### Task 3 - Seed script, sample sheet, and docs

Files: `scripts/seed-master-columns.mjs`, `scripts/seed-master-columns.test.js`, `scripts/write-sample-sheet.mjs`, `docs/video-pipeline/sample-sheet.csv`, `docs/video-pipeline/authoring-sheet.md`, `scripts/lib/sheet-config-utils.test.js` (sample round-trip).

- `CONFIG_COLUMNS`
  - → includes `next_step`, `choose_step_next`, `choose_step_text`
- `LOCALIZATION_COLUMNS`
  - → includes `choose_step_text_es`, `choose_step_text_pt`, `choose_step_text_bn`
- `buildSeededCsv` output header
  - → contains each new column exactly once
- `docs/video-pipeline/sample-sheet.csv` (regenerated by `node scripts/write-sample-sheet.mjs`)
  - → header contains `next_step`, `choose_step_next`, `choose_step_text`, `choose_step_text_es/_pt/_bn`
  - → `buildCourseConfig(parseCsv(sample))` yields a `branching` step with a `chooseStep` array and the two alternative steps carry `nextStep`
  - → the sample round-trip test's authoring-localization count is updated from 15 to 18
- `docs/video-pipeline/authoring-sheet.md`
  - → the `response_type` row lists `branching`
  - → a table documents `next_step`, `choose_step_next`, `choose_step_text`, `choose_step_text_<lang>`

### Task 4 - Contract and parity guards

Files: `src/config/generated-config-contract.test.js`, `scripts/lib/sheet-config-utils.test.js`, `scripts/lib/sheet-translate-utils.test.js`.

- `collectTranslationObjects` on a config with `chooseStep`
  - → includes each `chooseStep[].text` object, so a choice text carrying an unknown locale key fails the contract
- `assertGeneratedConfigContract` on a generated config with a `branching` step + `choose_step_*` and es/pt/bn translations
  - → passes
- the `TRANSLATABLE_FIELDS` field-name parity assertion
  - → includes `choose_step_text`
- the `TRANSLATABLE_FIELDS` source-order assertion
  - → lists `choose_step_text` immediately after `cue_alt`

## Technical Context

- Generator: `scripts/lib/sheet-config-utils.js` — `RESPONSE_TYPES` (line ~41), `buildAuthoringSteps` (~431, groups by `video_file`), `buildMasterSteps` (~388, groups by `join || video_file`), `cueFor` (~242, the `cue_alt` per-row line-pairing to mirror), `singleValue` (~293), `localizedColumn`/`groupCueAltLines` imported from `sheet-translate-utils.js`. Config shape is `{en}` plus `es/pt/bn`.
- Translator: `scripts/lib/sheet-translate-utils.js` — `TRANSLATABLE_FIELDS` (~27), `groupsForField` (~106, step-level key is `course_id + lesson_id + video_file`), `planSheetTranslations` (~163; `targetRows` special-cases `cue_alt` at ~211), `countPresentTranslations` (~241). `scripts/translate-sheet.mjs` `runTranslateSheet` line-count guard at ~198.
- Seed/sample/docs: `scripts/seed-master-columns.mjs` (`CONFIG_COLUMNS` ~36, `LOCALIZATION_COLUMNS` ~46 derived from `TRANSLATABLE_FIELDS`), `scripts/write-sample-sheet.mjs` (`HEADER`), `docs/video-pipeline/authoring-sheet.md` (columns table ~11-37), `docs/video-pipeline/sample-sheet.csv`.
- Contract: `src/config/generated-config-contract.test.js` — `collectTranslationObjects` (~72) currently collects `title`/`mission`/`subtitles`/`cue`; add `chooseStep[].text`. Parity lists: `scripts/lib/sheet-config-utils.test.js:411` and `scripts/lib/sheet-translate-utils.test.js:22` pin `TRANSLATABLE_FIELDS` exactly. Sample round-trip test at `scripts/lib/sheet-config-utils.test.js:834` pins `toHaveLength(15)`.
- App contract (story 054, already implemented): `resolveBranchChoices`/`resolveNextStepIndex` read `step.chooseStep[].nextStep` and `step.nextStep`; both are **numbers**. `branching` steps require `simpleVideoUrl`; the generator emits it as `simpleVideoUrl` for the step's key exactly as today.
- No test reads `docs/video-pipeline/master-seeded.csv`'s header; leave the snapshot untouched.
- Test runners: `npm test` (vitest + the Python pretest) and `npm run test:python`; scripts tests live beside the modules.

## Notes

- **Strictness is deliberate.** Per the decision on this story, malformed choice data means the course is **not generated**, with a message naming the offending `video_file`; other courses still generate. This matches the generator's existing structural-error behavior (unknown `response_type`, conflicting `cue`) rather than the app's runtime "drop invalid options" leniency.
- **Why two source columns, not one delimited cell.** `choose_step_next` and `choose_step_text` avoid a delimiter inside user text and let the text column reuse the `cue_alt` line-pairing + translation guard verbatim. The cost is that the two columns must keep equal line counts — validated loudly.
- **Prerequisite.** The runtime contract (054) must be present for a generated `branching` course to function; this story only changes tooling, so it can merge independently without breaking any existing course.
- **The operator must add the columns to the live master.** Re-running `node scripts/seed-master-columns.mjs --out=…` and re-importing (or adding the columns by hand) is the operator step; the committed `master-seeded.csv` is not rewritten here.
- **Guard caution (AGENTS):** update every list that enumerates the columns/fields (`TRANSLATABLE_FIELDS` parity, the sample's 15→18 count, `CONFIG_COLUMNS`, the docs table) — a missed list turns a real change into a passing guard.
