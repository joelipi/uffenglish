# One-click pipeline: a render triggers SRT write-back → translation → config generation automatically

## Context

Stories 042–050 built the pieces of a sheet-driven course pipeline, but they are **individually triggered**: after the operator records and the Modal render finishes, an operator must still click three GitHub Actions in order — **Sync SRT to Master Sheet**, **Translate Authoring Sheet**, **Generate Course Configs** — waiting between them. The operator's expectation, stated plainly, was a **one-click pipeline**: record the videos, and the course ends up configured and localized with no further actions.

Today nothing sends the `repository_dispatch (render-complete)` event that `sync-srt.yml` and `configs.yml` already accept (verified: no dispatch code exists in `docs/video-pipeline/` or `functions/`), and the three Actions do not chain. Worse, the config generator reads the **published CSV**, which lags a Sheets API write by **minutes** (operator-confirmed), so even a hand-chained run reads stale `srt`/`phrase_*` values.

This story wires the chain: the Modal orchestrator dispatches `render-complete` after a successful render; a new orchestrating workflow runs **SRT write-back → translation → config generation** in sequence as reusable-workflow jobs; and the config generator gains a **Sheets API read mode** so the chained run sees fresh values instead of waiting on the published CSV.

## Out of Scope

- **No change to the render stages, R2 layout, or the recorder UI.** The recorder keeps polling `/api/pipeline/status`; the dispatch fires from Modal, not the browser.
- **No new translation transport or caption behavior.** `captions.yml` (SRT localization for fr/hi) is not part of this chain.
- **No auto-merge to `main`.** The configs job commits to the branch it runs on, exactly as today.
- **No polling/scheduling.** The trigger is a push-style `repository_dispatch` from Modal; no cron or status-polling Action.
- **No change to the published-CSV path for the recorder or local CLI use.** `--from-api` is opt-in; the default generator still reads `SHEET_URL`.

## Implementation approach

### 1. Modal dispatches `render-complete` on success (decision)

After the orchestrator's publish step succeeds (before/at the `_write_status(..., "done", ...)` point), `docs/video-pipeline/modal_app.py` sends one GitHub `repository_dispatch`:

- `POST https://api.github.com/repos/<owner>/<repo>/dispatches` with `{"event_type": "render-complete", "client_payload": {"jobId": …, "published": […]}}`, headers `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`.
- **Config from env** (so it is testable and not hardcoded): `GH_DISPATCH_REPO` (e.g. `joelipi/uffenglish`) and `GH_DISPATCH_TOKEN`. Both come from a new Modal secret `uff-github` attached to the orchestrator; when either is unset the dispatch is skipped with a logged warning (a self-hosted/local run stays green).
- **Best-effort**: a dispatch failure is logged and recorded in the `done` status `extra` (`dispatch: "failed: …"`), and never fails the render (the videos are already published). A successful dispatch records `dispatch: "sent"`.
- The dispatch helper is a small pure function taking `(repo, token, payload, fetchImpl)` so it is unit-tested with a stub `fetchImpl`; the orchestrator wiring is source-guarded.

### 2. One orchestrating workflow; the three existing ones become reusable (decision)

- Add `on: workflow_call` to `sync-srt.yml`, `translate-sheet.yml`, and `configs.yml`, declaring the inputs each needs (translate: `dry_run` default `false`, `languages` default `es,pt,bn`). Keep their `workflow_dispatch` triggers.
- **Remove the `repository_dispatch` trigger from `sync-srt.yml` and `configs.yml`** — the new `pipeline.yml` owns it, so a `render-complete` event fires the chain exactly once.
- New `.github/workflows/pipeline.yml`:
  - `on: repository_dispatch: types: [render-complete]` and `workflow_dispatch:`.
  - `concurrency: group: pipeline-${{ github.ref }}, cancel-in-progress: false` (one run per ref; the downstream sheet writes already have their own global groups).
  - Jobs, chained with `needs`: `srt` (calls `sync-srt.yml`) → `translate` (calls `translate-sheet.yml` with defaults) → `configs` (calls `configs.yml`), each `secrets: inherit`.
  - `permissions: contents: read` at the top level; the called `configs` workflow keeps its own write needs via the inherited `GH_NEW_TOKEN`.
