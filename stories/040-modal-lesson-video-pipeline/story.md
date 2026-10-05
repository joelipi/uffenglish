# Run the lesson-video pipeline in the cloud (Modal + R2 + Cloudflare Pages Functions)

## Context

Lesson videos are authored with `docs/video-pipeline/video_pipeline.py`, a single
Python script that turns phone takes into the two files the app expects
(`output/social/<name>.mp4` and `output/web/<name>.mp4`, per
`docs/video-pipeline/README.md`). The operator records takes on a phone with the
vendored studio `public/recorder.html` (served at `/recorder`, unlisted,
noindex), then does the whole handoff by hand on a Windows PC:

1. The recorder's **Accept** button runs `<a download>` with
   `(current_line_meta.filename || "take_<index>") + ".mp4"` (`recorder.html:962-971`),
   where `filename` comes from a published Google Sheet CSV (`recorder.html:867`).
2. Every downloaded take is dragged into `rawvideos/`.
3. `python video_pipeline.py` is run on the PC.

`filename` is the join point: Stage 1 only processes
`rawvideos/<csv filename>.mp4` (`video_pipeline.py:548-550`), and the app
lesson configs reference the same slug. Stage 2 already runs on Modal
(`video_pipeline.py:627-640`, `@app.function(image=image, gpu="T4", timeout=3600)`),
so the GPU part is proven; only the orchestration, storage and handoff are
PC-bound.

This story removes the middle+render+handoff from the PC. The phone uploads each
take straight to Cloudflare R2; a Pages Function (holding the Modal token
server-side) starts a Modal render for a filename set; the Modal app fetches the
takes and assets, runs Stages 1-3 (reusing the existing T4 GPU function),
publishes `output/web` to `assets/videos/<slug>.mp4` plus its poster, and writes
a status marker the recorder polls. Cloudflare runs no Python: Workers/Functions
cannot run moviepy/ffmpeg/Chrome, so Cloudflare is storage + trigger only, Modal
is the runner.

Two constraints drive the design. First, the R2 lifecycle TTL of 48h is scoped to
the `videos/` prefix (`wrangler.toml:8-10`), so raw takes and pipeline assets must
NOT use `videos/` or `assets/videos/` — this story uses new `raw/` and
`pipeline-assets/` prefixes. Second, `public/recorder.html` has no React/Supabase
session, so auth is an operator key entered at runtime, sent in a request header,
and verified server-side against a Pages env secret; it is never bundled into the
static page. Cloudflare Access is a later option and is out of scope.

## Out of Scope

- **Cloudflare Access / real identity.** The operator key is a single shared
  secret, acceptable at this stage. No per-operator keys, no user accounts, no
  Supabase JWT on the pipeline endpoints, no rate limiting.
- **The existing PC/local flow.** `python video_pipeline.py`, `run.bat`, and the
  `rawvideos/`-relative workflow keep working unchanged; this story does not
  delete them and does not remove the recorder's ability to save a take to the
  device.
- **Stage 2 model/GPU changes.** BiRefNet, `gpu="T4"`, `timeout=3600` and the
  frame algorithm in `process_video_background_modal` are reused as-is.
- **Changing the BiRefNet/torch/transformers stack or the GPU function's image.**
  Only the orchestrator (CPU) image is newly pinned.
- **Friend/UGC clips** (`{friendCode}…-response-NN`) and the browser-side
  `assets/videos`/`videos/` upload path (`functions/api/upload-segment.js`).
- **`_full` group videos as published slugs.** Only per-row `processed_<filename>`
  outputs and `join` outputs are published (see Implementation approach).
- **Automatic cleanup/lifecycle for `raw/` takes or `pipeline-assets/`.**
  Retention is an operator concern (documented, not automated).
- **Rendering progress at frame granularity.** Status is stage-level.
- **Retries/resume, multi-clip batch queueing, cost dashboards, or CI deploys of
  the Modal app.** Deploy stays a manual `modal deploy`.
- **Baking assets into the image.** Assets are fetched from R2, not baked.
- **The Google Sheet → `video_data.csv` sync.** The operator keeps maintaining
  the pipeline CSV; this story only relocates it to R2.

## Implementation approach

### Phases

- **Phase A — storage + trigger + recorder (JS, Cloudflare Pages).** Tasks 1-3 and 6.
- **Phase B — pipeline refactor + Modal runner (Python).** Tasks 4, 5 and 7.
- **Phase C — operator tooling, docs, cost.** Tasks 8 and 9.

### Shared naming rules (single source of truth)

New `src/modules/video/pipeline-keys.js` is imported by every new Pages Function
and mirrored by `docs/video-pipeline/pipeline_lib.py`:

```js
export const PIPELINE_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
export const PIPELINE_JOB_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
export function isValidPipelineSlug(name)  // PIPELINE_SLUG_PATTERN.test(name)
export function rawTakeKey(slug)           // `raw/${slug}.mp4`
export function statusKey(jobId)           // `raw/status/${jobId}.json`
export function publishedVideoKey(slug)    // `assets/videos/${slug}.mp4`
export function publishedPosterKey(slug)   // `assets/videos/${slug}.jpg`
export function pipelineAssetKey(relPath)  // `pipeline-assets/${relPath}`
```

