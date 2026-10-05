# Translate the authoring sheet in place: DeepSeek writes es/pt/bn back as per-language columns

## Context

The published Google Sheet is the operator's editing surface and the source of truth for course videos and configs (`scripts/generate-config-from-sheet.mjs`, stories 042/046/047). The config generator reads the sheet's published CSV over HTTP and emits `src/config/<courseId>.json` — but **English-only**: every locale-bearing object it writes is `{ en: … }` (`scripts/lib/sheet-config-utils.js:310` lesson title, `:315` mission, `:181`/`:191` cue single/array, `:156`/`:160` subtitles). The app, however, expects multi-language objects (`{en,es,pt,bn}`) on exactly those fields: `src/modules/bilingual/config-normalizer.js:86` keeps `mission` as an object for bilingual display and `:108` flattens `subtitles` per-locale, `src/modules/video/video-processor-logic.js:546-555` reads `q.cue[lang]`, and the hand-authored configs carry the `{en,es,pt,bn}` shape on these fields (verified in `src/config/friend.json`, `model.json`, `gt2.json`, `t.json`, `test.json`; note `lesson.title` is the exception — it is resolved to English by design, see Notes). So generated configs today silently drop localization.

The operator has **decided to keep Google Sheets** and hand-edit the English content there. This story **adds write access**: a script run in GitHub Actions reads the English source columns, translates the translatable fields with the **existing DeepSeek client** (`translateReal`, `DEEPSEEK_MODEL='deepseek-v4-flash'`, the same transport `scripts/generate-captions.mjs:120-150` uses), and **writes the translations back into the sheet** as one column per language (`lesson_title_es`, `mission_pt`, `cue_es`, `cue_alt_es`, `subtitle_text_bn`, … — 15 columns, see §2). The sheet then holds en/es/pt/bn, and the generator reads the language columns into the existing `{en,es,pt,bn}` objects. The sheet stays the operator's surface; the translation is a machine-written addendum in adjacent columns the operator can override by hand (a human edit is picked up by the next config generation, because translation only fills blanks).

This is the natural next step after 047 ("the sheet is authoritative"): 047 made generated configs overwrite, and this story makes the sheet itself capable of carrying the translations, closing the "No localization" gaps 042/046/047 all deferred to "a later pass".

## Out of Scope

- **No replacement of Google Sheets, and no dependency on the ephemeral dev sandbox.** The sheet remains the source of truth. All automation runs in GitHub Actions; no secret is committed or placed on the sandbox.
- **No new translation transport.** The DeepSeek call is the existing one: `https://api.deepseek.com/v1/chat/completions`, `model: 'deepseek-v4-flash'`, `response_format: json_object`, `Authorization: Bearer ${DEEPSEEK_API_KEY}` (`scripts/generate-captions.mjs:36,120-150`). This story factors the client into a shared module so both `generate-captions.mjs` and the new `translate-sheet.mjs` use it — it does not invent a second client.
- **No change to the read path.** `scripts/generate-config-from-sheet.mjs` still fetches the same published CSV `SHEET_URL` (source-guarded against `public/recorder.html`) and still calls `parseCsv` + `buildCourseConfig*`. The generator only gains the ability to *consume* the new language columns; the fetch/parse/CLI surface is unchanged except for the locale output described below.
- **No change to the `phrase`/`cue`/`subtitle_text` English source columns** and no change to the `srt` column semantics. Translations never overwrite the English source: this story writes only new `*_es`/`*_pt`/`*_bn` columns, and the translation script only fills blanks there.
- **No new languages.** `CAPTION_LANGUAGES` is `['en','es','pt','fr','hi','bn']`; the sheet's localization targets the four languages the app's generated-config contract names (`en,es,pt,bn`, per `*.test.js`/`wouldrather.json`). `fr`/`hi` captions stay in the caption pipeline; they are not added to the sheet column contract here.
- **No git commits from the translation Action.** Unlike `captions.yml`/`configs.yml`, `.github/workflows/translate-sheet.yml` writes to the **sheet**, not to the repo. It does not use `GH_NEW_TOKEN` and does not commit.
- **No operator OAuth flow.** Service-account auth is chosen (see Implementation approach §1); interactive OAuth consent is rejected as the wrong tool for an unattended CI job.
- **No change to the render path, R2 layout, or Modal pipeline.**
- **No `--all-languages`/`--force`-on-first-run by default.** `--force` exists (retranslate non-blank inline) but is never passed by the Action.

## Implementation approach

### 1. Auth: Google service account (decision, with rationale)

**Pick: a Google Cloud service account with the Google Sheets API `spreadsheets.values` endpoints.** An unattended GitHub Action needs credentials that work with no browser and no refresh-token dance; a service account is exactly that.

