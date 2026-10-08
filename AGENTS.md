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

## Pages custom domains and DNS are two independent steps

A Pages custom domain can report `status: active` while its hostname still 522s: the custom-domain entry and the DNS record are separate. Adding a domain via the API (`POST /accounts/<acc>/pages/projects/<project>/domains`) does **not** create the DNS record (the dashboard does), so `ultrafastfluency.com`/`www` need a **proxied CNAME to `uffenglish.pages.dev`** (apex is CNAME-flattened) — never a leftover origin A record. A branch alias (`s.` → `staging.uffenglish.pages.dev`) likewise only works through a **proxied** record. Managing domains needs **Pages Write**; editing DNS needs zone **DNS Write** (`CF_TOKEN` has only DNS Read but `Account API Tokens Write`, so a short-lived DNS-write token is minted for the edit). The DeepSeek proxy is **not** on the Pages deploy path — deploy it after changing its CORS list. Full layout and procedures: `docs/deploy-environments.md`.

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

## Do not trigger CI workflows unless there is a real need

GitHub Actions is for the work **only** CI can do, not for "seeing if it passes". Verify locally first — `npx vitest run` (unit), `node scripts/run-python-tests.mjs` (pipeline), `npx playwright test` (browser), `npm run build`, `npm run lint` — and only push to a workflow-wired branch (or dispatch a workflow) when that run's actual output is the deliverable.

- Pushing `main` fires `deploy.yml` (production Cloudflare Pages deploy) **and** `captions.yml` (Whisper + DeepSeek transcription/translation, then a commit). Pushing `staging` fires `deploy-staging.yml`. Never push to those branches just to test, and never run `gh workflow run` "just in case".
- `.github/workflows/playwright.yml`, `pipeline.yml`, `configs.yml`, `sync-srt.yml`, `translate-sheet.yml` and `deploy-staging.yml` are `workflow_dispatch` (or `workflow_call` from the one-click chain) precisely so they stay **off** routine pushes — keep it that way, and dispatch one only when its output is required (e.g. a render needs the sheet chain, or a newly added slug needs captions).
- Every run burns Actions minutes; a run on `main` also ships to production. A redundant run is a cost, not a safety net. If a workflow genuinely must run, say why in the same message.

---

# Playbook (consolidated from the former `agents.md`)

## 1. Code Architecture & Organization

**Pure React — No DOM Manipulation**
This codebase is moving strictly to React patterns. Never use `document.querySelector`, `getElementById`, `classList`, `style.setProperty`, `appendChild`, or any direct DOM API. Drive all UI changes through React state, refs (for focus/measurement only), and CSS classes on React elements. Violations of this rule will be treated as bugs.

**Modular Structure**
Keep logic in the module where it conceptually belongs. Do not co-locate unrelated concerns.

**Guest language is authoritative; `userData.native_language` is its mirror**
Resolve the active language guest-first everywhere — `guestNativeLanguage || userData?.native_language || 'en'` (`config-normalizer.js`, `video-share.web.js`, `HomeScreen.jsx`). A logged-in profile always wins. `userData.native_language` is kept in sync only so components that read it directly stay correct; the store's `setCourseData` must never let the async bootstrap's fetched profile revert a guest's chosen language (`applyGuestLanguagePreference`). If you add a component that localizes by language, use the guest-first expression, not `userData.native_language` alone.

**Logic / presentation separation (React Native–portable)**
Keep domain rules (gates, mappings, URL/path building, formatting, scoring) in pure `*-logic.js` modules with no React, no DOM, and no React Native imports; keep data access in `src/modules/api/`; keep rendering in components. Platform-specific rendering must use the bundler-resolved extension convention: `vite.config.js` resolves `.web.jsx`/`.web.js` before `.jsx`, and Metro resolves `.native.jsx`/`.native.js` — so a component that needs a native counterpart is written as `<Name>.web.jsx` (imported explicitly, like `GuestLoginModal.web.jsx`) and later paired with `<Name>.native.jsx` implementing the same props/`data-testid`s. Split containers (hooks + data) from presentational views so a native view only re-implements rendering. Do not add speculative `.native.*` code — the repo treats unwired native files as reference (`docs/learnings.md`).