Slugs are the bare CSV `filename` values (no extension), restricted to
`[A-Za-z0-9_-]`, first char alphanumeric, ≤100 chars. This rejects `..`, `/`,
leading dots, and `.mp4` suffixes. Raw takes live at `raw/<slug>.mp4` — never
under `videos/` or `assets/videos/` (48h TTL). Published media keeps the existing
`assets/videos/<slug>.mp4` convention the app already reads
(`src/modules/video/video-url.js:6`); its 0.2s sibling poster is
`assets/videos/<slug>.jpg` (the uniform poster rule, `getPosterUrl`).

### Raw upload (Task 2)

`functions/api/pipeline/upload-raw.js` copies the shape of
`functions/api/upload-segment.js`: `UFF_R2` binding, `httpMetadata` write,
`MAX_R2_UPLOAD_BYTES` cap, required headers. Differences: operator-key auth
instead of Supabase JWT, filename from `x-filename` (bare slug), body is the raw
take, `cacheControl: 'no-store'` (raw takes are transient). Overwrite is an R2
`put` on a deterministic key, so a re-take is idempotent. Fails closed (500) when
`OPERATOR_KEY` is unset.

### Trigger + status (Task 3)

`functions/api/pipeline/render.js` (POST `{ files: [slug,…] }`):

1. Verify `x-operator-key` against `env.OPERATOR_KEY` (401).
2. Validate `files` is a non-empty array of `isValidPipelineSlug` (400).
3. `jobId = crypto.randomUUID()`.
4. POST `{ jobId, files }` to `env.MODAL_RENDER_URL` with `Modal-Key:
   env.MODAL_PROXY_TOKEN_ID`, `Modal-Secret: env.MODAL_PROXY_TOKEN_SECRET`
   (the deployed Modal endpoint is `requires_proxy_auth=True`). 502 if upstream
   is not ok; 500 if env is missing.
5. Return `{ jobId }`. Never echo the proxy token.

`functions/api/pipeline/status.js` (GET `?id=<jobId>`): validate the id against
`PIPELINE_JOB_ID_PATTERN`, `env.UFF_R2.get(statusKey(id))`, 404 when absent,
otherwise return the parsed `raw/status/<jobId>.json`.

Shared auth lives in `functions/api/pipeline/auth.js` (`x-operator-key` header,
constant-time-ish equality, 401/500) so the three endpoints cannot drift.

### Modal app (Task 7)

`docs/video-pipeline/modal_app.py` joins the existing app rather than starting a
second one: `video_pipeline.py`'s `app` is renamed to
`modal.App("uff-lesson-video")` and keeps the T4 `process_video_background_modal`
function; `modal_app.py` does `from video_pipeline import app, process_video_background_modal`
and attaches the orchestrator and the web endpoint to that same app, so one
`modal deploy docs/video-pipeline/modal_app.py` ships orchestrator + GPU function.

- `cpu_image`: `debian_slim(python_version="3.12")`, `apt_install("ffmpeg",
  "chromium", "libgl1", "libglib2.0-0")`, pip pins (Bootstrap), local source
  (`add_local_dir("docs/video-pipeline", remote_path="/root/pipeline")` +
  `PYTHONPATH=/root/pipeline`), and env `PIPELINE_WORKDIR=/tmp/pipeline-work`,
  `PIPELINE_CHROME_NO_SANDBOX=1`, `PIPELINE_WEB_TARGET_LONG_EDGE=720`,
  `PIPELINE_WEB_AUDIO_BITRATE=96k`.
