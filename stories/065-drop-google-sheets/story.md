# Drop Google Sheets entirely — repo files are the only lesson-authoring store

## Context

The `wouldyourather` authoring pipeline still depends on Google Sheets as a live store even though the authoring truth already lives in the repo. Today the operator edits `wouldyourather.source.txt` on the GitHub web UI, `source-to-sheet.yml` syncs derived rows into the "Main" spreadsheet, and then three consumers read the OLD published master CSV (`.../pub?gid=242913338`, 157 rows, orphaned underscore slugs): the recorder (`public/recorder.html` `spreadsheet_url`), the config generator default (`scripts/generate-config-from-sheet.mjs` `SHEET_URL`), and the Modal render (`docs/video-pipeline/pipeline_lib.py` `SHEET_URL`, `PIPELINE_SHEET_URL` override) — all three URLs pinned byte-identical by `docs/video-pipeline/tests/test_pipeline_parity.py`. Two write paths also go through the Sheets API: the translator round-trip (`scripts/translate-sheet.mjs`, blanks-only + human-edit-honored, DeepSeek `deepseek-v4-flash`) and the SRT write-back (`sync-srt.yml` → `scripts/write-srt-to-sheet.mjs`). The one-click chain (`pipeline.yml`: sync-srt → translate-sheet → configs) exists only to shuttle cells through that remote store, and every read pays the minutes-long published-CSV lag (the reason story 051 added `--from-api`).

This story removes the remote store. The bridge output (`scripts/generate-sheet-from-source.mjs`, 153 rows / 108 takes, hyphen slugs) is committed as `public/wouldyourather.master.csv`; the recorder fetches it same-origin, the generator reads it from disk, the Modal render fetches it from `raw.githubusercontent.com`, and the translator + SRT write-back become bot-commit flows over that file (the existing `configs.yml` PAT pattern). All `GOOGLE_*` secrets/vars, the source-to-sheet workflow + writer, and every published-CSV reference go away.

## Out of Scope

- **No change to the Modal render stages, overlay templates, slug conventions, or R2 layout.** Silence/background/render math, the rungs overlay template, hyphen take slugs (`wouldyourather-a-01-01`), the public `uff` + private `uff-private` buckets, and `pipeline-assets/video_data.csv` as the R2 SRT transport all stay exactly as they are.
- **No change to the one-click chaining shape.** `pipeline.yml` still chains `srt` → `translate` → `configs` with `needs:` + `secrets: inherit`; only what each job reads/writes changes (repo file instead of sheet cells).
- **No change to translation semantics.** The DeepSeek client, the blanks-only fill rule, the human-edit-honored contract, and the stale-SRT re-translation rule are preserved; only the I/O seam changes (CSV file cells instead of `values.get`/`batchUpdate` ranges).
- **No migration of the old underscore-slug rows.** The old master has zero filename overlap with the bridge output by design (deliberate rename); nothing is imported from it.
- **No new dependency.** The `googleapis` package (`178.0.0`) is removed, not replaced.

## Implementation approach

### 1. The committed master CSV is the only store (decision)

Commit the bridge output at `public/wouldyourather.master.csv`. `public/` is load-bearing: Vite copies it verbatim into `dist/`, so Pages serves it same-origin and the recorder fetches it with no CORS and no publish lag. The file keeps the **full live master header** (`LIVE_BASE_COLUMNS` + `BRIDGE_CONFIG_COLUMNS` + every `*_es/_pt/_bn` localization column + `srt`/`srt_es`/`srt_pt`/`srt_bn` from `source-bridge-utils.js` `MASTER_HEADER`): the generator's `buildCourseConfigs`, the translator's `planSheetTranslations`, and the SRT `planSrtWrites` all consume header-keyed rows, so none of that pure logic changes — only the I/O seams around it do.

Regeneration (new `source-to-csv.yml`, replacing `source-to-sheet.yml`): on push to `main` with paths `wouldyourather.source.txt`, `scripts/generate-sheet-from-source.mjs`, `scripts/lib/source-bridge-utils.js`, run the bridge with `--out=public/wouldyourather.master.csv` and commit with the `configs.yml` PAT pattern (`GH_NEW_TOKEN` checkout, `[skip authoring]` loop guard, commit only on diff). Validation runs before any write (same fail-red contract as today).