- **Scopes:** `https://www.googleapis.com/auth/spreadsheets` (read + write the sheet the account can access). No broader scope (no Drive). State this exactly — it is the only scope requested.
- **Key storage:** a single GitHub Actions secret, **`GOOGLE_SERVICE_ACCOUNT_JSON`**, holding the service-account JSON key. Store it as the **raw JSON** (not base64): `google-auth-library`'s `GoogleAuth` accepts `{ credentials: JSON.parse(json) }` directly, and raw JSON is one less decode step and easier to rotate/verify in the Actions UI. (Base64 is the alternative; state it and reject it: neither the repo nor any script ever sees a file path to the key, so base64 buys no extra secrecy and adds a decode that can itself fail.) The key is never committed, never written to disk by the script (passed straight into `GoogleAuth`), and never present on the sandbox.
- **Sheet sharing (operator step, not automatable in code):** the operator opens the sheet → **Share** → pastes the service-account email (the `client_email` field of the key, `<name>@<project>.iam.gserviceaccount.com`) → grants **Editor** → does *not* enable "Notify people". This is the human granting edit access; the story records the exact instruction and notes that the published-CSV read path is separate and unaffected (publishing is read-only and remains).
- **Sheet ID:** a second Actions **variable/secret**, **`GOOGLE_SHEET_ID`** — the spreadsheet id from the sheet URL (`docs.google.com/spreadsheets/d/<ID>/edit`). Expose it as a repo **variable** (not a secret — it is not sensitive) so the workflow reads `vars.GOOGLE_SHEET_ID`; accept a secret fallback (`secrets.GOOGLE_SHEET_ID`) so both spellings work. The published CSV URL already exists in `SHEET_URL`; the API needs the id + a sheet/tab name, so the script takes `--sheet-id` and `--tab` (default the tab whose `gid` the published URL pins, `289451687` — resolve it by name via `spreadsheets.get` and match the gid, or default to the first sheet when unambiguous).
- **Reject the alternative — OAuth (installed-app / refresh token).** Rationale to record: OAuth requires a client id/secret, a one-time interactive consent to mint a refresh token, and then long-lived storage of that refresh token as a secret; it also ties the token to a human account whose access can be revoked by password/2FA changes and whose consent expires for "testing"-mode apps. A service account is not a human, cannot trigger consent expiry, and is trivially rotatable (rotate the key, update one secret). For an unattended CI writer, the service account is strictly better. The cost (operator must share the sheet with a robot email) is a one-time action, recorded here.
- **What is stubbed in tests:** all Google API and auth calls. No live credential is ever required by the test suite. The client is injected (see §3) so tests pass fakes for `getValues`/`batchUpdate`.

### 2. Column layout: one column per language per translatable field (decision)

**Pick: one explicit column per language per field.** The operator edits the sheet **by eye**; a `translations` JSON blob cell would be unreadable and error-prone to hand-edit. Explicit columns are self-documenting, sortable, diff-able in the sheet, and map 1:1 onto the `{en,es,pt,bn}` objects. State this recommendation and the rejected blob alternative explicitly.

**English source columns (unchanged — the translation inputs):**

| Field | English source column | Config output |
|---|---|---|
| lesson title | `lesson_title` | `lesson.title` |
| lesson mission | `mission` | `lesson.mission` |
| step cue (single) | `cue` | `step.cue` (object) |
| step cue alternatives | `cue_alt` | `step.cue` (array of objects) |
| subtitle text | `subtitle_text` | `step.subtitles` (only when `srt` blank; `srt` wins) |

**New columns (per language, `lang ∈ {es, pt, bn}`):**

| New column | Translates from | Config output | Notes |
|---|---|---|---|
| `lesson_title_es` / `_pt` / `_bn` | `lesson_title` | `lesson.title[lang]` | lesson-level; blank ⇒ omit key |
| `mission_es` / `_pt` / `_bn` | `mission` | `lesson.mission[lang]` | lesson-level; only when mission present |
| `cue_es` / `_pt` / `_bn` | `cue` | `step.cue[lang]` (single-cue step) | only for a `cue` step |
| `cue_alt_es` / `_pt` / `_bn` | `cue_alt` | `step.cue[i][lang]` (array element i) | **one cell per alternative line**, line-aligned with `cue_alt` |
| `subtitle_text_es` / `_pt` / `_bn` | `subtitle_text` | `step.subtitles[lang]` | only when `srt` is blank |

That is **15 new columns** (5 fields × 3 languages). `srt` is **not** translated in this story: the caption pipeline owns SRT localization (per-cue timings), and the generator's `subtitle_text` path is the simple static-subtitle path the sheet already carries; a translated `subtitle_text` therefore rides along but a translated `srt` does not. The generator maps `subtitles = { en: srtOrText, …langs }` when `srt` is used with translations present — but because `srt` isn't translated, the localized keys only come from `subtitle_text_<lang>`, and they are attached only in the `subtitle_text` (no-`srt`) branch. **Decision:** when `srt` is non-blank, `subtitles` stays `{ en: srt }` (the caption pass fills the other languages later); when only `subtitle_text` is set, `subtitles` becomes `{ en, <langs>… }` from the language columns. This is stated so the implementer does not guess.

**`cue` array mapping (`cue_alt` case):** `cue_alt` holds newline-separated alternatives; `cue_alt_<lang>` must hold the **same number of newline-separated lines**, each the translation of the corresponding English line. The generator splits both on `\n`, trims, drops blank English lines, and pairs by index: `cue[i] = { en: enLines[i], es: esLines[i]??, … }`; a language line that is blank or out-of-range simply omits that language for that element (the English alternative still appears). A **mismatched line count is tolerated** (translate script always writes the same count; a hand-edit may not) — extra English lines get `{en}` only, extra translation lines are ignored. This is deliberate and stated, not derived.

