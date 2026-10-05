# Move raw takes and pipeline assets to a private R2 bucket

## Context

Story 040 built the cloud lesson-video pipeline and, in its "Raw-take visibility"
note, accepted a deliberate exposure: raw phone takes (`raw/<slug>.mp4`) and the
stage-level status marker (`raw/status/<jobId>.json`) are written to the public
`uff` bucket, which is served at `https://r2.ultrafastfluency.com`. The operator
key gates only the *write*; the *read* is public. Any unpublished or rejected
take is therefore world-readable by anyone who knows (or guesses) the slug.

This story closes that exposure for real, as the user chose (option 2 in the
earlier discussion: real privacy, not obscurity). It moves `raw/` takes, the
`raw/status/` marker, and the operator-input `pipeline-assets/` tree into a
separate, non-public R2 bucket, while the app's learner/recap path
(`functions/api/upload-segment.js` → `videos/`, and published
`assets/videos/...`) keeps using the public `uff` bucket unchanged.

Two facts drive the design, both verified against the Cloudflare docs
(2026-10-05):

- **R2 buckets are private by default.** Public access is granted *per bucket*
  by attaching a custom domain or enabling the managed `r2.dev` subdomain
  (`developers.cloudflare.com/r2/buckets/public-buckets`). The existing
  `r2.ultrafastfluency.com` custom domain is attached to the `uff` bucket only,
  so a second bucket with no domain attached is unreachable through the CDN.
- **R2 bindings are bucket-scoped, not prefix-scoped.** A binding grants access
  to a whole bucket; there is no way to bind "the `raw/` prefix" of `uff`. Two
  bindings to the same bucket have identical public/private reachability
  ("Configure R2 bucket bindings via your Wrangler file the same way they are
  configured with Cloudflare Workers",
  `developers.cloudflare.com/pages/functions/wrangler-configuration`).

After this story, fetching a raw take from `r2.ultrafastfluency.com` becomes
impossible — the object is no longer in the bucket that domain serves.

## Out of Scope

- **Cloudflare Access / signed tokens.** The operator-key stopgap is unchanged;
  this story only changes *where* raw objects live, not who may write them.
- **A second set of R2 S3 credentials for the private bucket.** The Modal
  `uff-r2` secret already carries an account-level key pair that can address any
  bucket in the account; this story adds a bucket name (`R2_PRIVATE_BUCKET`) to
  that secret rather than provisioning scoped tokens.
- **Encrypting objects at rest with a customer key.** R2 encrypts at rest by
  default; no CMK work here.
- **Migrating existing `raw/` / `pipeline-assets/` objects** already in `uff`.
  Takes are transient and `pipeline-assets/` is re-uploadable with
  `npm run pipeline:upload-assets`; any leftovers in `uff` are cleaned by the
  operator (documented), not by code.
- **Deleting or renaming the public `uff` bucket, or moving `videos/` /
  `assets/videos/`.** Published/UGC media stays exactly where the app reads it.
- **Applying the R2 lifecycle rule or creating the bucket in CI.** Both need
  Cloudflare credentials that CI does not have; they are operator out-of-band
  steps (documented + source-guarded), mirroring story 040's manual Modal AC.
- **Automating `pipeline-assets/` retention.** Assets persist; only `raw/`
  self-expires.
- **Real-device / live-CDN verification.** A headless test cannot reach the
  production CDN; the "raw is unreachable" AC is an operator check.

## Implementation approach

### Bucket decision (recommended and adopted: Option A)

**A separate, non-public R2 bucket bound to Pages as `PIPELINE_R2`.**

| Option | Real boundary? | Why / why not |
|---|---|---|
| **A — separate private bucket (`PIPELINE_R2`)** | **Yes** | A bucket with no custom domain / no `r2.dev` is not reachable via `r2.ultrafastfluency.com`. The binding is just read/write access for the Function. This is the only option that makes the CDN fetch *impossible*, not merely unadvertised. |
| B — second binding to `uff` | No | R2 bindings are bucket-scoped, not prefix-scoped. Both bindings expose the same objects at the same public URL; `raw/` would still be world-readable. **Rejected.** |
| C — unguessable per-job key in `uff` | No | Obscurity, not privacy: the object is still served publicly to anyone who obtains the URL (logs, referrers, shares). The user explicitly chose real privacy. **Rejected** (noted, not adopted). |