- Rationale for reusable workflows over `gh workflow run`: the ordering and failure propagation are expressed by `needs:`, no cross-workflow token is needed for the chaining itself, and each step stays independently runnable from the Actions UI.

### 3. Config generator reads the sheet via the API (removes the published-CSV lag)

- `scripts/generate-config-from-sheet.mjs` gains `--from-api`: read the sheet with the service account (`values.get`) instead of the published CSV, so the chained `configs` job sees the `srt` and `phrase_*` cells the preceding jobs just wrote, immediately.
  - Reuse `createSheetsSeams` / `resolveTabFromGid` / `PUBLISHED_GID` (`scripts/translate-sheet.mjs`) and `rowsFromValues` (`scripts/lib/sheet-translate-utils.js`) to produce the same header-keyed `rows` shape `parseCsv` gives, then call `buildCourseConfigs(rows)` unchanged.
  - Sheet id from `--sheet-id`/`GOOGLE_SHEET_ID`; tab from `--tab` or the published gid.
  - Without `--from-api` the CLI behaves exactly as today (published CSV). `configs.yml` passes `--from-api` and receives `GOOGLE_SERVICE_ACCOUNT_JSON` + `GOOGLE_SHEET_ID`.
- The pure module (`sheet-config-utils.js`) is untouched — only the CLI's I/O source changes.

### 4. Operator setup (documented, not code)

- Add Modal secret `uff-github` with `GH_DISPATCH_TOKEN` (a fine-grained PAT with **Contents: read and write**, which `repository_dispatch` requires) and `GH_DISPATCH_REPO` (`joelipi/uffenglish`), attached to the orchestrator (`modal deploy docs/video-pipeline/modal_app.py`).
- After this, the operator's only action is: record takes → press render. `pipeline.yml` then runs SRT write-back → translate → configs automatically.

## Tasks

### Task 1 - Modal dispatches `render-complete`

- `dispatch_render_complete(repo, token, payload, fetchImpl)` with a stub `fetchImpl`
  - → POSTs to `https://api.github.com/repos/<repo>/dispatches` with `event_type: "render-complete"` and the payload in `client_payload`
  - → sends `Authorization: Bearer <token>` and `Accept: application/vnd.github+json`
  - → returns `{sent: true}` on 2xx; `{sent: false, error}` on non-2xx or a thrown fetch (never raises)
- the orchestrator with `GH_DISPATCH_REPO`/`GH_DISPATCH_TOKEN` set and a successful render
  - → calls the dispatch once after publish; the `done` status `extra.dispatch === "sent"`
- the orchestrator with either env unset
  - → skips the dispatch, still writes `done`, and the run does not fail
- a source guard over `modal_app.py`
  - → contains the dispatch call and the `GH_DISPATCH_TOKEN` reference; removing either makes the guard throw

### Task 2 - Orchestrating workflow + reusable workflows

- `.github/workflows/pipeline.yml` source guard (raw text)
  - → contains `repository_dispatch:`, `types: [render-complete]`, `workflow_dispatch:`, the three reusable-workflow calls, `needs:` chaining `srt` → `translate` → `configs`, and `secrets: inherit`
  - → does not contain `git commit`/`git push` (it delegates to `configs.yml`)
  - → each pinned token, when mutated, makes the guard throw
- `sync-srt.yml` and `configs.yml`
  - → no longer contain `repository_dispatch` (the chain owns it); `sync-srt.yml` still has `workflow_dispatch` and `workflow_call`
