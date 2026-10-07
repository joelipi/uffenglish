# Repository guidance

Standing rules for working in this repository. Detailed incident write-ups live in `docs/learnings.md`.

## Source-guard tests must be able to fail

This repo relies heavily on tests that assert on source text ("guards"). Several separate incidents (see git history and `docs/learnings.md`) produced a guard that could never fail. When writing or editing one:

- **Do not strip comments before scheme/URL assertions.** A `/\/\/.*$/gm` stripper reads the `//` in `https://` as a comment and erases the URL, so the assertion can never fail. Assert on the raw source for scheme checks; use the stripped source only for bare-identifier checks (`window`/`document`).
- **Whole-file `toContain` only works for tokens that appear exactly once.** Over an entire stylesheet/source file it stays green even when the specific rule is deleted. Scope the slice to the specific block (`slice(indexOf(selector), …)`) and assert every property in it.
- **Never slice a function body to EOF.** End the slice at the next top-level marker (`indexOf('export const …')` / the next `export async function …`). A function appended later otherwise silently joins the slice and the guard passes on strings that are not in the target function.
- **Presence is not containment.** Asserting that `try:`, the guarded call and `except Exception` all appear *somewhere* in a region says nothing about their order, so hoisting the call out of the `try` still passes. Assert index order (`region.index(a) < region.index(b) < region.index(c)`) — and search the paren-qualified call token (`storage.head(`), because an explanatory comment naming the function will otherwise satisfy a bare-token search.

Before trusting a guard, prove it can fail by temporarily injecting the thing it forbids.

## A new `src/**` test file must not mention the recorder page

`src/modules/video/recorder-page.test.js` scans every file under `src/**` for a reference to the operator-only recorder page (`/recorder` / `recorder.html`) and fails on any hit. A new guard test that lives in `src/**` and mentions that page — even in a path constant or a comment — breaks that hidden-page guard. Avoid the literal token in `src/**` (build paths from parts, e.g. `'recorder' + '.html'`), or add the file to the scanner's exclude set.

## New public top-level routes must be registered in `PUBLIC_ROUTES`

`useGuestModalGuard` opens the guest language/login modal for anonymous visitors on every non-auth route unless `isPublicHomeRoute(path)` is true (`src/modules/user/guest-modal-logic.js`). Any page that must be readable without that modal (e.g. `/privacy`, `/terms`) has to be added to `PUBLIC_ROUTES`; the lookup normalizes trailing slashes and case to mirror React Router's matching (`/Privacy`, `/privacy/` resolve to the page). Declare static routes before the single-segment `/:shareCode` catch-all, and cover the non-canonical forms in `guest-modal-logic.test.js`.

## Pipeline grouping must match the config's step granularity

`docs/video-pipeline/video_pipeline.py` groups processed clips by the CSV `filename` prefix (`group_prefix_for_filename`, the leading non-digit run), which collapses a whole lesson on the overlay master (`wouldyourather_b01_i01` → `wouldyourather_b`) while the app config's step is the `video_file` column. The rendered video, the join and the SRT must all key by `pipeline_lib.group_key_for_filename` (non-blank `video_file`, else the legacy filename prefix), and `scripts/write-srt-to-sheet.mjs` mirrors that rule. When adding a stage that groups clips, route it through the shared key and assert it (a stage that re-derives its own prefix silently disagrees with the config). Compare step keys by **equality**, never `startswith`: sibling keys share a prefix (`wouldyourather_b01_i` is a prefix of `wouldyourather_b01_ii01`), so a substring match selects the wrong row (e.g. the wrong `bgMusic`). The publish plan (`pipeline_lib.plan_publish`) must name the **concatenated** file the render actually wrote — `<join>.mp4`, else `<video_file>_full<VIDEO_EXTENSION>` — never the per-take `processed_*` intermediates (publishing those 404s every slug the app config references); the published R2 key still drops the internal suffix (`assets/videos/<slug>.mp4`).

**The public CDN caches `assets/videos/*` for 4 hours.** A GET of a published object returns `cf-cache-status: HIT` with `cache-control: max-age=14400`, so re-rendering a step under the same slug serves the previous video until the cache expires or the URL is purged; a `HEAD` bypasses the edge cache and shows the true origin state (useful when a `GET` says 200 for an object the R2 API already reports deleted). New slugs — the normal case — are unaffected.

## The overlay master and the authoring sheet are two shapes for one generator

`scripts/lib/sheet-config-utils.js` / `scripts/generate-config-from-sheet.mjs` read two sheet shapes, chosen by header: the **overlay master** (has a `phrase` column) and the **authoring sheet** (has `cue`/`cue_alt`). On the master a step is the `video_file` (or its `join` value, which is the published slug), the app `cue` is an ordered array built from the per-row `phrase` values, and app subtitles come **only** from the pipeline-written `srt` — the master's `subtitle_text` is burnt-in overlay markup (`<aside>…`), never app subtitles. The `phrase` header is the format switch. Before adding a field or changing a read, decide which shape it applies to and cover both; `docs/video-pipeline/authoring-sheet.md` documents only the authoring shape today.

