# Learnings

## Inspect `git diff` before staging — pre-existing working-tree changes get swept into commits
**Date**: 2026-09-20
**Area**: workflow
**What happened**: A `.gitignore` commit intended to remove `/docs` accidentally also committed a pre-existing uncommitted `.env` ignore line that was sitting in the working tree. The code reviewer flagged it as a no-op that contradicted the adjacent comment.
**Takeaway**: Before `git add`, run `git diff` on each file you are about to stage and confirm every hunk is yours. Pre-existing uncommitted changes (e.g. from the environment) are easy to sweep in.

---

## `.env` is tracked but carries an uncommitted sandpod-managed token block — never stage it
**Date**: 2026-09-20
**Area**: workflow | security
**What happened**: The working-tree `.env` contains a sandpod-managed block (`EXPO_TOKEN`, `GH_TOKEN`, `GH_NEW_TOKEN`) that is uncommitted; the committed `.env` only holds public `VITE_*` keys. A reviewer flagged the token as a credential risk.
**Takeaway**: Never `git add .env`. If you must change it, edit only the committed `VITE_*` keys. The sandpod block is overwritten by the environment and must not be committed.

---

## Playwright browser revision mismatch in this sandbox
**Date**: 2026-09-19
**Area**: testing
**What happened**: `npx playwright test` failed to launch with `Executable doesn't exist at .../chromium_headless_shell-1223/...` because `@playwright/test` 1.60.0 expects Chromium build 1223 while the sandbox cache only had build 1243.
**Takeaway**: Run `npx playwright install chromium` to fetch the expected build, or symlink `~/.cache/ms-playwright/chromium-1223 -> chromium-1243` and `chromium_headless_shell-1223 -> chromium_headless_shell-1243`. For one-off scripts, pass `executablePath` to `chromium.launch` instead. CI installs its own browsers, so this is sandbox-only — do not hardcode paths in the repo.

---

## Comment-stripping regexes silently disable source-guard tests
**Date**: 2026-09-19
**Area**: testing
**What happened**: A platform-purity guard test stripped comments with `/\/\/.*$/gm` before asserting the source contained no `https://`. The stripper treats the `//` inside `https://` as a comment start, so it erased the URL before the assertion ran — the guard could never fail. The code reviewer caught it; injecting a scheme confirmed the test stayed green.
**Takeaway**: Never run a URL/scheme assertion against comment-stripped source. Assert on the raw source for scheme checks, and use the stripped source only for bare-identifier checks (e.g. `window`/`document`). Always prove a guard test can fail by temporarily injecting the thing it forbids.

---

## `video-processor.native.jsx` is an unwired placeholder, not a live renderer
**Date**: 2026-09-19
**Area**: architecture
**What happened**: A change to the shared `VideoRenderPlanner` (adding a tailing `variant` field) was flagged as breaking native, but `video-processor.native.jsx` has no importer, no `react-native`/`expo` dependency in `package.json`, and Vite does not resolve `.native.jsx`. It is reference code for a future RN port; only its `exportSegmentsToR2` is a true no-op stub.
**Takeaway**: Keep platform-agnostic domain logic (planner, CTA builders, overlay decision table) in `video-processor-logic.js`; keep only drawing in `video-processor.web.js`. When changing the shared planner contract, note in the native file's header that it does not implement the new field rather than adding speculative code to dead code.

---

## `webcamOnly` + `friendClosedResponse` is the ungraded friend-challenge combination
**Date**: 2026-09-19
**Area**: architecture
**What happened**: Determining how to make a lesson record without scoring or feedback took several wrong turns. `simpleVideoUrl` does not suppress feedback (it only changes which media renders); `closedResponse` always emits praise/teacher feedback even without `interactiveVideoUrl`. Only `friendClosedResponse` skips scoring and feedback, and it records fine with `simpleVideoUrl` (phase `simpleVideo` is in `RECORDABLE_PHASES`).
**Takeaway**: For "record, no score, no feedback" use `friendClosedResponse` + `simpleVideoUrl`. Note `simpleVideoUrl` renders text only from `step.subtitles` (not `cue`), so add `subtitles` or the prompt is audio-only. `webcamOnly: true` on a lesson makes its recap contain only the user's own clips and swaps the fluency card for the share CTA.

---