**Language columns are bound to their English source (so the two cue shapes cannot cross-contaminate):** `cue_es` is the translation of `cue` and is read only when the step's `cue` column is non-blank; `cue_alt_es` is the translation of `cue_alt` and is read only when `cue_alt` is non-blank. Because `cue` and `cue_alt` are mutually exclusive (`sheet-config-utils.js:173-175` throws when both are set), exactly one of the two shapes applies to a step, and the generator must not read the other language column. The planner mirrors this: it plans `cue_<lang>` only for a row whose English `cue` is non-blank, and `cue_alt_<lang>` only for a row whose English `cue_alt` is non-blank — so a stray hand-typed `cue_alt_es` on a single-`cue` row is neither produced by the script nor consumed by the generator.

**Which rows carry lesson-level columns:** `lesson_title_*`/`mission_*` are lesson-level. The generator uses the **first non-blank** value across the lesson's rows for each language (a translation may legitimately be present on only one row — this is how the translate script writes a lesson-level translation, once, on the first row of the lesson). This deliberately does **not** reuse `singleValue`'s throw-on-conflict rule (`sheet-config-utils.js:197-208`), because a translation present on one row and blank on the rest is normal, not a conflict; a *disagreeing* pair of non-blank translations is tolerated with first-seen-wins (recorded, not guarded). The English columns keep their existing `singleValue` conflict rule unchanged. `cue_*`/`cue_alt_*`/`subtitle_text_*` are step-row-level and are read from the step's group rows (first non-blank), mirroring how `cue`/`cue_alt`/`subtitle_text` are read today.

**Back-compat:** a sheet with none of the new columns behaves exactly as today (English-only output). The generator's locale assembly is additive; every language key is omitted when its column is blank. `{en}`-only output remains valid for a course whose language columns are empty — so the existing contract guard's English-only assertion must relax (see §5).

### 3. Translation script: `scripts/translate-sheet.mjs` + pure `scripts/lib/sheet-translate-utils.js`

Follow the established pure/thin split (`sheet-config-utils.js` is pure; the CLI owns I/O; `buildCaptionEdits` injects `transcribe`/`translate`).

**Pure module `scripts/lib/sheet-translate-utils.js`** (no fs/fetch/process):
- `SHEET_LANGUAGES = ['es', 'pt', 'bn']` (the sheet-localization targets; distinct from `CAPTION_LANGUAGES` which includes `en/fr/hi`).
- `TRANSLATABLE_FIELDS` — the field→source/new-column map from §2 (the single source of truth for the column contract, so the generator and the translator cannot drift).
- `localizedColumn(field, lang)` → `lesson_title_es` etc.
- `planSheetTranslations({ headers, rows, sheetRows, languages, force })` → a **pure, group-scoped diff plan**: lesson-level fields (`lesson_title`, `mission`) group by `course_id` + `lesson_id` and step-level fields (`cue`, `cue_alt`, `subtitle_text`) group by `course_id` + `lesson_id` + `video_file` (falling back to one group per row when the key columns are absent). `course_id` is part of the key because `lesson_id` is only unique within a course. For each (group, field, lang), if any row in the group already has a non-blank target the group plans nothing (unless `force`); otherwise the plan emits the item(s) to fill as `{ row, sheetRow, column, sourceText, lang, field }` — one item on the group's first source-bearing row for a single value, but **one item per source-bearing row for `cue_alt`** (the generator flattens `cue_alt`/`cue_alt_<lang>` across the group's rows). `subtitle_text` groups shadowed by a non-blank `srt` are skipped (`srt` wins). `sheetRow` is the real 1-based physical sheet row, so interior blank spacer rows do not shift a write. Returns the plan array (the CLI computes the per-language fill/skip counts via `countPresentTranslations`); never performs I/O and never throws on a blank source (it just emits nothing for that cell).
- `buildBatchUpdatePayload({ plan, headers, sheetTitle, translations })` → the exact `spreadsheets.values.batchUpdate` request body (`valueInputOption: 'RAW'`, an array of `{ range, values: [[translated]] }`), with each range computed from the target column index and the item's `sheetRow` (a single-quoted tab title, embedded quotes doubled). Pure and independently testable — tests assert the payload shape against a hand-written expectation and against the ranges the header layout implies.
- `groupCueAltLines(text)` → trimmed, non-blank lines (shared by the generator and the translator so the pairing rule is one implementation).

