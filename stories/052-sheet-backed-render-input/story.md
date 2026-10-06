# The Modal render reads the published sheet directly (no manual R2 CSV upload)

## Context

Stories 040–051 built a sheet-driven pipeline, but the **render still reads its input from R2**, not from the sheet: `docs/video-pipeline/modal_app.py` `_fetch_assets` downloads `pipeline-assets/video_data.csv` from the private bucket, and the only way that object gets the sheet's content is the operator running `npm run pipeline:upload-assets` locally. The operator edits the sheet constantly (it is the source of truth), so this copy goes stale the moment the next edit lands — and a missing/old `video_data.csv` makes the render fail or use the wrong content. "One master sheet" is therefore not true for the render path today.

This story makes the **published sheet the render's input**: the Modal orchestrator fetches the sheet's published CSV over HTTP into its work dir instead of downloading `pipeline-assets/video_data.csv`. The R2 object stops being the render's *input* and becomes only the post-render **output** (the CSV with the computed `srt` column that the sync-srt Action reads). After this, the operator maintains the sheet and records takes — nothing is uploaded to R2 by hand.

## Out of Scope

- **No change to the render stages, the asset trees, or the publish path.** Fonts/backgrounds/audio/overlays still come from `pipeline-assets/`.
- **No change to the local (`Windows`) `video_pipeline.py` flow**, which keeps reading a local `video_data.csv` (`--render-only` etc.).
- **No removal of `pipeline-assets/video_data.csv` as the post-render SRT store** (sync-srt.yml reads it; the render still uploads the updated CSV there).
- **No change to the recorder or the config generator** — they already read the sheet (recorder: published CSV; generator: Sheets API).
- **No new dependency.** Fetching the URL uses stdlib `urllib`.

## Implementation approach

### 1. One shared sheet URL in Python, parity-guarded (decision)

Add `SHEET_URL` to `docs/video-pipeline/pipeline_lib.py` with the same published master URL the JS side uses (`scripts/generate-config-from-sheet.mjs` `SHEET_URL`, `public/recorder.html` `spreadsheet_url`). The repo's cross-runtime rule is one constant per language, parity-tested — add the assertion to `docs/video-pipeline/tests/test_pipeline_parity.py` (it already reads JS constants) so a URL drift fails loudly. Allow an operator override via the `PIPELINE_SHEET_URL` env (default `SHEET_URL`), preserving story 040's "change content without a `modal deploy`" property.

### 2. Modal fetches the sheet as `video_data.csv` (decision)

- `docs/video-pipeline/modal_app.py` `_fetch_assets`: replace the `storage.download_to(pipeline_asset_key("video_data.csv"), …)` call with a fetch of `PIPELINE_SHEET_URL` (default `SHEET_URL`) written to `<workdir>/video_data.csv`. Google publishes via a **307 redirect**, so the fetch MUST follow redirects.
- Add a small pure helper (e.g. `pipeline_lib.fetch_sheet_csv(url, fetch_impl)` or in `modal_app.py`) that fetches with `urllib.request.urlopen` and follows redirects, returns the CSV text, and raises a clear error on a non-200 or an HTML body (a sign-in/redirect page) so a broken publish fails loudly rather than feeding HTML into pandas.
- Keep `_fetch_takes` and the asset-tree loop unchanged. The render still writes the updated CSV (with `srt`) to `pipeline-assets/video_data.csv`, so sync-srt.yml is unaffected.
- The published CSV lags a sheet edit by minutes; the render happens after the operator records takes, so this is acceptable. Document it.

### 3. Docs

- Update `docs/video-pipeline/authoring-sheet.md`'s one-click section and `docs/video-pipeline/README.md` to state the render reads the published sheet directly (no manual `video_data.csv` upload); `pipeline-assets/video_data.csv` is now a post-render output read by sync-srt. Update the one-click docs guard.

## Tasks

### Task 1 - Shared Python `SHEET_URL` + parity

- `pipeline_lib.SHEET_URL` and the JS `SHEET_URL`/recorder `spreadsheet_url`
  - → are byte-identical (parity test reads both and asserts equality)
  - → a mutation of either side makes the parity test throw
