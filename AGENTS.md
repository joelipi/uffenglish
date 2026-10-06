# Repository guidance

Standing rules for working in this repository. Detailed incident write-ups live in `docs/learnings.md`.

## Source-guard tests must be able to fail

This repo relies heavily on tests that assert on source text ("guards"). Three separate incidents (see git history and `docs/learnings.md`) produced a guard that could never fail. When writing or editing one:

- **Do not strip comments before scheme/URL assertions.** A `/\/\/.*$/gm` stripper reads the `//` in `https://` as a comment and erases the URL, so the assertion can never fail. Assert on the raw source for scheme checks; use the stripped source only for bare-identifier checks (`window`/`document`).
- **Whole-file `toContain` only works for tokens that appear exactly once.** Over an entire stylesheet/source file it stays green even when the specific rule is deleted. Scope the slice to the specific block (`slice(indexOf(selector), …)`) and assert every property in it.
- **Never slice a function body to EOF.** End the slice at the next top-level marker (`indexOf('export const …')` / the next `export async function …`). A function appended later otherwise silently joins the slice and the guard passes on strings that are not in the target function.

Before trusting a guard, prove it can fail by temporarily injecting the thing it forbids.

## A new `src/**` test file must not mention the recorder page

`src/modules/video/recorder-page.test.js` scans every file under `src/**` for a reference to the operator-only recorder page (`/recorder` / `recorder.html`) and fails on any hit. A new guard test that lives in `src/**` and mentions that page — even in a path constant or a comment — breaks that hidden-page guard. Avoid the literal token in `src/**` (build paths from parts, e.g. `'recorder' + '.html'`), or add the file to the scanner's exclude set.

## New public top-level routes must be registered in `PUBLIC_ROUTES`

`useGuestModalGuard` opens the guest language/login modal for anonymous visitors on every non-auth route unless `isPublicHomeRoute(path)` is true (`src/modules/user/guest-modal-logic.js`). Any page that must be readable without that modal (e.g. `/privacy`, `/terms`) has to be added to `PUBLIC_ROUTES`; the lookup normalizes trailing slashes and case to mirror React Router's matching (`/Privacy`, `/privacy/` resolve to the page). Declare static routes before the single-segment `/:shareCode` catch-all, and cover the non-canonical forms in `guest-modal-logic.test.js`.

## Pipeline grouping must match the config's step granularity

`docs/video-pipeline/video_pipeline.py` groups processed clips by the CSV `filename` prefix (`group_prefix_for_filename`, the leading non-digit run), which collapses a whole lesson on the overlay master (`wouldyourather_b01_i01` → `wouldyourather_b`) while the app config's step is the `video_file` column. The rendered video, the join and the SRT must all key by `pipeline_lib.group_key_for_filename` (non-blank `video_file`, else the legacy filename prefix), and `scripts/write-srt-to-sheet.mjs` mirrors that rule. When adding a stage that groups clips, route it through the shared key and assert it (a stage that re-derives its own prefix silently disagrees with the config). Compare step keys by **equality**, never `startswith`: sibling keys share a prefix (`wouldyourather_b01_i` is a prefix of `wouldyourather_b01_ii01`), so a substring match selects the wrong row (e.g. the wrong `bgMusic`).

## The overlay master and the authoring sheet are two shapes for one generator

`scripts/lib/sheet-config-utils.js` / `scripts/generate-config-from-sheet.mjs` read two sheet shapes, chosen by header: the **overlay master** (has a `phrase` column) and the **authoring sheet** (has `cue`/`cue_alt`). On the master a step is the `video_file` (or its `join` value, which is the published slug), the app `cue` is an ordered array built from the per-row `phrase` values, and app subtitles come **only** from the pipeline-written `srt` — the master's `subtitle_text` is burnt-in overlay markup (`<aside>…`), never app subtitles. The `phrase` header is the format switch. Before adding a field or changing a read, decide which shape it applies to and cover both; `docs/video-pipeline/authoring-sheet.md` documents only the authoring shape today.

## The one-click pipeline chains reusable workflows; configs pushes with a PAT

`.github/workflows/pipeline.yml` owns the `render-complete` `repository_dispatch` (sent best-effort by the Modal orchestrator via `pipeline_lib.dispatch_render_complete`) and chains `sync-srt.yml` → `translate-sheet.yml` → `configs.yml` as reusable workflows with `needs:` + `secrets: inherit`. The three called workflows keep `workflow_call` (plus their manual `workflow_dispatch`) and **must not** also declare `repository_dispatch` — the chain would run twice. `pipeline.yml` sets `permissions: contents: read`; the `configs` job still pushes because it authenticates with `secrets.GH_NEW_TOKEN` (a PAT), not `GITHUB_TOKEN` — a caller's permission ceiling does not cap a PAT. Modal's `GH_DISPATCH_TOKEN`/`GH_DISPATCH_REPO` live in the Modal `uff-github` secret; the dispatch is best-effort (unset → skipped, failure → recorded in the `done` status `extra.dispatch`, never fails the render).

## The lesson Modal app registers no GPU function; BiRefNet lives in a separate deployed app

`docs/video-pipeline/modal_app.py` deploys `uff-lesson-video` with only the CPU orchestrator and trigger. Modal refuses a *new* persistent T4 function without a payment method, so `process_video_background_modal` and the `modal.Image` it needs live in `docs/video-pipeline/background_removal_app.py` (`modal.App("video-background-removal")`), which `modal_app.py` and `video_pipeline.py` must **not** import. `video_pipeline.background_removal_remote()` resolves the deployed function lazily via `modal.Function.from_name("video-background-removal", "process_video_background_modal")`, and a deployed handle needs no `app.run()` context. Guards assert the deploy graph (`modal_app.py` + `video_pipeline.py`) has no `gpu=` and that neither entry module mentions `background_removal_app`.

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