**Thin CLI `scripts/translate-sheet.mjs`**:
- Args: `--sheet-id=<id>` (default `GOOGLE_SHEET_ID`), `--tab=<name>` (default resolves the published gid's tab), `--languages=es,pt,bn` (default `SHEET_LANGUAGES`), `--dry-run`, `--force`, `--help`.
- Reads: `GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON), scopes: ['https://www.googleapis.com/auth/spreadsheets'] })` → `sheets.spreadsheets.values.get({ spreadsheetId, range: '<tab>!A1:ZZ' })` (or `spreadsheets.get` for the header row + `values.get` for data). Parses the returned values into the same header-keyed `rows` shape `parseCsv` produces (reuse the header normalize/trim/lower-case convention so both paths agree).
- Plans with `planSheetTranslations`. For each planned cell, calls the shared DeepSeek client `translateText(sourceText, lang)`; collects results.
- Writes with **one** `spreadsheets.values.batchUpdate` call (`valueInputOption: 'RAW'`, all `{range, values}` in one request) — a single atomic-ish batch, not N calls.
- **Report:** prints a per-language count (`es: 12 filled, 3 already present`), the exact cells planned (dry-run) or written, and exits 0 with `no cells to fill` when the plan is empty (idempotent re-run is a successful no-op).
- `--dry-run` prints the plan and the would-be ranges and performs **no** batchUpdate.
- Validates `--languages` against `SHEET_LANGUAGES` (unknown ⇒ error naming the bad value), and errors clearly if `GOOGLE_SERVICE_ACCOUNT_JSON`/`DEEPSEEK_API_KEY`/sheet id are missing (mirroring `generate-captions.mjs:173-176`).
- **Preserve the taught English target phrase** exactly as the captions translator does: the system prompt must include the same instruction — *"Keep the taught English target phrase (e.g. after 'Say:', 'Di:', 'Diga:') in English."* (`scripts/generate-captions.mjs:136`). This is a stated requirement, not an inference: the app teaches English, so the target phrase stays English in every translation.

**Shared DeepSeek client:** factor `translateReal`'s request into a small shared helper (e.g. `scripts/lib/deepseek.js` exporting `translateText(text, lang, { fetchImpl })` for plain text and keeping/relocating `translateReal`'s SRT behavior), used by both `generate-captions.mjs` and `translate-sheet.mjs`. The helper accepts an injected `fetchImpl` so tests stub it. **Do not change the captions pipeline's observable behavior** — the refactor is a pure extraction; `buildCaptionEdits`' signature and outputs stay identical, and `scripts/lib/caption-utils.test.js` must stay green.

### 4. Action: `.github/workflows/translate-sheet.yml` (manual, writes to the sheet)

- **Trigger:** `workflow_dispatch` only — matching 046's deferred-trigger stance (no `repository_dispatch`, no push; translating is an explicit operator action, and it writes to the operator's sheet). An optional `dry_run` boolean input (default `false`) and an optional `languages` string input (default `es,pt,bn`) let the operator preview from the Actions UI.
- **Permissions:** `contents: read` (it does not commit; it needs nothing more).
- **Concurrency:** `group: translate-sheet` with `cancel-in-progress: false` — a single global group so two runs cannot double-write the same sheet (unlike captions/configs, which are per-ref, this has one shared remote resource). State this rationale.
- **Steps:** checkout; `actions/setup-node@v4` with `node-version: 20, cache: npm`; `npm ci`; run `node scripts/translate-sheet.mjs --sheet-id="$GOOGLE_SHEET_ID" --languages="$LANGUAGES" $DRY_RUN_FLAG` with env:
  - `DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}`
  - `GOOGLE_SERVICE_ACCOUNT_JSON: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}`
  - `GOOGLE_SHEET_ID: ${{ vars.GOOGLE_SHEET_ID || secrets.GOOGLE_SHEET_ID }}`
  - and the `dry_run`/`languages` inputs mapped to env (or passed inline) so the `workflow_dispatch` inputs actually take effect.
- **No commit step, no `GH_NEW_TOKEN`.** Explicitly note the contrast with `captions.yml`/`configs.yml`.
- Skip the whole job when the required secrets are absent? No — fail loudly (a missing secret should be a red run, not a silent green), but the guard must not misfire on `dry_run` (dry-run needs the same secrets to *read*). Record this: dry-run still requires all three secrets because it reads the sheet.

### 5. Generator consumes translations; relax the English-only contract

**`scripts/lib/sheet-config-utils.js`** (extend, keeping English-only fallback):
- Add the `{en,es,pt,bn}` assembly using `TRANSLATABLE_FIELDS`/`localizedColumn` from `sheet-translate-utils.js` (import the shared column map so there is one definition).
- `lesson.title` becomes `localizedLessonValue(rowsForLesson, 'lesson_title', langs)` → `{ en, es?, pt?, bn? }` with each non-blank language column's first non-blank lesson value; blank language ⇒ key omitted. `lesson.mission` likewise from `mission`/`mission_<lang>`.
- `cueFor`: for a single `cue`, return `{ en, es?, pt?, bn? }` from `cue`/`cue_<lang>`. For `cue_alt`, split English lines and each `cue_alt_<lang>` into lines, pair by index (per §2), yielding `[{en, es?, …}, …]`.
- `subtitlesFor`: keep `srt` → `{en}` (untranslated, unchanged). For the `subtitle_text` branch, return `{ en, es?, pt?, bn? }` from `subtitle_text`/`subtitle_text_<lang>`.
- **Never overwrite the English value** and **omit absent language keys**; a fully English-only sheet still produces `{en}` exactly as today (back-compat).
- `REQUIRED_COLUMNS` is unchanged — the new columns are optional, so a sheet missing them still generates.
- Inline-comment the currently-stale "English-only for now" header (`:13-14`) to say the language columns are consumed when present.