Translation carry-over on regeneration (explicit rule): for each regenerated row, key the previous committed row by `filename` when non-blank, else `video_file + '\0' + phrase`. A `*_<lang>` / `srt_<lang>` cell is carried over **iff** its English source cell is byte-identical; otherwise it is left blank for the translator to refill (blanks-only does the rest). A missed carry-over self-heals through the translate job, so this rule is safe to be conservative. Pure function in `source-bridge-utils.js` (e.g. `carryOverTranslations(prevRows, nextRows)`), unit-tested.

### 2. Recorder reads same-origin (decision)

`public/recorder.html`: replace the `spreadsheet_url` literal with the relative path `wouldyourather.master.csv` (relative so it resolves under both `/recorder.html` and the extensionless `/recorder` that Pages serves, locally and in production). Keep the `&t=` cache-buster, the RFC-4180 `parseCsvText`, the blank-`filename` filter, and the character/filename sort untouched. Same-origin `fetch` removes the CORS failure mode and the publish lag entirely.

### 3. Render reads the repo over HTTP (decision)

`docs/video-pipeline/pipeline_lib.py`: replace `SHEET_URL` with `MASTER_CSV_URL = "https://raw.githubusercontent.com/joelipi/uffenglish/main/public/wouldyourather.master.csv"`. `raw.githubusercontent.com` (not the Pages domain) so a render never waits on a Pages deploy — the CSV is fresh on `main` the moment the bot commit lands. Keep `resolve_sheet_url` and the `PIPELINE_SHEET_URL` override mechanism unchanged (branch testing still works), keep `fetch_sheet_csv` redirect handling (`SHEET_REDIRECT_STATUSES`, `MAX_SHEET_REDIRECTS`) and the HTML-body rejection (a 404 page must still fail loudly, not feed HTML into pandas). Rename identifiers (`SHEET_URL` → `MASTER_CSV_URL`, `resolve_sheet_url` keeps its name) and update the module comment. The `SheetUrlParityTest` in `test_pipeline_parity.py` is rewritten as a same-file parity test: the pipeline URL must end with `public/wouldyourather.master.csv`, and the recorder/generator sources must reference that same committed path (byte-compare the path token across the three files, raw source, proven failable by mutation on any side).

### 4. Translator and SRT write-back become file-commit flows (decision)

- New `scripts/translate-master-csv.mjs` (replacing `scripts/translate-sheet.mjs` as the CLI; the pure row planners in `scripts/lib/sheet-translate-utils.js` stay untouched): read `public/wouldyourather.master.csv` from disk, run the unchanged `planSheetTranslations` (blanks-only, human-edit-honored, stale-SRT detection), translate with the existing DeepSeek seams, apply cells with a new pure `applyTranslationsToRows(rows, plan, translations)` (replacing the `batchUpdate` payload builder at the CLI boundary), write back through a same-directory temp file + rename (the story-047 crash-safety rule). Keep the `main()` import guard, `--dry-run`/`--languages` flags, and the line-count/SRT validation failures. Workflow `translate-sheet.yml` → renamed `translate-master.yml`: drops all `GOOGLE_*` env, keeps `DEEPSEEK_API_KEY`, gains the PAT checkout + bot-commit step (`[skip translate]` loop guard, commit only on diff), keeps `workflow_call` inputs + `workflow_dispatch`.
- New `scripts/write-srt-to-csv.mjs` (replacing `scripts/write-srt-to-sheet.mjs`; `planSrtWrites`/`groupKeyForRow` move unchanged): `sync-srt.yml` keeps the R2 `video_data.csv` download step verbatim, then runs the file merge and commits with the PAT pattern (`[skip srt]` loop guard). Drops all `GOOGLE_*` env.
- `scripts/generate-config-from-sheet.mjs`: default input becomes the disk file `public/wouldyourather.master.csv` (new `--csv=<path>` override replaces `--sheet-url`; `--from-api`, `--sheet-id`, `--tab` and the `GOOGLE_*` handling are deleted along with `loadRowsFromApi`). `configs.yml` drops its `GOOGLE_*` env and the `--from-api` flag. `SHEET_URL`/`PUBLISHED_GID`/`resolveTabFromGid`/`createSheetsSeams`/`readSheetRows` (the Sheets-API seam layer in `translate-sheet.mjs`) are deleted with those files.
- Delete: `.github/workflows/source-to-sheet.yml`, `scripts/write-source-to-sheet.mjs` (+ test), `scripts/seed-master-columns.mjs` (+ test, a one-shot tool that reads the published CSV), `scripts/write-sample-sheet.mjs` iff it is Sheets-only (audit its imports first; it is referenced by `translate-sheet.mjs`/`translate-sheet.test.js`). Remove `googleapis` from `package.json` dependencies iff no remaining importer exists (verify with a grep + `npm run build` + `npx vitest run`).
- Shared CSV concurrency: every workflow that mutates the committed CSV (`source-to-csv.yml`, `sync-srt.yml`, `translate-master.yml`, `configs.yml` — the last only reads it but runs in the chain) uses one shared concurrency group (`group: master-csv`, `cancel-in-progress: false`, `queue: max`) so two writers can never interleave a read-modify-write on the same file. `pipeline.yml` keeps its own group and job order.