Default bucket name: **`uff-private`** (operator creates it; configurable via
`R2_PRIVATE_BUCKET` for Modal, `PIPELINE_PRIVATE_BUCKET` for the Node uploader,
and the `bucket_name` in the `PIPELINE_R2` binding for Pages).

### What goes where

The bucket follows from the object key, so no caller can write a raw key to the
public bucket by mistake. A new pure decision lives in the shared key modules:

- Private (`raw/`, `raw/status/`, `pipeline-assets/`): raw takes, status markers,
  operator assets.
- Public (everything else, i.e. `assets/videos/<slug>.mp4|.jpg` and all app UGC
  `videos/…`): published lesson media and learner/recap clips.

New in `src/modules/video/pipeline-keys.js` (mirrored in `pipeline_lib.py`):

```js
export const PRIVATE_KEY_PREFIXES = ['raw/', 'pipeline-assets/'];
export function isPrivateKey(key)   // startsWith any PRIVATE_KEY_PREFIXES entry
```

```python
PRIVATE_KEY_PREFIXES = (RAW_PREFIX, PIPELINE_ASSET_PREFIX)  # "raw/", "pipeline-assets/"
def is_private_key(key) -> bool
def bucket_for_key(key) -> str      # "private" when is_private_key else "public"
```

`RAW_PREFIX = "raw/"` already covers `STATUS_PREFIX = "raw/status/"`, so the
prefix list is `("raw/", "pipeline-assets/")`; a parity test pins the JS and
Python lists to the same accept/reject set for representative keys.

### Cloudflare Pages bindings (`wrangler.toml`)

```toml
[[r2_buckets]]
binding = "UFF_R2"
bucket_name = "uff"

[[r2_buckets]]
binding = "PIPELINE_R2"
bucket_name = "uff-private"
# NOTE: R2 lifecycle for raw/ is set via `wrangler r2 bucket lifecycle add`
# (not a wrangler.toml key). Keep the videos/ 48h rule on the `uff` bucket.
```

- `functions/api/pipeline/upload-raw.js` and `functions/api/pipeline/status.js`
  switch from `env.UFF_R2` to `env.PIPELINE_R2`.
- `functions/api/upload-segment.js` keeps `env.UFF_R2` (public `videos/`),
  unchanged.
- Both endpoints still authenticate with `requireOperatorKey` and never return a
  public raw URL.

### Modal / Python storage (`storage.py`, `modal_app.py`)

`storage.py` gets two bucket accessors and routes every operation by
`pipeline_lib.bucket_for_key(key)`:

```python
def public_bucket_name(environ=None)  -> env R2_BUCKET         or "uff"
def private_bucket_name(environ=None) -> env R2_PRIVATE_BUCKET or public_bucket_name(environ)
```

- `private_bucket_name()` falls back to the public bucket only when
  `R2_PRIVATE_BUCKET` is unset, preserving a single-bucket local/Windows run.
  The Modal secret always sets it, so the fallback never applies in the cloud.
- `download_to`, `upload_file`, `upload_json`, `list_keys`, `read_json` compute
  the bucket from their key. `download_to`/`list_keys`/`upload_json` for
  `raw/`, `raw/status/`, `pipeline-assets/` therefore hit the private bucket;
  `upload_file` for `assets/videos/…` hits the public bucket.
- `modal_app.py` needs no call-site changes: `_fetch_takes`, `_fetch_assets`,
  `_write_status` and `_publish` pass keys only.

Modal secret shape (operator):

```bash
modal secret create uff-r2 \
  R2_ACCOUNT_ID=<cf_account_id> \
  R2_ACCESS_KEY_ID=<r2_access_key_id> \
  R2_SECRET_ACCESS_KEY=<r2_secret_access_key> \
  R2_BUCKET=uff \
  R2_PRIVATE_BUCKET=uff-private
```