**Contract guard `src/config/generated-config-contract.test.js`** — the current assertion `Object.keys(obj) === ['en']` (`:81`) must change. **Decision (new contract):** a generated translation object must (a) always contain a non-empty `en` string, and (b) contain **only** a subset of `{en, es, pt, bn}` (no unknown locale keys, no extra keys), with every present locale a non-empty string. This keeps the guard meaningful (it still catches a stray `fr`/`hi` or a non-string) while allowing localized generated configs. Update the failable mutations accordingly (add a mutation that injects an unknown key `fr` ⇒ must throw; keep the "omits en" mutation ⇒ must throw). The `collectTranslationObjects` walker (`:61-75`) already finds every translation object structurally, so only the per-object assertion changes. The friend-slug / recap vocabulary invariants stay.

**JS/Python parity:** `docs/video-pipeline/tests/test_pipeline_parity.py` reads constants from `scripts/lib/video-optimize-utils.js`, `poster-utils.js`, `src/modules/video/pipeline-keys.js` — **none** of which this story touches. The new `SHEET_LANGUAGES`/`TRANSLATABLE_FIELDS` live in a JS-only module and have no Python twin, so no parity test is added or broken. **Do not** introduce a JS/Python shared literal this story; if a Python consumer of the sheet ever appears, that is a later story. State this so the implementer does not invent a parity test.

### 6. Tests and guards (every AC has automated coverage)

- `scripts/lib/sheet-translate-utils.test.js` (new, pure): `planSheetTranslations` fills only blanks; treats whitespace-only as blank; `force` retranslates; blank English source emits nothing; per-row/column plan is deterministic; `buildBatchUpdatePayload` range/values shape (column index → A1 letter, row number off-by-one, `valueInputOption:'RAW'`); `groupCueAltLines` trims/drops blanks; `SHEET_LANGUAGES`/`TRANSLATABLE_FIELDS` expose exactly the 15 columns and 5 sources.
- `scripts/translate-sheet.test.js` (new CLI test, stubbed Google + DeepSeek): inject a fake `getValues`/`batchUpdate` and a fake `translateText`; assert (a) a single batchUpdate is issued with one range per planned cell, (b) idempotent second run plans zero cells and issues **no** batchUpdate, (c) `--dry-run` issues **no** batchUpdate but prints the ranges, (d) `--languages=es` only touches `_es`, (e) a missing `GOOGLE_SERVICE_ACCOUNT_JSON`/`DEEPSEEK_API_KEY` exits non-zero with a clear message, (f) `--help` documents every flag and does not pass `--force` by default. No live credential — the CLI is refactored so the Google client and `translateText` are injected seams (`process.env`-driven in production, argument-injected in tests) exactly as `buildCaptionEdits` injects `translate`.
- `scripts/lib/sheet-config-utils.test.js` (extend): a row set with `lesson_title_es`, `mission_pt`, `cue_es`, `cue_alt_es`, `subtitle_text_bn` yields `{en,es,pt,bn}` objects on the right fields; the `cue_alt` array pairs lines by index; blank language columns still yield `{en}` (back-compat, and the existing "emits only the en key" test is updated to the new contract); the `srt`-wins path stays `{en}`.
- `src/config/generated-config-contract.test.js` (update): passes for a localized fixture (`{en,es,pt,bn}`); fails when an unknown locale key appears; fails when `en` is missing; fails when a locale value is empty/non-string. Prove each can fail (the file already uses this mutate-and-expect-throw style).
- `scripts/translate-sheet-workflow.test.js` (new, source guard, under `scripts/` so the `src/**` recorder-page scanner is irrelevant): pins `workflow_dispatch`, the three secrets (`secrets.DEEPSEEK_API_KEY`, `secrets.GOOGLE_SERVICE_ACCOUNT_JSON`, `vars.GOOGLE_SHEET_ID`/`secrets.GOOGLE_SHEET_ID`), `group: translate-sheet`, `node-version: 20`, `node scripts/translate-sheet.mjs`, and the **absences**: no `GH_NEW_TOKEN`, no `git commit`, no `git push`, no `--force` in the default invocation. Prove failable by mutating each pinned token (as `scripts/configs-workflow.test.js:64-83` does). Include a guard that the service-account key is never written to disk: assert the workflow does not `echo`/`>` the key and that the CLI does not `fs.writeFileSync` a credentials path (read both raw sources; assert `GOOGLE_SERVICE_ACCOUNT_JSON` is only ever read, never written, and that no `.json` key file is created).
- `scripts/generate-captions.test.js` (existing): must stay green after the DeepSeek-client extraction (no behavior change).

### 7. Docs

