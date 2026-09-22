# Learnings

## Inspect `git diff` before staging — pre-existing working-tree changes get swept into commits
**Date**: 2026-09-20
**Area**: workflow
**What happened**: A `.gitignore` commit intended to remove `/docs` accidentally also committed a pre-existing uncommitted `.env` ignore line that was sitting in the working tree. The code reviewer flagged it as a no-op that contradicted the adjacent comment.
**Takeaway**: Before `git add`, run `git diff` on each file you are about to stage and confirm every hunk is yours. Pre-existing uncommitted changes (e.g. from the environment) are easy to sweep in.

---

## `.env` is untracked and carries sandpod-managed secrets — never stage it; VITE_* needs fallbacks for CI
**Date**: 2026-09-20
**Area**: workflow | security | build
**What happened**: `.env` was removed from git tracking (7d9d7cf) and now holds a sandpod-managed block (`EXPO_TOKEN`, `GH_TOKEN`, `GH_NEW_TOKEN`) plus public `VITE_*` keys. A code review flagged that CI builds (which no longer read a committed `.env`) silently lose `VITE_PUBLIC_POSTHOG_*` — `posthog-client.js` called `posthog.init(undefined, ...)` with no guard.
**Takeaway**: Never `git add .env`. Any `VITE_*` value consumed at build time must have a publishable fallback in source (mirror `src/modules/api/supabase.js` and `src/modules/utils/posthog-client.js`) or be provided in the CI workflow, because CI builds do not read a committed `.env`.

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

## `friendClosedResponse` is the ungraded friend-challenge combination
**Date**: 2026-09-19
**Area**: architecture
**What happened**: Determining how to make a lesson record without scoring or feedback took several wrong turns. `simpleVideoUrl` does not suppress feedback (it only changes which media renders); `closedResponse` always emits praise/teacher feedback even without `interactiveVideoUrl`. Only `friendClosedResponse` skips scoring and feedback, and it records fine with `simpleVideoUrl` (phase `simpleVideo` is in `RECORDABLE_PHASES`).
**Takeaway**: For "record, no score, no feedback" use `friendClosedResponse` + `simpleVideoUrl`. Note `simpleVideoUrl` renders text only from `step.subtitles` (not `cue`), so add `subtitles` or the prompt is audio-only. Recap composition is driven by two lesson flags that replaced `webcamOnly` (story 010): `recapSources` (`system`/`friend`/`none`) picks which prompt clips concatenate, `recapOverlay` (`fluency`/`shareCta`/`none`) picks the card.

---

## Verification gate is `npm test -- --run` — eslint and knip are not runnable
**Date**: 2026-09-20
**Area**: build | testing
**What happened**: ESLint 10 requires flat config but the repo ships legacy `.eslintrc.json`, so `npx eslint` fails to start; knip's config targets an old `js/**` layout that no longer matches `src/`/`functions/`. CI (`deploy.yml`) only runs `npm test -- --run`.
**Takeaway**: Use `npm test -- --run` as the verification gate. Don't run eslint/knip as gates — they are not configured for the current layout.

---

## Read tool redacts `🔒...🔓` placeholder strings — verify edits with `git diff`
**Date**: 2026-09-20
**Area**: workflow
**What happened**: The repo contains literal secret-redaction placeholders (e.g. `Bearer
src/modules/api/supabase.js` in `functions/api/upload-segment.js`). The Read tool output redacts these, and an edit whose oldString used a different string still matched, mangling indentation.
**Takeaway**: After editing a file that contains `🔒...🔓` placeholders, verify the result with `git diff` (actual bytes), not the Read tool (redacted display). Treat `🔒...🔓` strings as literal file content.

---

## Story branches branch from the current branch — `main..HEAD` includes parent-story commits
**Date**: 2026-09-20
**Area**: workflow
**What happened**: `peck story create` branched `005-skip-friend-feedback` from `004-fix-r2-upload-config` (the branch I was on), not from `main`. The code-reviewer range `main..HEAD` therefore included the 004 story's commits, and its review flagged 004's code (Supabase constant duplication, an unused test binding) as part of the Fail — I had to fix the parent story's code to get a Pass.
**Takeaway**: Before creating a story, note which branch you're on — `peck story create` branches from it. When a story branch is based on another story branch, expect `DEFAULT_BRANCH..HEAD` to include the parent story's commits; the code-reviewer will review (and may fail on) that code too. Either base stories on `main`, or be ready to fix parent-story findings.

---