### Operator asset uploader (`scripts/upload-pipeline-assets.mjs`)

- Bucket name becomes configurable: `PIPELINE_PRIVATE_BUCKET` (default
  `uff-private`) replaces the hardcoded `uff` prefix in the
  `wrangler r2 object put <bucket>/<key>` call.
- `uploadObjectToR2` in `scripts/lib/cli-utils.js` already takes an `r2Key`
  containing `<bucket>/<key>`; only the caller changes.

### Lifecycle (operator out-of-band)

Add a rule on the **private** bucket so raw takes and their markers self-expire;
leave the public bucket's `videos/` 48h rule untouched:

```bash
npx wrangler r2 bucket lifecycle add uff-private raw-takes-7d \
  --prefix "raw/" --expire-days 7
```

`raw/` covers `raw/<slug>.mp4` and `raw/status/<jobId>.json`. `pipeline-assets/`
gets no rule (assets persist until re-uploaded). This is documented in the
README and pinned by a docs source guard; applying it is an operator step.

### Tests / guards

- **JS Functions**: update `upload-raw.test.js` / `status.test.js` to stub
  `env.PIPELINE_R2` and assert the public `UFF_R2` is *not* touched; add a guard
  that `upload-segment.js` still uses `UFF_R2`.
- **Key modules**: extend `pipeline-keys.test.js` and
  `test_pipeline_lib.py` for `isPrivateKey` / `is_private_key` /
  `bucket_for_key`; extend `test_pipeline_parity.py` to assert the JS and Python
  private-prefix lists classify the same keys.
- **Storage**: source guards in `test_modal_app_source.py` assert
  `private_bucket_name` reads `R2_PRIVATE_BUCKET`, that operations route by
  `bucket_for_key`, and that no access key/secret is hardcoded.
- **No raw URL in the client**: a source guard scans `src/**`, `index.html` and
  `public/recorder.html` for a `raw/` CDN URL
  (`r2.ultrafastfluency.com/raw`) and `rawTakeKey`/`statusKey` usage; the recorder
  only uploads and polls by same-origin path. `video-url.js` is asserted to build
  only `assets/videos/` and `videos/` URLs (no `raw/`).
- All source guards must be provably able to fail (inject the forbidden token
  locally and watch the test go red), per `AGENTS.md`.

## Tasks

### Task 1 - Shared private-key rule (JS + Python parity)

Add `PRIVATE_KEY_PREFIXES` / `isPrivateKey` to
`src/modules/video/pipeline-keys.js`; add `PRIVATE_KEY_PREFIXES` /
`is_private_key` / `bucket_for_key` to `docs/video-pipeline/pipeline_lib.py`.
Extend `src/modules/video/pipeline-keys.test.js`,
`docs/video-pipeline/tests/test_pipeline_lib.py` and
`docs/video-pipeline/tests/test_pipeline_parity.py`.

- `isPrivateKey('raw/lesson_01.mp4')` and `isPrivateKey('raw/status/job-abc12345.json')`
  - → `true`
- `isPrivateKey('pipeline-assets/fonts/Kalam-Bold.ttf')`
  - → `true`
- `isPrivateKey('assets/videos/lesson_01.mp4')` and `isPrivateKey('videos/ab-model-w-response-01.mp4')`
  - → `false`
- `isPrivateKey('')` and `isPrivateKey(null)` / `isPrivateKey(undefined)`
  - → `false`
- `PRIVATE_KEY_PREFIXES` JS array inspected
  - → equals `['raw/', 'pipeline-assets/']`, contains no `videos/` or `assets/` entry
- `is_private_key('raw/x.mp4')`, `is_private_key('raw/status/j.json')`,
  `is_private_key('pipeline-assets/audio/a.mp3')`
  - → `True`
- `is_private_key('assets/videos/x.mp4')`, `is_private_key('videos/x.mp4')`,
  `is_private_key('')`, `is_private_key(None)`
  - → `False`
- `bucket_for_key('raw/x.mp4')` → `'private'`; `bucket_for_key('assets/videos/x.mp4')` → `'public'`;
  `bucket_for_key('pipeline-assets/a.csv')` → `'private'`