- `_fetch_assets` with `PIPELINE_SHEET_URL` unset
  - → uses `SHEET_URL`; with it set → uses the override (source guard / behavioral)

### Task 2 - Modal fetches the sheet instead of R2 input

- `fetch_sheet_csv(url, fetch_impl)` with a stub `fetch_impl` that 307-redirects
  - → follows the redirect and returns the final CSV text
- `fetch_sheet_csv` with a stub returning `text/html`
  - → raises a clear error (does not return HTML)
- `fetch_sheet_csv` with a non-2xx final response
  - → raises a clear error
- a source guard over `modal_app.py` `_fetch_assets`
  - → calls the sheet fetch for `video_data.csv`; no `pipeline_asset_key("video_data.csv")` download remains; removing the fetch call makes the guard throw
- the render still uploads the updated CSV to `pipeline-assets/video_data.csv`
  - → the existing source guard for that upload still passes

### Task 3 - Docs

- `docs/video-pipeline/authoring-sheet.md` one-click section
  - → states the render reads the published sheet directly and no manual `video_data.csv` upload is needed; `pipeline-assets/video_data.csv` is a post-render output
  - → the docs source guard asserts it (and can fail on mutation)

## Technical Context

- **Render input today:** `docs/video-pipeline/modal_app.py` `_fetch_assets` (line ~95) downloads `pipeline_asset_key("video_data.csv")`; `pipeline_asset_key` and `PIPELINE_ASSET_PREFIX` live in `pipeline_lib.py`; `storage.py` routes `pipeline-assets/` to the private bucket.
- **Post-render output:** `modal_app.py` orchestrator calls `pipeline.write_srt_column(...)` then `storage.upload_file(csv_file, pipeline_asset_key("video_data.csv"), …)` (story 050), which sync-srt.yml downloads via `wrangler r2 object get`.
- **The atom to fetch:** the published master `2PACX-1vQZ7jFMJNnmylDoHxaqb1W8VyXi0OV4pSubCbqMGYkRgGimqWx3cs74n43-cFxqfue4KCiqWlhzvPkK` / gid `242913338`, identical to `scripts/generate-config-from-sheet.mjs` `SHEET_URL` and `public/recorder.html` `spreadsheet_url`.
- **Redirect:** the `/pub?…&output=csv` URL returns HTTP 307 to a `googleusercontent.com` URL; a client must follow redirects (`fetch` does; `urllib` needs a redirect handler, which is the default for `urlopen` but must be asserted).
- **Parity tests:** `docs/video-pipeline/tests/test_pipeline_parity.py` reads JS constants (`scripts/lib/video-optimize-utils.js`, `poster-utils.js`, `src/modules/video/pipeline-keys.js`); extend it to read `scripts/generate-config-from-sheet.mjs`/`public/recorder.html` for the sheet URL.
- **Modal env:** `modal_app.py` `cpu_image.env({...})`; secrets `uff-r2` (R2) and `uff-github` (dispatch).
- **No new deps:** stdlib `urllib`.
- **Guard hygiene (`AGENTS.md`):** raw source (URLs contain `//`), scoped assertions, can-fail mutations.

## Notes

- **This closes the last manual prerequisite** between "the sheet is the source of truth" and "record → render is one-click." After it, the operator's only steps are sheet edits and recording; nothing is uploaded to R2 by hand.
- **`pipeline:upload-assets` no longer handles `video_data.csv`.** It was removed from `KNOWN_ASSET_FILES` (and the uploader's help/comment text) because story 052 makes that R2 key the post-render output: uploading a stale local copy would clobber the CSV carrying the `srt` column that `sync-srt.yml` reads. The uploader now covers only `fonts/`, `backgrounds/`, `audio/` and `overlays/`; the local (`Windows`) `video_pipeline.py` flow still reads a local `video_data.csv`.
- **Failure mode:** if the sheet is not published (or the publish is broken), the render now fails fast with a clear "sheet fetch/HTML" error instead of silently rendering stale R2 content — the intended signal.