- `secret = modal.Secret.from_name("uff-r2")` (`R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) attached to the
  orchestrator only.
- `orchestrator(spec)` (`image=cpu_image`, `cpu=8`, `memory=16384`,
  `timeout=7200`, `secrets=[secret]`): fetch `pipeline-assets/video_data.csv`,
  the `pipeline-assets/{backgrounds,audio,overlays,fonts}/` trees, and
  `raw/<slug>.mp4` for each requested slug into `PIPELINE_WORKDIR`; run
  `video_pipeline.run_silence_removal` → `run_background_removal` →
  `process_video_batch(only=files)` → `concatenate_all_processed_videos` →
  `concatenate_joined_videos`; build the publish plan; for each entry publish
  `output/web/<web_name>` to `assets/videos/<slug>.mp4` and a 0.2s poster to
  `assets/videos/<slug>.jpg`; write status after every stage; return a summary.
- `trigger(spec: dict)` (`@modal.fastapi_endpoint(method="POST",
  requires_proxy_auth=True)`, minimal `fastapi[standard]` image): validate,
  `orchestrator.spawn(spec)`, return `{ jobId }`.
- Storage is `docs/video-pipeline/storage.py` (boto3, S3-compatible endpoint
  `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`, bucket from `R2_BUCKET`,
  default `uff`). Keys come from `pipeline_lib` so Python and JS cannot drift.
- Publishing enforces the 032 budget: `pipeline_lib.is_within_web_budget(probe)`
  checks long edge ≤720 and total bitrate ≤1,500,000 bps and faststart; if it
  fails, `reencode_web_args` re-encodes with the exact 032 arguments (CRF 26,
  `medium`, maxrate 1.5M, bufsize 3M, main, yuv420p, AAC 96k, faststart). The
  container sets the pipeline web target to 720, so the fallback is rare.

### Pipeline refactor (Task 5)

All cwd-relative paths become `PIPELINE_WORKDIR`-relative so the same file runs on
Windows (`PIPELINE_WORKDIR` unset → `Path.cwd()`) and in the container
(`PIPELINE_WORKDIR=/tmp/pipeline-work`):

- `pipeline_lib.resolve_work_dir(os.environ)` returns `Path.cwd()` when
  `PIPELINE_WORKDIR` is unset and that path otherwise; the directory constants
  (`RAWVIDEOS_DIRECTORY`, `FONT_DIRECTORY`, `BACKGROUNDS_DIRECTORY`,
  `OVERLAYS_DIRECTORY`, `OVERLAYS_TEMP_DIRECTORY`, `NO_SILENCE_DIRECTORY`,
  `VIDEO_DIRECTORY`, `AUDIO_DIRECTORY`, `CSV_FILE`, `SOCIAL_DIR`, `WEB_DIR`)
  become absolute under it.
- `resolve_csv_file` scans `WORK_DIR`, not `.`.
- `create_overlay_html`'s `file://` font URLs use the absolute `FONT_DIRECTORY`.
- New `--only slug[,slug…]` restricts Stage 1/2/3 to a filename set; rows whose
  processed file is absent are skipped without failing the run, because the
  cloud downloads only the requested takes.
- Chrome flags append `--no-sandbox` only when `PIPELINE_CHROME_NO_SANDBOX` is set
  (required when Chromium runs as root in the container).
- Web profile reads `PIPELINE_WEB_TARGET_LONG_EDGE` (default 1280) and
  `PIPELINE_WEB_AUDIO_BITRATE` (default 128k), so the container can target the
  032 budget without changing the PC default.
- `process_video_background` wraps the GPU `.remote()` call in `with app.run()`
  only when `modal.is_local()`; inside a Modal container it calls `.remote()`
  directly.

### Publish plan (pure, Task 4)

`plan_publish(rows, join_values, web_listing, only=None)` → ordered list of
`{ slug, web_name, video_key, poster_key }`:

- Per CSV row `filename` in scope (all rows when `only` is None, else the
  intersection): slug = `filename`, `web_name =
  processed_<filename>_no_silence_bg_removed.mp4`.
- Per join value `join_value`: slug = `join_value`, `web_name =
  <join_value>.mp4`.
- Keep an entry only when `web_name` is in `web_listing` (the actual
  `output/web` contents), dedup by slug (first wins), preserve first-seen order.
- Never emit a slug that fails `is_valid_slug` or a key under `videos/` or
  `assets/videos/` other than `assets/videos/<slug>.mp4`/`.jpg`.

Posters use `poster_args` mirroring `scripts/lib/poster-utils.js`
(`-ss 0.2 -vframes 1 -vf scale=640:-2 -q:v 8`); a parity test asserts the Python
constants equal the JS ones, and another asserts the web-budget constants equal
`scripts/lib/video-optimize-utils.js` (`MAX_VIDEO_WIDTH = 720`,
`MAX_TOTAL_BITRATE_BPS = 1_500_000`, `X264_CRF = 26`).

### Cost

`estimate_cost({ gpu_seconds, cpu_core_seconds, memory_gib_seconds })` uses the
2026-10-05 Modal rates: T4 `$0.000164/s`, CPU `$0.0000131/core/s`, memory
`$0.00000222/GiB/s`. A representative take (Stage 2 ~120s T4; 8 CPU cores
~300s; 16 GiB ~300s) lands ≈ $0.06, inside the $0.05-$0.10 estimate. The
orchestrator logs wall/CPU/billed seconds per run so the manual measurement in
Task 7 can replace the estimate with a real number recorded in this story's
Notes.

## Tasks

### Task 1 - Shared pipeline key and filename rules (JS)

New `src/modules/video/pipeline-keys.js` and `src/modules/video/pipeline-keys.test.js`.

- `isValidPipelineSlug` on `lesson_01`, `Take-3`, `a` (single char)
  - → `true`
- `isValidPipelineSlug` on `../evil`, `a/b`, `.hidden`, ``, `a.mp4`, a 101-char
  string
  - → `false` for each
- `rawTakeKey('lesson_01')`
  - → `raw/lesson_01.mp4`
  - → does not start with `videos/` or `assets/`
- `statusKey('job-abc12345')`
  - → `raw/status/job-abc12345.json`
- `statusKey('bad/id')` and `statusKey('short')`
  - → `null`
- `publishedVideoKey('lesson_01')` / `publishedPosterKey('lesson_01')`
  - → `assets/videos/lesson_01.mp4` / `assets/videos/lesson_01.jpg`
- `pipelineAssetKey('fonts/Kalam-Bold.ttf')`
  - → `pipeline-assets/fonts/Kalam-Bold.ttf`

### Task 2 - Raw upload Pages Function

New `functions/api/pipeline/upload-raw.js`, `functions/api/pipeline/auth.js`,
`functions/api/pipeline/auth.test.js`, `functions/api/pipeline/upload-raw.test.js`.
Tests call `onRequestPost({ request, env })` with fake `request`/`env` objects and
a fake `UFF_R2.put`, mirroring `functions/api/upload-segment.test.js`.

- request with no `x-operator-key`
  - → 401, `UFF_R2.put` not called
- request with `x-operator-key` ≠ `env.OPERATOR_KEY`
  - → 401
- request with a valid key but missing/invalid `x-filename` (`../x`, `a/b`, `x.mp4`, empty)
  - → 400, `UFF_R2.put` not called
- request with `content-length` > `MAX_R2_UPLOAD_BYTES`
  - → 413, `UFF_R2.put` not called
- request with a body > cap and no `content-length`
  - → 413
- request with a body exactly at the cap
  - → 200
- valid request (`x-filename: lesson_01`, `Content-Type: video/mp4`)
  - → `UFF_R2.put` called with `raw/lesson_01.mp4`, the body bytes, and
    `{ httpMetadata: { contentType: 'video/mp4', cacheControl: 'no-store' } }`
  - → 200 body has `url: 'https://r2.ultrafastfluency.com/raw/lesson_01.mp4'`
- two valid requests for the same `x-filename`
  - → `UFF_R2.put` called twice with the same key (idempotent overwrite)
- `env.OPERATOR_KEY` unset
  - → 500, `UFF_R2.put` not called
- (source guard) `functions/api/pipeline/upload-raw.js` imports `rawTakeKey` from
  `../../../src/modules/video/pipeline-keys.js` and contains no literal `'raw/'`

### Task 3 - Trigger and status Pages Functions

New `functions/api/pipeline/render.js`, `functions/api/pipeline/status.js`,
`functions/api/pipeline/render.test.js`, `functions/api/pipeline/status.test.js`.
`fetch` is stubbed with `vi.stubGlobal`, as in
`functions/api/upload-segment.test.js`.

- `render` POST with no/wrong operator key
  - → 401, `fetch` not called
- `render` POST with `files` missing, empty, not an array, or containing `../x`
  - → 400, `fetch` not called
- `render` POST with `env.MODAL_RENDER_URL` / `MODAL_PROXY_TOKEN_ID` /
  `MODAL_PROXY_TOKEN_SECRET` unset
  - → 500, `fetch` not called
- valid `render` POST (`files: ['lesson_01']`)
  - → `fetch` called once with `env.MODAL_RENDER_URL`
  - → request headers include `Modal-Key`/`Modal-Secret` from env
  - → request body includes a `jobId` matching `PIPELINE_JOB_ID_PATTERN` and the
    files
  - → 200 response body is `{ jobId }` and contains neither token value
- `render` POST when the Modal endpoint responds non-2xx
  - → 502
- `status` GET with no/wrong operator key
  - → 401, `UFF_R2.get` not called
- `status` GET with `id=../x` or `id=short`
  - → 400
- `status` GET where `UFF_R2.get(statusKey(id))` returns null
  - → 404
- `status` GET where the object text is a valid status JSON
  - → 200 with the parsed object and `content-type: application/json`

### Task 4 - Pure Python pipeline library and test harness

New `docs/video-pipeline/pipeline_lib.py` (stdlib only — no modal/moviepy/torch
imports), `docs/video-pipeline/tests/run_all.py`,
`docs/video-pipeline/tests/test_pipeline_lib.py`,
`docs/video-pipeline/tests/test_pipeline_parity.py`, and
`scripts/run-python-tests.mjs`; wire `pretest`/`test:python` in `package.json`.

- `is_valid_slug` accepts `lesson_01`, `Take-3`, `a`; rejects `../x`, `a/b`,
  `.hidden`, ``, `a.mp4`, and a 101-char string
- `raw_take_key('lesson_01')` → `raw/lesson_01.mp4`;
  `published_video_key`/`published_poster_key` → `assets/videos/<slug>.mp4`/`.jpg`;
  `status_key('job-abc12345')` → `raw/status/job-abc12345.json`; `status_key`
  returns `None` for invalid
- `processed_web_name('lesson_01')` →
  `processed_lesson_01_no_silence_bg_removed.mp4`
- `plan_publish` with rows `[lesson_01, lesson_02]`, join value `lessonFinal`,
  `web_listing` containing `processed_lesson_01_…` and `lessonFinal.mp4`
  - → entries for `lesson_01` and `lessonFinal` only, in that order, each with
    the correct `video_key`/`poster_key`
- `plan_publish` with `only=['lesson_02']` where only `lesson_01` is rendered
  - → `[]`
- `plan_publish` where a join value equals a row filename
  - → one entry (dedup, first wins)
- `plan_publish` never returns a slug failing `is_valid_slug` or a key under
  `videos/` or `assets/videos/` other than the published pair
- `is_within_web_budget({ width: 720, height: 1280, totalBitrateBps: 1_400_000,
  faststart: true })` → `True`; `width: 1080` → `False`; `totalBitrateBps:
  1_600_000` → `False`; `faststart: False` → `False`
- `reencode_web_args({src,out})` includes `libx264`, `-crf 26`, `-maxrate 1.5M`,
  `-bufsize 3M`, `-profile:v main`, `yuv420p`, `+faststart`
- `poster_args({src,out})` includes `-ss 0.2`, `-vframes 1`, `scale=640:-2`, `-q:v 8`
- `estimate_cost({ gpu_seconds: 120, cpu_core_seconds: 2400,
  memory_gib_seconds: 4800 })` equals
  `120*0.000164 + 2400*0.0000131 + 4800*0.00000222`
- `estimate_cost(REPRESENTATIVE_METRICS)` is between `0.05` and `0.10`
- `select_rows(rows, only=None)` returns every row; with `only=['lesson_02']`
  returns the matching row; `only=[]` returns `[]`
- `resolve_work_dir({})` → `Path.cwd()`; `resolve_work_dir({'PIPELINE_WORKDIR':
  '/tmp/x'})` → `Path('/tmp/x')`
- `resolve_web_profile({})` → `(1280, '128k')`;
  `resolve_web_profile({'PIPELINE_WEB_TARGET_LONG_EDGE': '720',
  'PIPELINE_WEB_AUDIO_BITRATE': '96k'})` → `(720, '96k')`
- `chrome_flags({})` does not include `--no-sandbox`; `chrome_flags({
  'PIPELINE_CHROME_NO_SANDBOX': '1'})` does, and both include
  `--default-background-color=00000000`
- `missing_required_fonts(tmp_dir)` returns the required font filenames when the
  dir is empty and `[]` when both files exist
- `serialize_status`/`parse_status` round-trip a `done` status; `parse_status`
  returns `None` for malformed JSON or a missing `status` field
- (parity) reading `scripts/lib/video-optimize-utils.js` yields `MAX_VIDEO_WIDTH
  = 720`, `MAX_TOTAL_BITRATE_BPS = 1_500_000`, `X264_CRF = 26`, and each equals
  the `pipeline_lib` constant; reading `scripts/lib/poster-utils.js` yields
  `FRAME_AT_SECONDS = 0.2`, `POSTER_WIDTH = 640`, `POSTER_QUALITY = 8`, and each
  equals the `pipeline_lib` constant
- `package.json` source inspected → contains
  `"test:python": "node scripts/run-python-tests.mjs"` and
  `"pretest": "npm run test:python"`
- `scripts/run-python-tests.mjs` source inspected → tries `python3` then `python`
- `npm run test:python` → all Python tests pass, exit 0
- (source guard) `docs/video-pipeline/pipeline_lib.py` imports only stdlib
  modules

### Task 5 - Pipeline refactor for a configurable workdir and filename scope

Edit `docs/video-pipeline/video_pipeline.py`; add
`docs/video-pipeline/tests/test_pipeline_source.py`. The pure decisions
(`resolve_work_dir`, `resolve_web_profile`, `chrome_flags`,
`missing_required_fonts`, `select_rows`) are implemented and tested in Task 4;
this task wires them in and guards the wiring.

- (source guard) `video_pipeline.py` imports `resolve_work_dir` from
  `pipeline_lib` and derives every directory constant (`RAWVIDEOS_DIRECTORY`,
  `FONT_DIRECTORY`, `BACKGROUNDS_DIRECTORY`, `OVERLAYS_DIRECTORY`,
  `OVERLAYS_TEMP_DIRECTORY`, `NO_SILENCE_DIRECTORY`, `VIDEO_DIRECTORY`,
  `AUDIO_DIRECTORY`, `CSV_FILE`, `SOCIAL_DIR`, `WEB_DIR`) from it
- (source guard) `video_pipeline.py` contains no `os.getcwd()`
- (source guard) `video_pipeline.py` uses `file://` font URLs built from the
  absolute `FONT_DIRECTORY` and calls `missing_required_fonts` before Stage 3
- (source guard) `video_pipeline.py` imports and uses `resolve_web_profile`,
  `chrome_flags`, and `select_rows`
- (source guard) `process_video_batch` accepts an `only` parameter and filters
  CSV rows with `select_rows`; `run_silence_removal` and
  `run_background_removal` accept `only` and restrict their file lists
- (source guard) `parse_args` registers `--only`
- (source guard) the local GPU call path is guarded by `modal.is_local()` so
  `with app.run()` wraps `.remote()` only locally
- (source guard) `video_pipeline.py` contains none of `os.startfile`,
  `shell=True` or `.exe`
- (source guard) the GPU function (`def process_video_background_modal`) and its
  `gpu="T4"` remain, and the app is `modal.App("uff-lesson-video")` (the old
  `video-background-removal` name is gone)

### Task 6 - Recorder page uploads, triggers and shows status

Edit `public/recorder.html`; extend `src/modules/video/recorder-page.test.js`.
The page stays self-contained (no `<script src>`/`<link href>`), unlisted and
noindex.

- generateFinalVideoBuffer stores the Blob (e.g. `global_last_final_blob`) in
  addition to the object URL
- Accept sends the take to `POST /api/pipeline/upload-raw` with headers
  `x-operator-key` (from `#dom-operator-key`) and `x-filename` (the bare CSV
  filename), then advances only on success; on failure it logs and keeps the
  take available
- a separate control still downloads the last take via the existing
  `<a download>` path
- a "Start render" control POSTs `{ files: <all non-empty CSV filenames> }` to
  `/api/pipeline/render` and polls `GET /api/pipeline/status?id=<jobId>` until
  the status is `done` or `error`, writing progress to a status element
- the operator key is read from the input / `sessionStorage`; it is not
  hardcoded
- (source guard) the page contains `'/api/pipeline/upload-raw'`,
  `'/api/pipeline/render'`, `'/api/pipeline/status'`, `'x-operator-key'`,
  `id="dom-operator-key"`, and `global_last_final_blob`
- (source guard, raw source) the page matches no
  `/(operator[_-]?key)\s*[:=]\s*['"][^'"]+['"]/i` (no literal secret)
- (source guard) the page still has no `<script … src=`/`<link … href=`, still
  declares the noindex meta, and is still unreferenced from `src/**`/`index.html`

### Task 7 - Modal app: image, R2, orchestrator, publish, endpoints, cost logging

New `docs/video-pipeline/modal_app.py`, `docs/video-pipeline/storage.py`;
add `docs/video-pipeline/tests/test_modal_app_source.py`.

- (source guard) `modal_app.py` defines `cpu_image` with apt `ffmpeg` and
  `chromium`, `add_local_dir("docs/video-pipeline"`, `PYTHONPATH`,
  `PIPELINE_WORKDIR`, `PIPELINE_CHROME_NO_SANDBOX`, and imports `app` and
  `process_video_background_modal` from `video_pipeline`
- (source guard) the orchestrator is `image=cpu_image`, has `cpu=8`,
  `memory=16384`, `timeout=7200`, `secrets=[...]`, and its body references
  `run_silence_removal`, `run_background_removal`, `process_video_batch`,
  `concatenate_all_processed_videos`, `concatenate_joined_videos`,
  `plan_publish`, and `serialize_status`
- (source guard) the trigger endpoint uses
  `@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)` and calls
  `orchestrator.spawn(`
- (source guard) `storage.py` builds the endpoint from `R2_ACCOUNT_ID` and
  `r2.cloudflarestorage.com`, reads `R2_BUCKET` (default `uff`), and exposes
  `upload_json`/`read_json`/`download_to`/`upload_file`
- (source guard) `modal_app.py` and `storage.py` contain no literal R2 access key
  or secret
- (source guard) the orchestrator writes a status object after each stage
  (`serialize_status` calls for at least `running`, `done` and `error`)
- (manual) process one representative clip end-to-end on Modal with `modal run`
  or a deployed trigger, capture the Modal-reported billed GPU seconds, CPU-core
  seconds and memory GiB-seconds, compute it with `estimate_cost`, and record the
  measured dollars and the clip used in this story's Notes

### Task 8 - Operator asset and CSV uploader

New `scripts/lib/pipeline-assets-utils.js`,
`scripts/lib/pipeline-assets-utils.test.js`, `scripts/upload-pipeline-assets.mjs`,
`scripts/upload-pipeline-assets.test.js`; add npm scripts.

- `collectAssetTargets(dir)` over a temp tree with `fonts/Kalam-Bold.ttf`,
  `backgrounds/bg.mp4`, `audio/track.mp3`, `overlays/lower.png`,
  `video_data.csv`, and a nested `.DS_Store`
  - → one entry per known asset file, dotfiles skipped, sorted, each `r2Key`
    under `pipeline-assets/`
- `contentTypeForAsset` maps `.ttf`, `.mp4`, `.mp3`, `.png`, `.csv` and falls
  back to `application/octet-stream`
- `pipelineAssetKey` normalizes Windows separators to `/`
- `node scripts/upload-pipeline-assets.mjs --assets-dir=<tmp> --dry-run`
  - → prints `DRY pipeline-assets/…` and spawns no `npx`
- `--upload` with a PATH `npx` shim that records argv
  - → the shim records `r2 object put uff/pipeline-assets/fonts/Kalam-Bold.ttf …`
    with the mapped `--content-type`
- `package.json` source inspected
  - → contains `"pipeline:upload-assets"` and `"pipeline:upload-assets:dry"`
- `npm run test:python` and `npm test -- --run` pass

### Task 9 - Docs, product entry, learnings, and measured cost

- `docs/video-pipeline/README.md` source inspected
  - → has a "Cloud pipeline" section naming Modal, the `raw/` and
    `pipeline-assets/` prefixes, the `uff-r2` secret, `modal deploy
    docs/video-pipeline/modal_app.py`, `npm run pipeline:upload-assets`, and the
    recorder's operator key
- `docs/product.md` Features list
  - → contains a link to `stories/040-modal-lesson-video-pipeline/story.md` in
    the existing entry format
- `.env.example` source inspected
  - → lists `OPERATOR_KEY`, `MODAL_RENDER_URL`, `MODAL_PROXY_TOKEN_ID`,
    `MODAL_PROXY_TOKEN_SECRET` as commented examples
- `docs/learnings.md` source inspected
  - → contains a "Modal" or "pipeline" entry describing the operator-key auth
    model, the R2 prefix/TTL constraint, and the Chrome `--no-sandbox`/workdir
    requirements
- Notes section of this story
  - → contains the measured Modal cost from Task 7 and the representative clip

## Bootstrap

```bash
# --- Node (Cloudflare layer) ---
npm ci
npm test -- --run            # runs Python tests first (pretest), then vitest
npm run test:python          # Python pure/guard tests only (stdlib, no pip)

# --- Python runner (Modal) ---
python3 -m pip install --upgrade modal==1.6.1 boto3==1.43.108 \
  moviepy==2.2.1 html2image==2.0.7 pandas==3.0.6 opencv-python-headless==5.0.0.93 \
  pydub==0.25.1 numpy==2.5.3 pillow==12.3.0 torch==2.14.1 torchvision==0.29.1 \
  transformers==5.18.0 einops==0.8.2 kornia==0.8.3 timm==1.0.30
# ffmpeg + ffprobe must be on PATH (already required by the poster/optimize tooling);
# Chromium is only needed to run Stage 3 outside the Modal image, which is not required locally.

# --- Modal ---
modal token new
modal secret create uff-r2 \
  R2_ACCOUNT_ID=<cf_account_id> \
  R2_ACCESS_KEY_ID=<r2_access_key_id> \
  R2_SECRET_ACCESS_KEY=<r2_secret_access_key> \
  R2_BUCKET=uff
modal deploy docs/video-pipeline/modal_app.py

# --- Cloudflare Pages env (dashboard > Settings > Environment variables) ---
# OPERATOR_KEY=<long random>
# MODAL_RENDER_URL=https://<workspace>--trigger.modal.run
# MODAL_PROXY_TOKEN_ID=<proxy token id>
# MODAL_PROXY_TOKEN_SECRET=<proxy token secret>

# --- Operator: push assets + CSV to R2, then render ---
npm run pipeline:upload-assets:dry     # preview
npm run pipeline:upload-assets         # upload with Cloudflare creds
```

## Technical Context

- **No new npm dependencies.** The JS work uses existing `wrangler` `^3.114.17`
  (via `scripts/lib/cli-utils.js`), Vitest `^4.1.6` (jsdom `^29.1.1`) and Node
  built-ins. `crypto.randomUUID()` is available in the Workers runtime.
- **New Python pins (latest on PyPI, checked 2026-10-05):** `modal==1.6.1`,
  `boto3==1.43.108`, `moviepy==2.2.1`, `html2image==2.0.7`, `pandas==3.0.6`,
  `opencv-python-headless==5.0.0.93`, `pydub==0.25.1`, `numpy==2.5.3`,
  `pillow==12.3.0`, `torch==2.14.1`, `torchvision==0.29.1`, `transformers==5.18.0`,
  `einops==0.8.2`, `kornia==0.8.3`, `timm==1.0.30`. The existing pipeline pins
  nothing (README: `moviepy>=2,<3`); pinning makes the image reproducible. The
  CPU orchestrator only needs moviepy/html2image/pandas/opencv/pydub/boto3/numpy/
  pillow; torch/transformers/torchvision/einops/kornia/timm are only needed by
  the existing T4 function's image. `opencv-python-headless` is used in the
  orchestrator image to avoid `libGL`; the T4 image is unchanged.
- **Python tests use stdlib `unittest`** (no pytest dependency). `pretest` runs
  `scripts/run-python-tests.mjs`, which spawns `python3`/`python` and runs
  `docs/video-pipeline/tests/run_all.py`; `npm test -- --run` therefore covers
  both suites. CI (`deploy.yml`, `playwright.yml`) runs `npm test -- --run` on
  `ubuntu-latest`, which ships `python3`. `deploy.yml` already installs `ffmpeg`.
- **Modal:** `@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)`
  protects the endpoint; the Pages Function authenticates with `Modal-Key` /
  `Modal-Secret` proxy-token headers. `orchestrator.spawn(spec)` returns
  immediately; status is carried by the R2 marker because the Functions are
  stateless. `modal.Image.add_local_dir("docs/video-pipeline", …)` requires the
  deploy command to run from the repo root. `modal.is_local()` distinguishes the
  Windows CLI path (needs `with app.run()`) from inside-container execution.
  Modal discovers the Functions defined in a module only when that module is in
  the entrypoint's import graph (`Project structure` guide, "one module
  transitively imports all of the other modules"), which is why `modal_app.py`
  must keep `from video_pipeline import app, process_video_background_modal` and
  be the deploy target; removing that import would silently deploy an app
  without the T4 Function. Deploying therefore imports the full pipeline, so the
  operator machine needs the Bootstrap Python deps installed.
- **R2:** S3-compatible endpoint
  `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`, bucket `uff`, via boto3.
  `functions/api/upload-segment.js` remains the pattern for the Function shape
  (`UFF_R2`, `httpMetadata`, `MAX_R2_UPLOAD_BYTES`).
- **Prefixes:** `raw/<slug>.mp4`, `raw/status/<jobId>.json`,
  `pipeline-assets/<subdir>/<file>` (plus `pipeline-assets/video_data.csv`),
  published `assets/videos/<slug>.mp4` and `assets/videos/<slug>.jpg`. None of
  `raw/`/`pipeline-assets/` is under the 48h `videos/` lifecycle.
- **Chrome:** `html2image==2.0.7` locates Linux `chromium`; running as root
  requires `--no-sandbox`, which overrides its default flags — the code already
  passes `--default-background-color=00000000` explicitly, and the story adds
  `--no-sandbox` only in the container.
- **Web-budget parity:** `scripts/lib/video-optimize-utils.js`
  (`MAX_VIDEO_WIDTH = 720`, `MAX_TOTAL_BITRATE_BPS = 1_500_000`, `X264_CRF = 26`)
  and `scripts/lib/poster-utils.js` (`FRAME_AT_SECONDS = 0.2`,
  `POSTER_WIDTH = 640`, `POSTER_QUALITY = 8`) are the JS sources of truth; the
  Python constants mirror them and a test fails if they drift.

## Notes

- **Measured cost (Task 7, pending — operator out-of-band step):** _not
  measured in this environment._ The build sandbox has no Modal/R2 credentials
  and cannot deploy or run anything on Modal, so Task 7's manual AC (process one
  representative clip on Modal, capture billed GPU/CPU/memory seconds, record the
  measured dollars) is an operator step performed after `modal deploy`, not a
  CI-gateable check. The plumbing is in place: `run_background_removal` now
  returns the accumulated Stage-2 wall time, and the orchestrator feeds it as the
  `gpu_seconds` term of `estimate_cost` (it was previously a dead `spec.get`
  that always read 0, under-reporting every run). The orchestrator logs
  `wall_seconds`, `gpu_seconds` and `estimated_cost_usd` into the `done` status
  marker. The estimate for a representative take is ≈ $0.06 (inside the
  $0.05–$0.10 band). Replace this note with the measured numbers once an operator
  runs a real clip. No measured value was fabricated.