- `PRIVATE_KEY_PREFIXES` Python tuple
  - → equals `(RAW_PREFIX, PIPELINE_ASSET_PREFIX)` and `RAW_PREFIX in PRIVATE_KEY_PREFIXES`
- (parity) for keys `raw/x.mp4`, `raw/status/j.json`, `pipeline-assets/a.csv`,
  `assets/videos/x.mp4`, `videos/x.mp4`, `''`
  - → `is_private_key(key)` equals the JS `isPrivateKey(key)` result
- (parity) the JS `PRIVATE_KEY_PREFIXES` literal read from `pipeline-keys.js`
  - → equals the Python `PRIVATE_KEY_PREFIXES` value

### Task 2 - Raw/status Pages Functions use the private binding

Edit `functions/api/pipeline/upload-raw.js`, `functions/api/pipeline/status.js`;
update `functions/api/pipeline/upload-raw.test.js` and
`functions/api/pipeline/status.test.js`.

- `upload-raw` valid request (`x-filename: lesson_01`)
  - → `env.PIPELINE_R2.put` called with `raw/lesson_01.mp4`, the body bytes, and
    `{ httpMetadata: { contentType: 'video/mp4', cacheControl: 'no-store' } }`
  - → `env.UFF_R2.put` not called
  - → 200 body is `{ ok: true, key: 'raw/lesson_01.mp4' }` (no public URL)
- `upload-raw` auth/size/bad-filename failures
  - → unchanged 401/400/413/500 statuses, and neither `PIPELINE_R2.put` nor
    `UFF_R2.put` is called
- `upload-raw` when `env.PIPELINE_R2` is missing but `UFF_R2` is present
  - → request fails (does not write to the public bucket); assert `UFF_R2.put`
    not called
- `status` GET with a valid id where `env.PIPELINE_R2.get` returns a marker
  - → 200 parsed JSON; `env.PIPELINE_R2.get` called with `raw/status/<id>.json`;
    `env.UFF_R2.get` not called
- `status` GET auth/id/missing/malformed failures
  - → unchanged 401/400/404/502, neither binding read on 401/400
- (source guard, raw source) `upload-raw.js` and `status.js` each contain
  `env.PIPELINE_R2` and match no `env.UFF_R2`
- (source guard) `upload-raw.js` still imports `rawTakeKey`, `status.js` still
  imports `statusKey`, and neither contains a literal `'raw/'`
- (guard-can-fail) injecting `env.UFF_R2` into `status.js` and re-running makes
  the `no env.UFF_R2` guard fail

### Task 3 - Public segment upload path is unchanged

Extend `functions/api/upload-segment.test.js` only (no Function change).

- valid segment upload
  - → `env.UFF_R2.put` called as today
- (source guard) `functions/api/upload-segment.js` references `env.UFF_R2` and
  contains no `PIPELINE_R2`
- (source guard) `functions/api/upload-segment.js` still returns the public
  `https://r2.ultrafastfluency.com/${key}` URL for `videos/` keys

### Task 4 - Modal/Python storage addresses two buckets

Edit `docs/video-pipeline/storage.py`; add guards to
`docs/video-pipeline/tests/test_modal_app_source.py`. `modal_app.py` call sites
are unchanged (keys drive the bucket).

- (source guard) `storage.py` defines `public_bucket_name` reading `R2_BUCKET`
  (default `uff`) and `private_bucket_name` reading `R2_PRIVATE_BUCKET`
  (falling back to `public_bucket_name` when unset)
- (source guard) `storage.py` imports `bucket_for_key` from `pipeline_lib` and
  every helper (`download_to`, `upload_file`, `upload_json`, `list_keys`,
  `read_json`) selects the bucket via `bucket_for_key(<key>)`
- (source guard) `storage.py` contains no hardcoded `R2_ACCESS_KEY_ID =` /
  `R2_SECRET_ACCESS_KEY =` and no literal AWS key
- (source guard) `modal_app.py` passes only keys to `storage.*` (it never names a
  bucket), so the single source of truth for bucket selection is `storage.py`