## The one-click pipeline chains reusable workflows; configs pushes with a PAT

`.github/workflows/pipeline.yml` owns the `render-complete` `repository_dispatch` (sent best-effort by the Modal orchestrator via `pipeline_lib.dispatch_render_complete`) and chains `sync-srt.yml` → `translate-sheet.yml` → `configs.yml` as reusable workflows with `needs:` + `secrets: inherit`. The three called workflows keep `workflow_call` (plus their manual `workflow_dispatch`) and **must not** also declare `repository_dispatch` — the chain would run twice. `pipeline.yml` sets `permissions: contents: read`; the `configs` job still pushes because it authenticates with `secrets.GH_NEW_TOKEN` (a PAT), not `GITHUB_TOKEN` — a caller's permission ceiling does not cap a PAT. Modal's `GH_DISPATCH_TOKEN`/`GH_DISPATCH_REPO` live in the Modal `uff-github` secret; the dispatch is best-effort (unset → skipped, failure → recorded in the `done` status `extra.dispatch`, never fails the render).

## The lesson Modal app registers no GPU function; BiRefNet lives in a separate deployed app

`docs/video-pipeline/modal_app.py` deploys `uff-lesson-video` with only the CPU orchestrator and trigger. Modal refuses a *new* persistent T4 function without a payment method, so `process_video_background_modal` and the `modal.Image` it needs live in `docs/video-pipeline/background_removal_app.py` (`modal.App("video-background-removal")`), which `modal_app.py` and `video_pipeline.py` must **not** import. `video_pipeline.background_removal_remote()` resolves the deployed function lazily via `modal.Function.from_name("video-background-removal", "process_video_background_modal")`, and a deployed handle needs no `app.run()` context. Guards assert the deploy graph (`modal_app.py` + `video_pipeline.py`) has no `gpu=` and that neither entry module mentions `background_removal_app`.

## Modal imports the entrypoint module in every container — keep module-level imports container-safe

Modal loads a function's **defining module** inside that function's container to resolve it, so every module-level import in `modal_app.py` must be satisfiable by **every** image that loads it. The lessons (all hit in production):

- The proxy-auth `trigger` lives in `docs/video-pipeline/trigger_app.py` (imports only `modal` + `fastapi`), and `modal_app.py` does `from trigger_app import app, trigger` so the deploy includes it. Because `trigger_app` imports `fastapi`, the **CPU image must carry `fastapi[standard]` too** — otherwise the orchestrator container dies importing `trigger_app` (no status marker → the recorder polls 404).
- `video_pipeline` must be imported **lazily** inside `orchestrator`/`_publish`. The CPU image has the source tree + deps; the fastapi-only trigger image does not, so a module-level `import video_pipeline` kills the trigger container (`ModuleNotFoundError: No module named 'video_pipeline'`).
- The orchestrator must mirror the local `main()`: call `pipeline.setup_environment()` before Stage 1 (it creates `no_silence/`, `output/social`, … and checks deps/fonts — otherwise Stage 1 fails on the missing `no_silence/`), and prepend `"ffmpeg"` to `pipeline_lib.reencode_web_args`/`poster_args` (they return *arguments* that start with `-y`; `subprocess.run(args)` then execs `-y`).

**A `modal deploy` snapshots the mounted source at deploy time.** A local edit under `docs/video-pipeline/**` — a fixed `pipeline_lib.plan_publish`, a patched `_publish` — does not reach the deployed app until a fresh `modal deploy docs/video-pipeline/modal_app.py` re-mounts it, so the local file being correct proves nothing about the running function. When the render's output disagrees with the current source (e.g. it still publishes per-take `processed_*` clips after `plan_publish` was fixed to publish the concatenated step/join videos), redeploy first — re-debugging the code is wasted until the mount is refreshed.

**Deploy from the repo root with the entrypoint's local imports installed.** `modal deploy docs/video-pipeline/modal_app.py` imports the module locally to resolve the app, so the deploying interpreter needs `modal`, `fastapi` (imported via `trigger_app`) and `boto3` (imported via `storage`) — a bare Python env fails with `ModuleNotFoundError: No module named 'fastapi'`. It must run from the repo root: `.add_local_dir("docs/video-pipeline", …)` is CWD-relative.

**A render can be driven headlessly (no recorder).** `POST {"jobId","files"}` to the deployed trigger URL with the `Modal-Key`/`Modal-Secret` proxy headers spawns the orchestrator and returns the `jobId`; then poll the private marker `uff-private/raw/status/<jobId>.json` (wrangler with `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`) until `status:"done"`, and confirm `published` plus a `200` from `r2.ultrafastfluency.com/assets/videos/<slug>.mp4`. The proxy token authorizes *calling* the trigger but cannot `modal deploy` (that needs an account token).