- **Raw-take visibility (accepted, not private).** `raw/<slug>.mp4` is written to
  the public `uff` bucket under a deterministic, guessable key with no TTL, and
  the operator key gates only the write. Any take that has not yet been published
  is therefore world-readable by anyone who knows the slug. This is a deliberate
  acceptance for now (the operator key + unlisted page is the agreed auth level);
  `upload-raw.js` no longer returns the public URL, and the README documents the
  exposure. Moving `raw/` to a private prefix/bucket or adding an R2 lifecycle
  rule is the follow-up if takes must stay private.
- **Operator key handling.** The key is typed on the phone and kept in
  `sessionStorage`; it is sent only to the same-origin Pages Functions and is
  never in the static HTML. It is a stopgap: an unlisted/noindex page plus a
  shared secret is not strong auth. Cloudflare Access (or a signed token) is the
  documented next step.
- **Why fetch assets from R2 instead of baking them.** Backgrounds/audio/overlays/
  fonts and `video_data.csv` change independently of the code, so the operator
  uploads them once with `npm run pipeline:upload-assets` and re-renders; no
  `modal deploy` is needed for a content change. Required font files are asserted
  present before Stage 3 so a missing font cannot silently degrade overlays.
- **R2 lifecycle.** `raw/` and `pipeline-assets/` deliberately avoid the `videos/`
  48h TTL. Raw takes and old status markers accumulate until the operator adds a
  lifecycle rule (out of scope, documented in the README).
- **First cloud run requires a one-time asset upload** (`pipeline:upload-assets`)
  and a one-time `modal secret create uff-r2`; neither is automated here.
- **The local Windows flow is untouched** — `python video_pipeline.py` with no
  `PIPELINE_WORKDIR`/`--only` behaves exactly as before. The recorder keeps a
  "save to device" fallback so a failed upload never loses a take.
- **Double web encode.** The pipeline still writes its own `output/web` twin; the
  publish step may additionally transcode when it misses the 032 budget. Setting
  `PIPELINE_WEB_TARGET_LONG_EDGE=720` usually avoids the second pass; removing the
  pipeline's redundant web twin in cloud mode is a deferred optimisation.
- **Status is stage-level** (`fetch`/`stage1`/`stage2`/`stage3`/`publish`), not
  frame-level; the recorder polls every 5s and stops on `done`/`error`.