- (async/unit, no boto3) `bucket_for_key` routing is covered by Task 1; this task
  is source-guarded because `storage.py` imports boto3 and cannot run in CI

### Task 5 - Operator asset uploader targets the private bucket

Edit `scripts/upload-pipeline-assets.mjs` and its test
`scripts/upload-pipeline-assets.test.js`; update `scripts/lib/cli-utils.js`
only if needed for the explicit bucket.

- `node scripts/upload-pipeline-assets.mjs --assets-dir=<tmp> --upload` with an
  `npx` shim
  - → the shim records `r2 object put uff-private/pipeline-assets/fonts/Kalam-Bold.ttf …`
    (private bucket prefix), not `uff/…`
- `PIPELINE_PRIVATE_BUCKET=custom-bucket` in env + `--upload`
  - → the recorded argv uses `custom-bucket/pipeline-assets/…`
- `--dry-run`
  - → prints `DRY pipeline-assets/…`, still spawns no `npx`
- (source guard) `scripts/upload-pipeline-assets.mjs` does not contain a literal
  `uff/` bucket prefix and reads `PIPELINE_PRIVATE_BUCKET`

### Task 6 - Bindings and lifecycle documentation in config

Edit `wrangler.toml`; add a source guard (extend
`docs/video-pipeline/tests/test_docs.py` or add a config guard test).

- `wrangler.toml` source inspected
  - → contains a second `[[r2_buckets]]` block with `binding = "PIPELINE_R2"` and
    `bucket_name = "uff-private"`
  - → still contains `binding = "UFF_R2"` / `bucket_name = "uff"`
  - → the comment documents that the private bucket has no public custom domain
    and must not be attached to `r2.ultrafastfluency.com`
- `wrangler.toml` + README source inspected
  - → contain the lifecycle command
    `wrangler r2 bucket lifecycle add uff-private raw-takes-7d --prefix "raw/" --expire-days 7`
  - → the `videos/` 48h rule is stated to stay on the public `uff` bucket

### Task 7 - Client never constructs a raw URL

Add a source guard (extend `src/modules/video/recorder-page.test.js` or a new
`src/modules/video/raw-privacy.test.js`).

- scan of `src/**`, `index.html`, `public/recorder.html` (excluding tests) for
  `r2.ultrafastfluency.com/raw`
  - → no hits
- `public/recorder.html` source inspected
  - → contains `'/api/pipeline/upload-raw'` and `'/api/pipeline/status'` and does
    not contain `r2.ultrafastfluency.com`
- `src/modules/video/video-url.js` source inspected
  - → its two URL bases are `assets/videos/` and `videos/` only; no `raw/`
- (guard-can-fail) a temporary fixture containing
  `https://r2.ultrafastfluency.com/raw/x.mp4` is detected by the scan helper

### Task 8 - Docs, product entry, learnings, and env example

Edit `docs/video-pipeline/README.md`, `docs/product.md`, `docs/learnings.md`,
`.env.example`; update `docs/video-pipeline/tests/test_docs.py`.

- `docs/video-pipeline/README.md` source inspected
  - → the "Raw-take visibility" section states raw takes + status markers +
    pipeline assets live in the private `uff-private` bucket bound as
    `PIPELINE_R2`, that `r2.ultrafastfluency.com` cannot serve them, and that
    published media stays in `uff`
  - → documents `PIPELINE_PRIVATE_BUCKET`, the `R2_PRIVATE_BUCKET` secret field,
    and the raw lifecycle command
- `docs/product.md` Features list
  - → the cloud-pipeline entry (or a new entry) references
    `stories/041-private-raw-takes/story.md` in the existing format
- `.env.example` source inspected
  - → lists `PIPELINE_PRIVATE_BUCKET` (default `uff-private`) as a commented
    example alongside the existing pipeline block
- `docs/learnings.md` source inspected
  - → contains an entry stating R2 bindings are bucket-scoped (a prefix-scoped
    binding is not a boundary), that the private bucket has no public domain, and
    that `raw/` self-expires while `videos/` keeps its 48h rule