- Extend `docs/video-pipeline/authoring-sheet.md` with a "Localization columns" section: the 15 columns, the source each translates from, the `cue_alt` line-pairing rule, "translation fills blanks only, so a hand edit is respected", the service-account sharing step, and the three secrets/variables. Regenerate/extend `docs/video-pipeline/sample-sheet.csv` (and `scripts/write-sample-sheet.mjs`) to include the new header columns (empty `*_es/_pt/_bn` cells in the sample, so the sample stays realistic for a fresh import) — the sample must round-trip through `parseCsv` and still generate a valid config.
- Add the feature to `docs/product.md`'s Features list (the localization round-trip) and note the sheet is now a read+write artifact.

## Tasks

### Task 1 - Shared column contract + pure translation planner

- `scripts/lib/sheet-translate-utils.js` imported by a unit test
  - → exports `SHEET_LANGUAGES = ['es','pt','bn']`
  - → `TRANSLATABLE_FIELDS` maps exactly the 5 sources (`lesson_title`,`mission`,`cue`,`cue_alt`,`subtitle_text`) to their `_es/_pt/_bn` columns (15 columns total)
  - → `localizedColumn('cue','pt') === 'cue_pt'`
- `planSheetTranslations` given rows where one target cell is blank, one is filled, one English source is blank
  - → plans only the blank-target cell with a non-blank source
  - → treats a whitespace-only target as blank
  - → with `force`, also plans the filled-target cell
  - → emits nothing for the blank source
- `planSheetTranslations` on a single-`cue` row (English `cue` set, `cue_alt` blank)
  - → plans `cue_<lang>` cells
  - → does **not** plan any `cue_alt_<lang>` cell
- `planSheetTranslations` on a `cue_alt` row (English `cue_alt` set, `cue` blank)
  - → plans `cue_alt_<lang>` cells
  - → does **not** plan any `cue_<lang>` cell
- a plan for a 3-row × 2-cell fixture + `buildBatchUpdatePayload`
  - → returns `valueInputOption: 'RAW'`
  - → one `{range, values: [[text]]}` per planned cell
  - → each range's column letter and 1-based row match the header index and sheet row
- `groupCueAltLines('a\n\n b \nc')` → `['a','b','c']`

### Task 2 - Shared DeepSeek text-translation client (extraction, no behavior change)

- `scripts/lib/deepseek.js` (or an equivalent shared module) imported by both CLIs
  - → exports a `translateText(text, lang, {fetchImpl})` that POSTs the same URL/model/`json_object` body and `Bearer` header the captions path uses
  - → its system prompt contains the taught-English-target-phrase instruction (`Say:`/`Di:`/`Diga:`)
- `scripts/generate-captions.mjs` after the extraction
  - → still calls the same DeepSeek endpoint with the same body (assert via a stub `fetchImpl` that the captured body equals the pre-refactor body for one language)
- `scripts/lib/caption-utils.test.js` + `scripts/generate-captions.test.js`
  - → remain green (no observable change)

### Task 3 - Translation CLI (`scripts/translate-sheet.mjs`)

- CLI run with fake Google + fake `translateText`, a sheet with 2 blank target cells
  - → issues exactly one `spreadsheets.values.batchUpdate`
  - → the batch contains one range per planned cell and writes the fake translated text
  - → prints a per-language fill/skip report and exits 0
- CLI re-run immediately (targets now fake-filled)
  - → plans zero cells, issues zero batchUpdate calls, prints `no cells to fill`, exits 0
- CLI `--dry-run`
  - → issues zero batchUpdate calls
  - → prints the would-be ranges
- CLI `--languages=es` on a sheet with blank `_es`/`_pt`
  - → plans only `_es` cells
- CLI `--languages=xx`
  - → exits non-zero naming `xx`
- CLI without `GOOGLE_SERVICE_ACCOUNT_JSON` or without `DEEPSEEK_API_KEY`
  - → exits non-zero with a message naming the missing env var
- CLI `--help`
  - → exits 0 and lists `--sheet-id`, `--tab`, `--languages`, `--dry-run`, `--force`

### Task 4 - Generator consumes language columns into `{en,es,pt,bn}`

- `buildCourseConfig` over a lesson with `lesson_title`, `lesson_title_es`, `lesson_title_pt`, and blank `lesson_title_bn`
  - → `lesson.title === { en, es, pt }` (no `bn` key)
  - → the `en` value is exactly the `lesson_title` cell (never replaced)
- a `friendClosedResponse` step with `cue` + `cue_es` + `cue_bn`
  - → `step.cue === { en, es, bn }` (no `pt`)
- a step with `cue_alt` (2 lines) + `cue_alt_es` (2 lines) + `cue_alt_bn` (1 line)
  - → `step.cue === [{en,es,bn},{en,es}]` (line-paired by index; the shorter language omits on the unpaired element)
- a step with `subtitle_text` + `subtitle_text_es`
  - → `step.subtitles === { en, es }`
- a step with `srt` + `subtitle_text_es`
  - → `step.subtitles === { en: <srt> }` (srt wins; no `es`)
- a single-`cue` step that also carries a stray `cue_alt_es` but no `cue_alt`
  - → `step.cue === { en, … }` from `cue`/`cue_<lang>`; the stray `cue_alt_es` is ignored (not read)
- a `cue_alt` step that also carries a stray `cue_es` but no `cue`
  - → `step.cue` is the line-paired array from `cue_alt`/`cue_alt_<lang>`; the stray `cue_es` is ignored