**Lesson content vs UI copy**
Lesson content (cues, subtitles, transcripts, step config) lives in `src/config/*.json`. `src/data/strings.js` is UI copy only — never search it for lesson content. For config-only changes, derive the pattern from the earlier lessons in the same config file; don't explore player/store code unless the change touches it.

**`app.css` is a hand-written Bootstrap subset — Bootstrap classes in JSX may be dead**
`src/assets/css/app.css` is not Bootstrap's stylesheet; Bootstrap's CSS is never imported (`src/main.jsx` imports only `bootstrap-icons/font/bootstrap-icons.css`). Only the utility/grid classes actually defined in `app.css` exist — e.g. `.col-4` is defined but `.col-6`/`.col-md-6`/`.mt-md-0` were not, so JSX using them silently collapsed to content width. Before relying on any Bootstrap class, grep `app.css` for it; if missing, add the rule (mirror Bootstrap 5 semantics, including the `.row > *` base rule that makes a bare `.col-md-6` stack full-width below its breakpoint). Note `.row > *` also matches `ScoreBoard`'s `.col-4` children, which are protected only by their `px-2 !important` padding.

**Auto captions for simple videos**
New `simpleVideoUrl` steps get captions automatically on push (six languages: en/es/pt/fr/hi/bn) via `.github/workflows/captions.yml` (local Whisper + DeepSeek, `scripts/generate-captions.mjs`). Do not hand-backfill captions for existing videos — the pipeline only touches newly added slugs and never overwrites authored `subtitles`.

**Posters are R2-only, written by the Modal render**
Every poster is a still of its video, so its name is the video's URL with `.mp4`→`.jpg` (`getPosterUrl(slug)`). Teacher/lesson-intro posters for every **`steps`-shaped** `src/config/*.json` course are written by the **Modal render** — `modal_app._publish` uploads each step/join slug's `assets/videos/<slug>.jpg`, and `_publish_intro_posters` covers the synthesized `intro_video` slugs, which never enter the publish plan — so no CI step generates them and `deploy.yml` no longer installs ffmpeg; `scripts/generate-thumbnails.mjs` remains for a manual re-render (`npm run posters:upload`) after replacing a video out of band, and (re)generates a slug when its poster is missing **or when its source `.mp4` has a newer R2 `Last-Modified` than the published `.jpg`** (stories/025-regenerate-stale-posters); UGC friend clips upload a sibling `.jpg` at publish time. **`questions`-shaped configs are deliberately ignored** — `introTargets` reads `steps[0]` only and does not normalize `questions`→`steps`, because `gt2.json`'s first-step `questions` intros are vestigial (story 011, explicitly out of scope; delete them from `gt2.json` separately). Posters are **never committed locally** (no `public/assets/posters/`) and never served locally — the browser always fetches them from R2, in dev through the existing `/assets/videos/` proxy. The only poster-derived file in git is the tiny LQIP module `src/generated/poster-lqips.js`, which is legacy now that the render owns posters: CI no longer rewrites it (only a manual `npm run posters` run does). A published UGC poster is also copied into the persistent Supabase `avatars` bucket and set as the learner's profile picture when they have none, because the R2 `videos/` object expires after 48h (`src/modules/avatar/poster-avatar.js`). The concatenated end-of-lesson recap is also published to R2 under the same `videos/` namespace (48h TTL) as `videos/<shareCode>-<courseId>-<lessonId>-complete.mp4` — best-effort and skipped when the transcoded file exceeds the Function's 50 MB cap (`uploadCompleteVideoToR2`, `src/modules/video/video-processor.web.js`). The cap is single-sourced in `src/modules/video/r2-upload-limits.js` (`MAX_R2_UPLOAD_BYTES`), imported by the Function and re-exported by the client. Locally the generator reuses cached source mp4s from `os.tmpdir()/uff-posters-cache` without revalidating them, so after replacing a video on R2 delete `<slug>.mp4` from that cache before regenerating or the old poster is rebuilt (a fresh checkout has an empty cache). The LQIP step also downloads every non-regenerated poster into the work dir, so any run with work makes `--upload` re-push all posters and tests must key off the `GEN` stdout line, not work-dir file presence.