- `docs/video-pipeline/tests/test_docs.py` source inspected
  - → guards the new README tokens (`PIPELINE_R2`, `uff-private`,
    `R2_PRIVATE_BUCKET`) and the learnings token for bucket-scoped bindings
- (manual, operator out-of-band — NOT CI-gateable) create the private bucket,
  apply the `raw/` lifecycle rule, add `R2_PRIVATE_BUCKET` to the `uff-r2`
  secret, redeploy `modal deploy docs/video-pipeline/modal_app.py`, redeploy
  Pages, then confirm `curl -sI https://r2.ultrafastfluency.com/raw/<known-slug>.mp4`
  returns 404 while `https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4`
  still returns 200. This needs Cloudflare credentials and a live deploy, so it
  cannot run in CI; do not fabricate a result.

## Bootstrap

```bash
# --- Node (Cloudflare layer) ---
npm ci
npm test -- --run            # runs Python guards first (pretest), then vitest
npm run test:python          # Python pure/guard tests only (stdlib, no pip)

# --- Operator (out-of-band; needs Cloudflare creds; not run in CI) ---
# 1. Create the private bucket (no custom domain, no r2.dev).
npx wrangler r2 bucket create uff-private

# 2. Expire raw takes/markers after 7 days (leaves pipeline-assets/ intact;
#    the videos/ 48h rule stays on the public `uff` bucket).
npx wrangler r2 bucket lifecycle add uff-private raw-takes-7d \
  --prefix "raw/" --expire-days 7

# 3. Add the private bucket name to the existing Modal secret (recreate it).
modal secret create uff-r2 \
  R2_ACCOUNT_ID=<cf_account_id> \
  R2_ACCESS_KEY_ID=<r2_access_key_id> \
  R2_SECRET_ACCESS_KEY=<r2_secret_access_key> \
  R2_BUCKET=uff \
  R2_PRIVATE_BUCKET=uff-private

# 4. Upload operator assets to the private bucket.
npm run pipeline:upload-assets:dry     # preview
npm run pipeline:upload-assets         # uses PIPELINE_PRIVATE_BUCKET (default uff-private)

# 5. Redeploy the Modal app and the Pages project.
modal deploy docs/video-pipeline/modal_app.py
npm run deploy

# --- Cloudflare Pages env (dashboard > Settings > Environment variables) ---
# No new secret: PIPELINE_R2 is an R2 binding (wrangler.toml), not a var.
# PIPELINE_PRIVATE_BUCKET (Node uploader only, optional): uff-private
```

## Technical Context

- **No new npm dependencies.** The JS work uses existing `wrangler ^3.114.17`,
  Vitest `^4.1.6` and Node built-ins. `PIPELINE_R2` is a second
  `[[r2_buckets]]` entry; Pages supports multiple R2 bindings
  (`developers.cloudflare.com/pages/functions/wrangler-configuration`).
- **No new Python dependencies.** `storage.py` keeps using `boto3==1.43.108`
  already pinned in the Modal `cpu_image` (story 040); `pipeline_lib.py` stays
  stdlib-only. The Python suite stays stdlib `unittest`.
- **R2 privacy model.** Buckets are private by default; public access is
  per-bucket via a custom domain or `r2.dev`
  (`developers.cloudflare.com/r2/buckets/public-buckets`). It is verified against
  the docs, not assumed, that the existing custom domain serves only `uff`.
- **Bucket-scoped bindings.** A binding is not a prefix ACL; this is the reason
  Option B cannot isolate `raw/`. Object-key routing in `pipeline_lib` /
  `storage.py` is the enforcement point, not the binding name.
- **Prefixes.** Private: `raw/<slug>.mp4`, `raw/status/<jobId>.json`,
  `pipeline-assets/<subdir>/<file>` (+ `pipeline-assets/video_data.csv`). Public:
  `assets/videos/<slug>.mp4|.jpg` and `videos/<ugc>`. `PRIVATE_KEY_PREFIXES`
  is `("raw/", "pipeline-assets/")`; `raw/` also covers the status prefix.