### 5. Guards and docs (decision)

- New `scripts/no-google-sheets.test.js`: over raw file text (no comment stripping — URLs contain `//`), assert zero occurrences of `GOOGLE_`, `docs.google.com/spreadsheets`, `2PACX`, and `gid=242913338` in `scripts/*.mjs` (excluding `*.test.js` historical references only if they assert absence — simplest: no exclusions, rewrite tests clean), `scripts/lib/*.js` (excluding `*.test.js`), `public/recorder.html`, `docs/video-pipeline/*.py`, `.github/workflows/*.yml`, `docs/video-pipeline/authoring-sheet.md`, and `docs/product.md`. Scope excludes `stories/` (historical record). Each `it` proves it can fail by inserting the forbidden token into a copy of a scanned file and re-running the matcher.
- `docs/video-pipeline/authoring-sheet.md`: rewrite the Sheets-setup, one-click, GitHub-web-UI, and "Not using Google Sheets" sections around the repo file (source.txt → master CSV → translate/SRT/configs commits). `scripts/translate-sheet-docs.test.js` is updated to the new contract (new section anchors, new tokens such as `wouldyourather.master.csv` / `wouldyourather.source.txt`, negative assertions that `GOOGLE_SERVICE_ACCOUNT_JSON`/`GOOGLE_SHEET_ID` no longer appear) while keeping the guard style: scoped section slices, raw source, per-token mutation proof. The 049/051/052 docs-contract guards keep passing in their updated form.
- `docs/product.md`: rewrite the sheet-driven feature entries (042/046/047/049/050/051/052) to repo-file wording and fix the stale Non-Goal ("lesson content is edited directly in `src/config/*.json`" → `wouldyourather.source.txt`).

## Tasks

### Task 1 - Committed master CSV + regeneration workflow

- operator edits `wouldyourather.source.txt` on `main` + push
  - → `source-to-csv.yml` validates, regenerates `public/wouldyourather.master.csv`, commits with `[skip authoring]`; invalid source fails red with the reason and writes nothing
- `carryOverTranslations(prevRows, nextRows)` with an unchanged English cell + changed English cell
  - → carries the `*_<lang>` cell in the first case; blanks it in the second
- regenerated CSV from the current source
  - → 153 rows, 108 rows with non-blank `filename`, header equal to `MASTER_HEADER`
- recorder-shape check on the committed CSV (header-keyed parse, blank-`filename` filter)
  - → 108 recordable takes
- `source-to-sheet.yml`, `write-source-to-sheet.mjs` (+ test) deleted
  - → no remaining reference to `SOURCE_SHEET_ID`, `SOURCE_SHEET_TAB`, or `GOOGLE_SOURCE_SHEET_JSON` outside `stories/`

### Task 2 - Recorder loads the same-origin CSV

- recorder page with same-origin `public/wouldyourather.master.csv` served
  - → `loadScriptDataFromSheets` loads 108 takes with no CORS error and no Google fetch
- recorder source guard (raw text, scoped to `loadScriptDataFromSheets`)
  - → contains `wouldyourather.master.csv`; contains no `docs.google.com`, no `2PACX`, no `spreadsheet_url` Google literal; mutating any pinned token makes the guard throw