## Pages Functions can import from `src/` — verify with `wrangler pages functions build`
**Date**: 2026-09-20
**Area**: build | architecture
**What happened**: To dedupe Supabase fallback constants between the SPA (`src/modules/api/supabase.js`) and the Pages Function (`functions/api/upload-segment.js`), I extracted `src/modules/api/supabase-constants.js` and imported it from the Function via `../../src/...`. `wrangler pages functions build --outdir=...` compiled successfully and the constants were bundled into the output.
**Takeaway**: A constants-only module in `src/` can be imported by a Pages Function as long as it has no `import.meta.env` (which the Function bundle can't resolve). Verify any cross-directory Function import with `npx wrangler pages functions build --outdir=/tmp/...` and grep the output for the expected value.

---

## Auto-advance paths must replicate `showFeedbackAndProceed`'s `stepCount` increment exactly once
**Date**: 2026-09-20
**Area**: architecture
**What happened**: The friendClosedResponse auto-advance branch in `handleAnswer` incremented `stepCount` before the `_deps.loadNextStep` guard, so the fall-through path (missing deps) incremented it again inside `showFeedbackAndProceed` — a double increment that corrupted the `step_count` reported to the backend. The code reviewer caught it.
**Takeaway**: `showFeedbackAndProceed` increments `stepCount` for interactive-video response steps (`answer-pipeline.js:984-987`). Any new path that bypasses it (e.g. direct `loadNextStep` calls) must replicate that increment exactly once — put it inside the same guard that decides between auto-advance and fall-through, and assert `stepCount` in the fallback test.

---

## Reviewer subagents can fail to launch — fall back to `peck <type>-review commit` with a manual report
**Date**: 2026-09-21
**Area**: workflow
**What happened**: The `@code-reviewer` subagent repeatedly failed to launch with `Upstream request failed: [invalid_request_error] Extra inputs are not permitted, field: 'on_complete'`. Root cause: the agent configs (`~/.config/opencode/agents/*.md` and `.opencode/agents/*.md`) were provisioned with models that reject the `on_complete` option (`glm-5.1`), and the running session caches agent configs at startup — editing the files mid-session has no effect until restart. The `opencode-subagent-completion-hook` plugin that normally strips `on_complete` and commits reports was also not loaded, so neither reviewer's report was auto-committed.
**Takeaway**: All agent models should be `opencode-go/deepseek-v4-flash` (the working model). If a reviewer subagent cannot launch due to an infrastructure error, do the review manually following the agent's rubric and commit it with `peck code-review commit` / `peck acceptance-review commit` (piped from stdin) — that is exactly what the `on_complete` hook runs. Verify the report was committed via `git log`; the commit subject is `review: <verdict>` / `review(acceptance): <verdict>`.

---

## Worktree OpenCode instances ignore the worktree's `.opencode/agents` — custom agents must be global
**Date**: 2026-09-21
**Area**: tooling | testing
**What happened**: A new OpenChamber worktree session failed immediately with `UnknownError at SessionPrompt.createUserMessage`. Reproduced via the OpenCode API: `POST /session/<id>/message` with `agent:"planner"` returned HTTP 500 in the worktree and HTTP 200 in the repo root. `GET /agent?directory=<worktree>` listed only built-in agents (`build`, `plan`, `explore`, …) — the worktree's own `.opencode/agents/*.md` (and its `opencode.jsonc` plugin/disable config) were not loaded, even though the files were present and identical to the root's. OpenCode only discovers project `.opencode` from the directory its server was started in.
**Takeaway**: Custom agents and the `opencode-subagent-completion-hook` plugin must live in the **global** OpenCode config (`~/.config/opencode/agents/*.md` and the global plugin list) for worktree sessions to use them; the worktree setup copies the repo's agents there. Instances already created keep the empty agent list cached, so a fix requires a fresh worktree (or an OpenCode restart). See `docs/openchamber-workflow.md`.

---

## Reviewer reports are empty commits — move them with `git cherry-pick --allow-empty`
**Date**: 2026-09-22
**Area**: workflow
**What happened**: The acceptance/code reviewers commit their verdicts as empty commits with the full report in the commit message body (`git show <sha> --format=%B -s`). When a report landed on the wrong branch (branch-switch incident, now in `agents.md` §Version Control), a plain `git cherry-pick <sha>` failed as empty until `--allow-empty` was added.
**Takeaway**: To relocate a reviewer report to the correct branch: `git cherry-pick --allow-empty <sha>`. Confirm a report commit is empty with `git show <sha> --name-only --format=""` (no files listed).

---

## Friend/UGC videos are detected by the `-response-NN` slug suffix, not the `{friendCode}` wildcard
**Date**: 2026-09-22
**Area**: architecture
**What happened**: `normalizeConfig` substitutes `{friendCode}` in place when a course loads (`config-normalizer.js`), so the recap planner only ever sees resolved slugs (`ab12-model-w-response-01`). Detecting "friend video" by the wildcard at plan time is impossible.
**Takeaway**: Classify friend vs system by the `-response-NN` suffix — the same rule `getVideoUrl` uses to route UGC to the `/videos/` namespace. It survives substitution (including the empty-friendCode case). The classifier lives in `src/modules/video/video-source.js` (`isFriendVideoSlug`/`remoteSource`).

---

## Course configs are fetched by courseId — guard tests must glob `src/config/*.json`
**Date**: 2026-09-22
**Area**: testing
**What happened**: `AppLayout.jsx` fetches `/src/config/${courseId}.json`, so any JSON in `src/config/` can be a live course. A config-invariant test that hardcoded `['model.json', 'friend.json']` would silently miss a future course config with friend slugs but no `recapSources: 'friend'` flag.
**Takeaway**: For config-invariant guards (e.g. "every friend-slug step lives in a `recapSources: 'friend'` lesson"), glob all `src/config/*.json` with `readdirSync` instead of hardcoding file names.