**Resource & Cost Optimization**
Minimize external operations. All data fetching and mutations must go through TanStack Query and Zustand — never call Appwrite or any external service directly from components or hooks. Prefer in-browser, client-side model operations over external LLM API calls to reduce cost and lay groundwork for offline mode. Balance local-first execution against device CPU/memory constraints.

**Version Control**
Primary branch is `main`. Commits land on `main` directly, so once committed `main..HEAD` is empty — review ranges must use the remote default (`origin/main..HEAD`). This repo is a `blob:none` partial clone: `git log`/`git diff` between local refs work, but `git show <older-sha>` can fail with an auth error for blobs the promisor has not fetched.

**Rebase if `origin/main` has advanced.** `peck story create` branches from the current commit, but parallel work keeps merging to `main`. If `git log --oneline HEAD..origin/main` is non-empty when you reach the verify step, `git rebase origin/main` before running reviewers. Otherwise `origin/main..HEAD` contains the *inverse* of every upstream commit your branch lacks, and the code reviewer will Fail on those apparent reverts (e.g. a later branch's i18n/CSS fix) even though your feature is fine.

**If the story branch is already pushed, merge instead of rebasing.** Rebasing rewrites commits that are already on `origin/<branch>`, which forces a push the rules forbid. To get the same clean `origin/main..HEAD` without force-pushing: `git reset --hard origin/<branch>` (the pushed tip), then `git merge origin/main`. The merge commit makes `origin/main` an ancestor, so `git push` is a fast-forward, and the review range again contains only your commits + the merge. Resolve any `agents.md`/`docs/product.md` conflicts by keeping both changes.

**`peck story load` takes the bare story number (`peck story load 050`), not the slug or `stories/…` path** — anything else prints `Story not found`. `peck story create` does not reserve numbers, so a parallel worktree can create a same-numbered story (e.g. two `050-…`); when `origin/main` later contains that story, merge it in (never rebase a pushed branch) and keep both story directories.

**Branch can switch underneath you.** Parallel processes (peck story create, openchamber worktrees) create story branches and check them out while you work. Before every `git commit`, run `git branch --show-current` and confirm it matches the story branch. A parallel process may also `git stash` the shared worktree (e.g. to rebase), so uncommitted tracked edits can vanish mid-task — commit each coherent change as soon as it is ready, and recover stashed work with `git stash list` + `git checkout stash@{N} -- <path>`. If a commit or reviewer report lands on the wrong branch, `git cherry-pick` it onto the correct one. If file contents suddenly don't match your edits, check `git branch --show-current` + `git status` before debugging — the working tree may be a different branch's state.

**Push the story branch when the work is verified.** A local-only branch cannot be tested or deployed, so once both reviewers pass, push it: `git push -u origin <story-branch>`. Do this for every story unless the user says otherwise — do not leave verified work unpushed. Merging into `main` is a separate, explicit step (only when the user asks); pushing the branch is the default end state of a completed story.

---

## 2. Comments & Logging

- **Preserve comments.** Update them when the code they describe changes. Only delete a comment if its code is deleted.
- **Preserve `console.log` statements.** Do not remove existing logs unless the code they relate to has also been removed; comment them out if suppression is needed.
- **Add debug and success logging.** Every significant function or event should log both on failure (with detail) and on success (so it's immediately clear the path fired).

---

## 3. Autonomy & Approvals

Execute small, incremental changes and routine bug fixes immediately without asking for approval.

(The CI rule lives in "Do not trigger CI workflows unless there is a real need" above.)

---

## 4. Testing & Console Monitoring

**Automated browser testing** via Playwright unless the user says they will test manually.

**Check `playwright.config.js` `testIgnore` before citing a spec.** Stale specs (`e2e-smoke`, `recording-persistence`, `success-screen`, `whisper-review`) are silently skipped, so `npx playwright test <them>` "passes" without running a single assertion. Don't name an ignored spec as a passing AC; cite only specs the config actually runs.

**Console discipline — treat these as bugs:**
- Any unexpected or relevant console error or warning
- Any expected debug/success log that does not appear (silent failures must be investigated)

**Clean up after deletions.** After removing any export, verify all imports of that export are also removed. Run the smoke test to catch load-time errors:
```
tests/answer-flow.spec.js
```

**Config-only changes: unit test the config, skip E2E.** When a change only edits `src/config/*.json`, a vitest unit test importing the JSON (e.g. `src/config/model.test.js`) is sufficient coverage when the rendering path is already exercised by existing lessons. Don't add a Playwright spec for a config-only change.

**`source inspected → …` ACs need a real static-guard test.** When a story lists an acceptance criterion as `[file] source inspected → contains/does not contain …` (purity constraints, required imports, wiring contract), the implementer must add an automated `readFileSync` guard for it. The `@acceptance-reviewer` treats every AC as requiring a passing test and will Fail the task if such ACs have no guard, even when the runtime behavior is covered. Put guards beside the feature (e.g. `notification-wiring.test.js`) and assert only on raw source, never comment-stripped source (`docs/learnings.md`).

**Test URL:** `http://localhost:3000/course/model/lesson/g`
Lessons require a full URL where `course` and `model` map to valid JSON files and `lesson` is a valid key within that JSON, unless lesson data is already in memory.

**Testing data-driven pages (profile, share-code views):** don't mock Supabase or log in. Load the route, wait for its initial query to settle, then inject fixtures into the app's own query cache from `page.evaluate`:
```js
const { queryClient } = await import('/src/modules/api/api.js');
queryClient.setQueryData(['user', 'profile', 'shareCode', code], fixture);
```
`main.jsx` passes that same singleton to `QueryClientProvider`, and `staleTime: Infinity` keeps the injected data from refetching. For time-dependent UI (countdowns, expiry), fix the clock first with `await page.clock.setFixedTime(new Date('2026-09-24T12:00:00Z'))` so the rendered values are deterministic. See `tests/friend-lesson-link.spec.js`.

**Layout/paint specs must target the app frame, not fixed viewport coordinates.** At ≥576px `.video-frame` is `width: auto; aspect-ratio: 9/16` and `#root` is centred inside the black `.app-container` (`src/assets/css/app.css:343-364`), so a fixed `{ x, y }` screenshot clip can land on the container instead of the app and pass for the wrong reason. Either set a mobile viewport (<576px, where `#root` fills the viewport) or derive the clip from `#root`'s `boundingBox()`. To assert CSS paint order (e.g. that a pseudo-element does not cover static content), force the layer to an opaque marker colour, disable its animation, screenshot a clip, and decode the pixels **in the page** with `createImageBitmap` + `OffscreenCanvas.getImageData` — no Node PNG dependency (`tests/water-shimmer-scope.spec.js`).

**Lesson media (real recordings only):** every video slug in `src/config/*.json` resolves to a real file on R2 at `assets/videos/<slug>.mp4` (`src/modules/video/video-url.js`). Video files are never committed (too large) and are gitignored. Upload recordings to R2 manually, e.g. `npx wrangler r2 object put uff/assets/videos/<slug>.mp4 --file <path> --content-type video/mp4`, then reference the slug in the config. Do not add a placeholder/mock video generator.

---

## 5. Infrastructure Gotchas (READ FIRST if video/audio/CORS breaks on `s.`)

> **If `<video>` shows `MEDIA_ELEMENT_ERROR: Format error`, `No 'Access-Control-Allow-Origin'`, or Whisper `TypeError: Load failed` on `https://s.ultrafastfluency.com`** (works on localhost) → read **`docs/cloudflare-video-cors.md`**. This is a Cloudflare Transform-Rule config, NOT an app bug.

The short version:
- `s.` must serve `Cross-Origin-Embedder-Policy: credentialless`; `r2.ultrafastfluency.com` must serve `Access-Control-Allow-Origin: *` **and** `Cross-Origin-Resource-Policy: cross-origin` on ALL responses **including `206` range responses** (R2's native CORS omits ACAO on 206 → `<video>` byte-range requests get blocked).
- Fix lives in the Cloudflare zone **Transform Rules** (`http_response_headers_transform`), 3 rules: (1) other hosts `require-corp`, (2) `s.` → `credentialless`, (3) `r2` media paths → `ACAO *` + `CORP cross-origin`. Exact payload + verify commands in `docs/cloudflare-video-cors.md:§3-4`.
- To verify with an automated browser, **use real Chrome** (`npx playwright install chrome`, `channel: 'chrome'`) — Playwright's bundled Chromium lacks H.264/AAC codecs and falsely reports `Format error` on valid mp4s.
- Don't trust bare `curl -I` for R2 videos — it returns `200` (has ACAO). Send `-H "Range: bytes=0-1023"` to reproduce the real `206` behavior.
- **`wrangler pages deploy` fails with `Binding name 'SUPABASE_ANON_KEY' already in use`** if the key is in both `wrangler.toml [vars]` and the Pages dashboard. Keep it only in the dashboard.
- **`MediaRecorder` MP4 duration metadata is unreliable.** A browser-recorded mp4 (the platform `getSupportedMimeType()` prefers `video/mp4`) can declare a bogus tiny duration in its container header (measured: **0.12 s for a 4 s clip**). `probeClipDurationSec(blob)` is metadata-first and returns it, so anything that trusts it (e.g. calibrating step time ranges against the recording length) breaks. Pass `{ accurate: true }` to force the `computeDuration` packet scan, and treat the probe as unusable whenever it disagrees with wall-clock recording time by more than a second. `computeDuration` on the same blob correctly returned 3.95 s. The bundled-Chromium test harness cannot validate the trim path — it lacks H.264 and fails with `undecodable_source_codec`; use real Chrome.

---

## 6. App-Specific Testing Workarounds

**Speech-to-Text / Microphone**
You cannot use a microphone. Bypass it using built-in testing functions, or invoke `handleAnswer` (or equivalent) directly to simulate audio input.

**Voice-first, text available (product rule).** Mic/webcam are the primary path; text mode is a fallback for people who cannot speak or whose device cannot run voice. The keyboard icon in the mode chooser is always visible and usable — it does not depend on the speech engine, so text is never hidden while the engine loads or fails. Never let a recoverable failure (no mic, blocked permission, engine error) strand the user on a muted-mic screen: keep the voice mode chooser mounted, show descriptive actionable recovery guidance, and offer Retry.

Headless recipe (local dev on `:3000`):
- Dismiss the guest modal: click `#guestEnglishOnlyBtn`, then `#guestContinueBtn`.
- The guest modal is a native `<dialog>` (`#guestLoginModal`). While it is open it sits in the browser top layer, above *any* `z-index` (e.g. it intercepts clicks on `#landscape-warning`, z-index 2000). Dismiss it before clicking any overlay control, or use `locator.dispatchEvent('click')`.
- Advance past the intro: click `#intro-call-widget`.
- Simulate engine loading/failure by routing `**r2.ultrafastfluency.com/whisper/**` (and `**cdn.jsdelivr.net/**`) to hang or abort; call `window.appStore.getState().setWhisperReady(true)` to reach the mic path without a full model download.
- Headless Chromium has no media devices, so `getUserMedia` rejects — use this for the no-mic recovery path.

**Authentication**
Do not log in unless the task explicitly requires it — login interferes with guest-user testing.
Credentials (use only when required):
- Email: `jules@example.com`
- Password: `testtest`