- recorder with the fetch failing (offline)
  - → logs `CSV FETCH FAILED` and does not throw (existing behavior preserved)

### Task 3 - Render reads the repo CSV + parity rewritten

- `resolve_sheet_url()` with `PIPELINE_SHEET_URL` unset/set
  - → returns `MASTER_CSV_URL` / the override (existing override behavior preserved)
- `fetch_sheet_csv` with a stub returning a 307 chain then CSV, `text/html`, non-2xx
  - → follows to CSV; raises on HTML; raises on non-2xx (existing behavior preserved)
- rewritten parity test over raw sources
  - → pipeline URL ends with `public/wouldyourather.master.csv`; recorder + generator reference the same committed path; a mutation on any of the three sides throws
- `pipeline_lib.py` + `modal_app.py` source
  - → contain no `2PACX`, no `gid=242913338`, no `docs.google.com`

### Task 4 - File-based translator + bot-commit workflow

- `runTranslateCsv` (seams injected, no live credentials) with blank `cue_es` + human-edited `cue_pt` + stale `srt_es` (cue count/timings mismatch vs English `srt`)
  - → fills the blank, leaves the human edit byte-identical, re-translates and logs `STALE` for the mismatched `srt_es`
- translator CLI `--dry-run`
  - → prints the plan, writes nothing (exit 0)
- `translate-master.yml` source guard (raw text)
  - → contains PAT checkout + bot-commit + `[skip translate]` loop guard; contains no `GOOGLE_`; each pinned token fails on mutation
- `translate-sheet.mjs` deleted; `googleapis` removed from `package.json` iff no remaining importer
  - → `npm run build`, `npx vitest run`, `node scripts/run-python-tests.mjs` all green

### Task 5 - File-based SRT write-back + sync-srt commit flow

- `planSrtWrites`-equivalent over the committed CSV rows with a rendered group present
  - → writes that group's `srt` into every matching row by step key (`video_file`, else filename prefix); leaves unmatched rows untouched; never clears a cell to blank
- `sync-srt.yml` after the change
  - → keeps the R2 `video_data.csv` download step; writes via `write-srt-to-csv.mjs`; commits with PAT + `[skip srt]` loop guard only on diff; contains no `GOOGLE_` (source guard, mutation-proven)
- `write-srt-to-sheet.mjs` deleted
  - → no remaining `PUBLISHED_GID`/`resolveTabFromGid` consumer outside `stories/`

### Task 6 - Generator reads disk + configs/pipeline rewired

- generator default run (no flags) in a checkout
  - → reads `public/wouldyourather.master.csv` from disk and writes the same `src/config/<courseId>.json` bytes the old CSV path produced for identical rows
- generator `--csv=<other>` 
  - → reads the override file; `--from-api`/`--sheet-id`/`--tab` flags no longer exist (unknown-flag error or help without them)
- `configs.yml` + `pipeline.yml` source guards (raw text)
  - → `configs.yml` runs the generator without `--from-api` and without `GOOGLE_*` env; `pipeline.yml` still chains `srt` → `translate` → `configs` with `needs:` + `secrets: inherit` and calls the renamed `translate-master.yml`; each pinned token fails on mutation
- `seed-master-columns.mjs` (+ test) deleted; `write-sample-sheet.mjs` deleted iff Sheets-only
  - → no `SHEET_URL`/`spreadsheet_url` published-CSV literal remains outside `stories/`

### Task 7 - Docs rewritten + zero-Sheets guards green

- `scripts/no-google-sheets.test.js` over the scoped live files
  - → zero `GOOGLE_`, `docs.google.com/spreadsheets`, `2PACX`, `gid=242913338`; each assertion throws when the token is injected into a scanned copy
- updated `translate-sheet-docs.test.js` (new section anchors/tokens + negative `GOOGLE_*` assertions)
  - → passes; each assertion throws on mutation of the doc