## Non-secret Pages variables belong in `wrangler.toml` `[vars]`

`wrangler pages deploy` (`.github/workflows/deploy.yml`) applies `[vars]` from `wrangler.toml` and **drops dashboard plain-text variables not listed there** (dashboard *secrets* survive). So any non-secret Pages variable a Function reads — e.g. `MODAL_RENDER_URL` in `functions/api/pipeline/render.js` — must be in `wrangler.toml`'s `[vars]`, not only in the dashboard, or a deploy silently unsets it and the Function returns `500 "Modal env unset"`. Secrets (`OPERATOR_KEY`, `MODAL_PROXY_TOKEN_ID`/`_SECRET`) stay in the dashboard.

## Importable `scripts/*.mjs` must guard their `main()`

A script module whose exports are imported (not only run as a CLI) must wrap its entrypoint:

```js
const invokedDirectly = process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
```

`scripts/generate-config-from-sheet.mjs` called `main()` at import time, so importing its exported `SHEET_URL` from another script would have run the generator (fetch + write configs). Declare exports above the guard. Test the CLI as a subprocess so the guard still runs it.

## If local `main` advanced without the worktree following, sync before editing

A ref can move ahead of the worktree when another process fetches/updates `main` without checking it out: `git status` then shows the whole delta as one huge staged changeset (here, ~14k deletions of the video pipeline and stories 040–046), and `git log` HEAD is a commit you never checked out. Confirm with `git rev-parse HEAD origin/main` and check whether the index equals another branch's tree (`git write-tree` vs `git rev-parse <ref>^{tree}`). If no work is unique, back it up (`git diff HEAD > /tmp/backup.patch`) and `git reset --hard HEAD` to sync the worktree to the real `main` before editing — never commit or discard a large diff you did not create without that check.

A related case: a **feature branch cut before `main` advanced is behind `main`**, so `DEFAULT_BRANCH..HEAD` renders every main-only commit as a *deletion* in the reviewer diff (it reads as the branch reverting the pipeline/CI work). Merge `origin/main` into the feature branch (`git merge origin/main`) before running reviewers, so the range contains only the branch's own changes; when the branch only touches `src/**` (or config/poster files main also changed identically) the merge is usually conflict-free.

## A config change that adds an intro slug must also update the poster artifacts and their guards

The config bot can regenerate `src/config/*.json` and add a new first-step `introBackgroundVideoUrl` slug without touching the poster artifacts, leaving the branch (and `main`) red: `src/generated/poster-lqips.js` has no LQIP entry for the slug and three tests enumerate the intro slugs. After such a change, run `node scripts/generate-thumbnails.mjs` (needs `ffmpeg` on PATH and R2 reachability; it fetches the published `.jpg`/`.mp4`, so no Cloudflare creds) to rewrite `src/generated/poster-lqips.js`, then add the slug to the lists in `scripts/lib/poster-utils.test.js`, `src/generated/poster-lqips.test.js`, and the `"N intro slugs"` stdout assertion in `scripts/verify-thumbnails.test.js`. The `wouldyourather` config's `intro` slug is the worked example; it is a legitimate R2 poster, not a placeholder.

## Non-blocking email confirmation is app-level; its flag is server-managed

Supabase's own email confirmation (`auth.email.enable_confirmations`) is all-or-nothing: with it on, `signUp()` returns no session until the user clicks, which **blocks signup**. This app keeps signup non-blocking, so verification is app-level (`supabase/migrations/006_add_email_confirmation.sql`): the Pages Function `functions/api/welcome-email.js` stores only a SHA-256 token hash in `email_confirm_tokens` with the **service-role key** (the table grants nobody else, so a user cannot mint a token and self-confirm), emails a `/confirm-email?token=<raw>` link, and an anon `confirm_email_hash()` RPC sets `user_profiles.email_confirmed`. The welcome-email endpoint is **fail-open** — it returns `200 { sent:false, reason }` for every provider/store failure and only `401`s an unauthenticated caller — so a broken email provider can never fail signup.

Because 001/002 give `authenticated` table-level UPDATE on `user_profiles` plus an owner-update policy, the flag would otherwise be client-writable (a user could `PATCH` their own row with `email_confirmed: true` and forge the signal). A `before insert or update` trigger (`protect_email_confirmed`) rejects any `anon`/`authenticated` write to `email_confirmed`/`email_confirmed_at`; the RPC passes because a **SECURITY DEFINER** function runs with `current_user` = the function owner, not the Data API role. Use `current_user` (not `session_user`, which is `authenticator` for both paths) when a trigger must distinguish an RPC write from a PostgREST owner write. The token is single-use and the client must confirm exactly once — under React StrictMode a naive effect double-fires and the second RPC would find the token already burned, so memoize the in-flight promise per token.