- a lesson whose `lesson_title_es` is present on only one of several rows
  - → `lesson.title.es` is that value (first non-blank across the lesson's rows; no conflict throw)
- a fully English-only sheet (no language columns)
  - → output objects are `{en}` exactly as today (back-compat)
- `findMissingColumns` over a sheet lacking every language column
  - → returns `[]` (new columns are optional, never reported missing)

### Task 5 - New generated-config contract (localized allowed)

- `src/config/generated-config-contract.test.js` over a well-formed localized fixture
  - → passes for `{en}`, `{en,es}`, and `{en,es,pt,bn}` objects, each with non-empty string values
- the same guard + an injected unknown locale key (`fr`)
  - → throws
- the same guard + a translation object missing `en`
  - → throws
- the same guard + an empty-string or non-string locale value
  - → throws
- every existing invariant (canonical recap vocabulary, friend-slug⇒`recapSources:friend`)
  - → still enforced and still failable

### Task 6 - Action source guard (`.github/workflows/translate-sheet.yml`)

- the workflow + the guard read raw source
  - → contains `workflow_dispatch:`
  - → contains `secrets.DEEPSEEK_API_KEY` and `secrets.GOOGLE_SERVICE_ACCOUNT_JSON`
  - → contains `GOOGLE_SHEET_ID` (vars or secrets)
  - → contains `group: translate-sheet`
  - → contains `node-version: 20` and `node scripts/translate-sheet.mjs`
  - → does **not** contain `GH_NEW_TOKEN`, `git commit`, `git push`, or a bare `--force`
- the guard mutations
  - → removing `workflow_dispatch:`, a secret reference, `group: translate-sheet`, or the script invocation each makes the guard throw
  - → re-adding `git commit`/`--force` makes the "absent" assertions throw
- the CLI raw source
  - → never calls `fs.writeFileSync` on a credentials/JSON path and never logs `GOOGLE_SERVICE_ACCOUNT_JSON`'s contents (only reads it)
- a JSON key file is not created by a dry-run or a real run in the test (fake Google authenticator records that no file path was opened)

### Task 7 - Docs + sample sheet

- `docs/video-pipeline/authoring-sheet.md`
  - → documents the 15 localization columns, the source column each translates from, the `cue_alt` line-pairing rule, blanks-only semantics, and the service-account share step
- `docs/video-pipeline/sample-sheet.csv` (regenerated by `scripts/write-sample-sheet.mjs`)
  - → header contains all 15 new columns
  - → `parseCsv(sample)` still yields rows and `buildCourseConfig` still produces a valid config (an existing/new test asserts this round-trip)
- `docs/product.md`
  - → the Features list gains the sheet translation round-trip entry, matching the existing entry format

## Technical Context

- **New dependencies (exact, verified from the npm registry, Node-20-compatible).** The Actions runners pin `node-version: 20` (`.github/workflows/configs.yml:37`, `captions.yml:20`, `deploy.yml:19`). The *latest* Google libs require Node ≥22 (`googleapis@183.0.0` engines `>=22.0.0`, `google-auth-library@11.1.0` engines `>=22`), so they **must not** be used with the current CI. Pin:
  - `googleapis@178.0.0` — latest `googleapis` whose `engines.node` is `>=18` (deps: `googleapis-common@^8.0.0`, `google-auth-library@10.5.0`). Add as a **dependency** (it is used by a shipped script, not a test-only tool).
  - `google-auth-library@10.5.0` — pulled transitively by `googleapis@178.0.0`; do **not** pin it directly (avoid a duplicate/drifting copy), rely on the transitive pin.
  - Verify at implement time with `npm view googleapis@178.0.0 engines dependencies` (already recorded here) and `npm ls google-auth-library` after install to confirm a single 10.5.0. If a future change moves CI to Node 22+, that is a separate story.
  - No other new dependency. `jsonc-parser` (already present) is **not** needed for the sheet path (the sheet is plain CSV/values, not JSONC).
- **Scope string (exact):** `https://www.googleapis.com/auth/spreadsheets`. Used with `new google.auth.GoogleAuth({ credentials, scopes: [...] })` then `google.sheets({ version: 'v4', auth })`.
- **Secrets/variables (exact names):** `DEEPSEEK_API_KEY` (existing), `GOOGLE_SERVICE_ACCOUNT_JSON` (new secret, raw JSON key), `GOOGLE_SHEET_ID` (new; repo variable `vars.GOOGLE_SHEET_ID`, with `secrets.GOOGLE_SHEET_ID` accepted as a fallback). `GH_NEW_TOKEN` is **not** used by this Action.
- **Existing read path pinned and preserved:** `SHEET_URL` (`scripts/generate-config-from-sheet.mjs:32-33`) stays the published CSV URL and stays source-guarded against `public/recorder.html` (`scripts/generate-config-from-sheet.test.js:258-265`). This story does not touch that literal. The published CSV remains the generator's read path; the Sheets API is only for the *writer*.
- **Test seams:** the repo's established pattern is pure modules + thin CLIs with injected I/O (`sheet-config-utils.js` pure; `buildCaptionEdits` injects `transcribe`/`translate`). Reuse it: `planSheetTranslations`/`buildBatchUpdatePayload` pure; the CLI takes the Google `values`/`batchUpdate` functions and `translateText` as injectable dependencies (module-level defaults reading env), so `scripts/translate-sheet.test.js` runs with fakes and **no live creds**.
- **Node 20 built-ins:** global `fetch` is available (Node 18+), so the DeepSeek call needs no new HTTP dep (as in `generate-captions.mjs`). `node:fs` promises, `node:path`, `node:url` as used elsewhere.
- **Guard hygiene (`AGENTS.md`):** assert on **raw** source (no comment stripping — the CLI contains `https://` for the DeepSeek URL and `docs.google.com`); whole-file `not.toContain` is correct only for tokens that must be entirely absent (`GH_NEW_TOKEN`, `git commit`, `git push`, `--force`); prove every guard can fail by mutating the real text. Any guard that lives under `src/**` must not mention `/recorder`/`recorder.html` (`src/modules/video/recorder-page.test.js:98`); this story's workflow guard lives under `scripts/` so it is unaffected, and no new `src/**` file references the recorder.
- **`cue_alt` / `cue` mutual exclusivity is preserved** (`sheet-config-utils.js:173-175` throws when both are set); the language columns do not change that rule.
- **The `srt` column is intentionally untranslated.** SRT localization is the captions pipeline's job (per-cue timings, `validateTranslatedSrt`); duplicating it in the sheet would create two sources of truth for timings. Stated so the implementer does not translate `srt`.
- **Idempotency + human edits:** because `planSheetTranslations` only plans blank targets, a human editing a `*_es` cell in the sheet is never overwritten by a later run — the next `configs.yml` run reads the edited cell. This is the round-trip guarantee; it is enforced by the planner's blanks-only rule and covered by Task 1/Task 3 tests.
- **Round-trip flow (end to end):** operator edits English in the sheet → `translate-sheet.yml` (manual) fills `*_es/_pt/_bn` → `configs.yml` (manual) generates `src/config/<courseId>.json` with `{en,es,pt,bn}` → app localizes via `config-normalizer.js`. No step runs on the sandbox.

## Notes

- **Why one global concurrency group:** `captions.yml` and `configs.yml` use per-ref groups (`captions-${{ github.ref }}`, `configs-${{ github.ref }}`) because they commit to a branch. This Action mutates one shared remote sheet regardless of branch, so the group must be a single constant (`translate-sheet`); two concurrent runs would read the same blanks and double-translate (wasted API calls, and a race on the same cells). `cancel-in-progress: false` so a queued run is not silently dropped.
- **Why service account, restated for the operator:** the robot email must be granted **Editor** on the sheet once. If the operator later changes the sheet's sharing, the Action fails loudly (401/403 surfaced by the CLI) rather than silently writing nothing. The published-CSV read path is independent and keeps working even if the share is revoked — but the writer will fail, which is the intended signal.
- **Cost/rate:** a full retranslation of a large sheet is many DeepSeek calls; the default fills blanks only, so steady-state runs cost near zero. `--force` is operator-only and never used by the Action.
- **Not guarding, but recording:** the operator may prefer different wording in a translation; they can edit the cell directly, and the next config generation honors it. If they want a machine retranslation, they clear the cell and re-run. That is the intended interaction; do not add a "locked" column.
- **`fr`/`hi` are deliberately absent from the sheet contract.** The app's generated-config contract names `en/es/pt/bn`; the captions pipeline covers `fr/hi` for SRT. If a future story wants sheet-level `fr`/`hi`, it extends `SHEET_LANGUAGES` and the guard — explicitly out of scope here.
- **Lesson-title translations are for contract parity, not current runtime localization.** The hand-authored configs carry localized `title` objects (`src/config/friend.json`, `model.json`, `gt2.json`, `t.json`, `test.json` were verified to hold `{en,es,pt,bn}`/`{en,es,pt}` titles), so the generated-config contract and `collectTranslationObjects` already treat `title` as a locale object — the generator emitting `{en,es,pt,bn}` on a generated title is consistent with that shape and harmless. But note the app resolves lesson titles to **English by design**: `src/modules/bilingual/config-normalizer.js:83-85` and `src/modules/lesson/lesson-loader.js:72` force `title` to its `.en`, because lesson titles are curriculum labels, not learner-facing copy. So no runtime behavior changes for titles; the `lesson_title_<lang>` columns exist for shape parity with hand-authored configs and for a future story that localizes titles. This is stated so a reviewer does not expect localized titles in the UI and a test does not assert a runtime title in Spanish. (`mission`, `cue`, and `subtitles` **are** resolved per-locale — `config-normalizer.js:86` keeps mission as an object, `:108` localizes subtitles, and `video-processor-logic.js:546-555` reads `cue[lang]` — so those three fields are the ones with live runtime effect.)
- **No git writes from this Action** means no `[skip …]` loop guard is needed (there is no bot commit to skip); the loop-guard pattern from `configs.yml`/`captions.yml` is deliberately not copied, and the workflow guard asserts the absence of commit/push instead.