- `docs/video-pipeline/authoring-sheet.md` one-click + web-UI sections
  - → describe record → render → SRT → translate → configs over repo files with no published-CSV-lag caveat for the chain (only the Pages-deploy lag for the recorder's copy, documented)
- `docs/product.md`
  - → sheet-driven entries rewritten to repo-file wording; stale `src/config/*.json` Non-Goal fixed

## Technical Context

- **Bridge (unchanged semantics):** `scripts/generate-sheet-from-source.mjs` (stdout default; `--out` writes the file; `main()` import-guarded) + `scripts/lib/source-bridge-utils.js` (`parseSourceConfig`, `sourceToRows`, `rowsToCsv`, `MASTER_HEADER` = live base + bridge config + localization columns). Current output: 153 rows, 108 with non-blank `filename`.
- **Row-logic modules (I/O changes only):** `scripts/lib/sheet-config-utils.js` (`parseCsv`, `buildCourseConfigs`), `scripts/lib/sheet-translate-utils.js` (`planSheetTranslations`, `countPresentTranslations`, `buildBatchUpdatePayload` CLI usage removed, stale-SRT rule kept), `scripts/lib/deepseek.js` (`translateText`/`translateSrt`, `deepseek-v4-flash`) stays as the translation engine.
- **Workflows:** `source-to-csv.yml` (new, replaces `source-to-sheet.yml`), `sync-srt.yml` (add PAT commit), `translate-master.yml` (renamed from `translate-sheet.yml`, add PAT commit), `configs.yml` (drop `--from-api`/`GOOGLE_*`), `pipeline.yml` (update callee name only). Shared `group: master-csv` concurrency for all CSV writers. `GH_NEW_TOKEN` (PAT) already used by `configs.yml`; `DEEPSEEK_API_KEY`, `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`, `R2_PRIVATE_BUCKET` stay; `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID`, `GOOGLE_SOURCE_SHEET_JSON`, `SOURCE_SHEET_ID`, `SOURCE_SHEET_TAB` are deleted from code and docs (dashboard-secret deletion itself is a manual operator step — see Notes).
- **Python:** `docs/video-pipeline/pipeline_lib.py` (`MASTER_CSV_URL`, `resolve_sheet_url`, `fetch_sheet_csv`, redirect constants), `docs/video-pipeline/modal_app.py` (`_fetch_assets` writes the fetched text to `video_data.csv`; post-render `video_data.csv` upload to `pipeline-assets/` unchanged), `docs/video-pipeline/tests/test_pipeline_parity.py` (parity rewritten, URL readers updated).
- **Recorder:** `public/recorder.html` (`loadScriptDataFromSheets`, RFC-4180 parser, blank-`filename` filter, sort) — only the URL constant changes.
- **Guard hygiene (AGENTS.md):** raw source for all URL/token assertions, slices scoped to the target function/section (never whole-file `toContain` for repeated tokens, never comment-stripped source), order assertions where containment would lie, and every guard proven failable by mutation before trust.
- **Verification (no CI triggers):** `npx vitest run`, `node scripts/run-python-tests.mjs`, `npm run build`, `npm run lint`. Never dispatch a workflow to test.

## Notes

- **Manual operator steps (non-automatable, do after merge):** delete the dashboard secrets/vars `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID`, `GOOGLE_SOURCE_SHEET_JSON`, `SOURCE_SHEET_ID`, `SOURCE_SHEET_TAB`; unpublish/revoke the published master link if desired; rotate nothing else. The service-account share on the "Main" spreadsheet can be removed once the old sheet is abandoned.
- **Recorder freshness is now Pages-deploy lag, not publish lag.** A bot commit to `main` redeploys Pages (`deploy.yml`); until the deploy finishes, the recorder serves the previous CSV. Same class of staleness as the old minutes-long publish lag, but versioned and visible in git. The Modal render (via `raw.githubusercontent.com`) and CI jobs (via checkout) see the commit immediately.
- **Chain write ordering is safe by construction:** `needs:` serializes `srt` → `translate` → `configs`, and each job's fresh checkout starts after the prior job's push, so every job reads the latest committed CSV. The shared `master-csv` concurrency group additionally serializes against a concurrent `source-to-csv.yml` run.
- **A source-text edit that changes English invalidates translations by design** (carry-over blanks the cell; the next translate run refills it). Until that run, configs still generate from the remaining translations — same posture as the old sheet flow.
- **Failure isolation is unchanged:** a failed dispatch, a skipped course, or a no-diff bot commit never blocks the render's published videos; any job stays manually re-runnable from the Actions UI.