- `translate-sheet.yml`
  - → declares `workflow_call` with `dry_run`/`languages` defaults; `workflow_dispatch` unchanged

### Task 3 - `--from-api` in the config generator

- `generate-config-from-sheet.mjs --from-api` with an injected Sheets seam
  - → reads the sheet via `values.get` and produces the same `rows` shape as the published-CSV path (header-keyed, lower-cased)
  - → writes the same `src/config/<courseId>.json` the CSV path would for identical cell values
- without `--from-api`
  - → reads the published CSV (existing tests stay green)
- `--from-api` with `GOOGLE_SERVICE_ACCOUNT_JSON` missing
  - → exits non-zero naming the env var
- `configs.yml` after the change
  - → runs the generator with `--from-api` and receives `GOOGLE_SERVICE_ACCOUNT_JSON`/`GOOGLE_SHEET_ID` (source guard)

### Task 4 - Docs

- `docs/video-pipeline/authoring-sheet.md` (or a runbook section)
  - → documents the automatic flow (record → render → SRT → translate → configs), the Modal `uff-github` secret, and that the published-CSV lag only affects manual reads, not the pipeline (which uses the API)

## Technical Context

- **Trigger point:** `docs/video-pipeline/modal_app.py` `orchestrator` (line 102) ends at `_write_status(job_id, "done", "publish", {...})` (~line 150) after `_publish`; `storage.py` routes R2; the Modal secret attached today is `uff-r2` (`modal.Secret.from_name("uff-r2")`, line 63).
- **Dormant triggers:** `.github/workflows/configs.yml` and `.github/workflows/sync-srt.yml` each have `on: repository_dispatch: types: [render-complete]` with nothing sending it; `configs.yml` commits with `secrets.GH_NEW_TOKEN` and runs `node scripts/generate-config-from-sheet.mjs --check`.
- **Sheet API seams:** `scripts/translate-sheet.mjs` exports `createSheetsSeams`, `resolveTabFromGid`, `PUBLISHED_GID`; `scripts/lib/sheet-translate-utils.js` exports `rowsFromValues`; scope `https://www.googleapis.com/auth/spreadsheets`; secret `GOOGLE_SERVICE_ACCOUNT_JSON`; variable `GOOGLE_SHEET_ID`.
- **Generator:** `scripts/generate-config-from-sheet.mjs` fetches `SHEET_URL` then `parseCsv` + `buildCourseConfigs` (`scripts/lib/sheet-config-utils.js`); `--check` is the CI mode; `SHEET_URL` is source-guarded against `public/recorder.html`.
- **Existing workflow guards:** `scripts/configs-workflow.test.js`, `scripts/translate-sheet-workflow.test.js`, `scripts/sync-srt-workflow.test.js` — follow their raw-source + mutation style.
- **Operator's published-CSV lag:** minutes (operator-confirmed), which is why `configs.yml` must read via the API in the chain.
- **Guard hygiene (`AGENTS.md`):** assert raw source (URLs contain `//`); scope whole-file assertions to tokens that appear once; prove every guard can fail by mutation.

## Notes

- **The `uff-github` token is a new operator-managed secret** (Modal) with `contents: write`; it is the one new credential this story needs. Rotation: replace the Modal secret value and `modal deploy` is not required (secrets are read at call time), but the Modal app must be redeployed once to attach the secret.
- **Failure isolation:** a dispatch failure or a skipped course leaves the render's videos published; the operator can still run any of the three Actions manually. `pipeline.yml` is best-effort in the same spirit as `configs.yml` (a missing required column skips that course, not the chain).
- **Ordering is guaranteed by `needs:`**, not by polling; because every sheet write and the config read go through the Sheets API, the minutes-long published-CSV lag no longer affects the chain.
- **`configs.yml` still reads via `--from-api` even when run manually**, so a manual run is also lag-free; the local `npm run configs:generate` keeps the published-CSV default (no credentials required on a dev machine).