- **Single-bucket local run.** `private_bucket_name()` falls back to
  `public_bucket_name()` when `R2_PRIVATE_BUCKET` is unset, so a local run with
  one bucket name still works; the Modal secret always sets the private name in
  the cloud, so the fallback never applies there. The local Windows flow
  (`python video_pipeline.py`, no R2 env, local `rawvideos/`) does not use
  `storage.py` at all and is unchanged.
- **Lifecycle CLI.** `npx wrangler r2 bucket lifecycle add <BUCKET> <NAME>
  [--prefix <PREFIX>] --expire-days <N>`
  (`developers.cloudflare.com/r2/reference/wrangler-commands`). The lifecycle key
  is not valid in `wrangler.toml` for Pages, so it stays an operator command, as
  with the existing `videos/` rule.
- **Existing guards that must keep passing.** `test_docs.py` currently asserts
  the README "Cloud pipeline" tokens and `stories/040.../story.md` product link;
  `test_modal_app_source.py` asserts `DEFAULT_BUCKET = "uff"` and
  `R2_BUCKET` in `storage.py` — keep those literals and add the new private ones.
  `upload-segment.test.js` must stay green (public path untouched).

## Notes

- **Guard must be able to fail.** Per `AGENTS.md`, every new/edited source guard
  in this story is verified by temporarily injecting the forbidden token (e.g. a
  `env.UFF_R2` in `status.js`, an `r2.ultrafastfluency.com/raw` string in
  `video-url.js`) and confirming the test goes red before removing it. A guard
  that cannot fail is not acceptable; do not strip comments before URL
  assertions, scope whole-file `toContain` to the specific block, and never slice
  a function body to EOF.
- **What becomes impossible after this story.** `https://r2.ultrafastfluency.com/raw/<slug>.mp4`
  and `.../raw/status/<jobId>.json` return 404 because those objects are no longer
  in the bucket that domain serves. There is no public URL for an unpublished
  take. The recorder uploads via `POST /api/pipeline/upload-raw` and polls via
  `GET /api/pipeline/status` — same-origin, operator-key gated — and never fetches
  a raw take by URL. This is the security property the story delivers.
- **Manual/operator ACs (not CI-gateable).** Creating `uff-private`, applying the
  lifecycle rule, recreating the `uff-r2` secret, and the live `curl` 404/200
  check all need Cloudflare/R2 credentials and a real deploy. They are marked as
  operator steps in Task 8 and must not be fabricated as passing. The CI-gateable
  proof is the source/config guards: bindings, storage routing, no client raw
  URL.
- **Residual exposure during migration.** Until the operator creates the bucket
  and redeploys, existing objects under `raw/` and `pipeline-assets/` in `uff`
  remain public. The operator should delete those prefixes from `uff` after the
  redeploy (documented); this is not code.
- **`pipeline-assets/` moves too.** The user asked for raw takes *and* pipeline
  assets out of the public bucket. Assets are operator inputs (backgrounds,
  audio, overlays, fonts, CSV) with no learner PII, but keeping them in the
  private bucket keeps one rule for "not for the public CDN" and eliminates the
  guessable-asset surface. They get no expiry rule (they persist).
- **Operator key handling is unchanged.** The shared `OPERATOR_KEY` and the
  unlisted/noindex recorder remain a stopgap; Cloudflare Access is still the
  documented next step. This story changes storage, not auth.
- **Task 8 live check (pending — operator out-of-band step):** _not run in this
  environment._ The build sandbox has no Cloudflare/R2/Modal credentials and
  cannot deploy, so Task 8's manual AC (create `uff-private`, apply the `raw/`
  lifecycle rule, recreate the `uff-r2` secret, redeploy Modal + Pages, then
  confirm `curl -sI https://r2.ultrafastfluency.com/raw/<slug>.mp4` returns 404
  while `.../assets/videos/<slug>.mp4` still returns 200) is performed by the
  operator after deploy, not a CI-gateable check. The CI-gateable proof is the
  source/config guards (bindings, storage routing by `bucket_for_key`, no client
  raw URL). No live result was fabricated.
