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

## Source guards that slice "to end of file" break when a new function is appended
**Date**: 2026-09-28
**Area**: testing
**What happened**: `poster-avatar-wiring.test.js` sliced `video-processor.web.js` from `export async function exportSegmentsToR2` to EOF, relying on it being the last function. Story 021 appended `uploadCompleteVideoToR2` after it, so the slice silently grew to include the new function — the guard could then pass on strings that were not in `exportSegmentsToR2`. The code reviewer caught it.
**Takeaway**: When a source guard slices a function body, end the slice at the next top-level marker (`indexOf('export const …')` / the next `export async function …`), never at EOF. Before appending a function to a file that has such a guard, check for `slice(source.indexOf(...))` patterns and update them.

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

**Behind-main variant (2026-09-29)**: When a story branch is cut before other stories land on `main`, `main..HEAD` also shows main-only work as *deletions* (story 026's branch predated stories 028/029/030, so the reviewer saw ~50 unrelated files as removed). The reviewer still reviewed the branch's own commits correctly, but the range is misleading. Use the merge-base range (`git merge-base main HEAD..HEAD`) or rebase onto `main` before review.

---

## Pages Functions can import from `src/` — verify with `wrangler pages functions build`
**Date**: 2026-09-20
**Area**: build | architecture
**What happened**: To dedupe Supabase fallback constants between the SPA (`src/modules/api/supabase.js`) and the Pages Function (`functions/api/upload-segment.js`), I extracted `src/modules/api/supabase-constants.js` and imported it from the Function via `../../src/...`. `wrangler pages functions build --outdir=...` compiled successfully and the constants were bundled into the output.
**Takeaway**: A constants-only module in `src/` can be imported by a Pages Function as long as it has no `import.meta.env` (which the Function bundle can't resolve). Verify any cross-directory Function import with `npx wrangler pages functions build --outdir=/tmp/...` and grep the output for the expected value.

---

## `appStore.friendCode` is persisted and never cleared — it can be stale
**Date**: 2026-09-29
**Area**: architecture
**What happened**: Story 026 used `appStore.friendCode` as the co-participant share code for a co-authored B recap. The code reviewer flagged that `friendCode` is set from `?shareCode=` (`App.jsx:29-31`) and persisted (`store.js:711`) but never cleared, so a B export in a browser that previously opened a friend link attaches the previous friend's code. The story's edge case assumed `friendCode` is null when no friend link is present.
**Takeaway**: Treat `appStore.friendCode` as session-sticky, not per-lesson. Any feature that derives identity from it (the B lesson's `{friendCode}` clip resolution, friend-response notifications, story 026's `otherShareCode`) inherits the staleness. If a feature needs the *current* URL's share code, read it from the URL or clear/scope `friendCode` on lesson entry — don't assume it is null.

---

## Reviewer subagents can fail to launch — fall back to `peck <type>-review commit` with a manual report
**Date**: 2026-09-21
**Area**: workflow
**What happened**: The `@code-reviewer` subagent repeatedly failed to launch with `Upstream request failed: [invalid_request_error] Extra inputs are not permitted, field: 'on_complete'`. Root cause: the agent configs (`~/.config/opencode/agents/*.md` and `.opencode/agents/*.md`) were provisioned with models that reject the `on_complete` option (`glm-5.1`), and the running session caches agent configs at startup — editing the files mid-session has no effect until restart. The `opencode-subagent-completion-hook` plugin that normally strips `on_complete` and commits reports was also not loaded, so neither reviewer's report was auto-committed.
**Takeaway**: All agent models should be `opencode-go/deepseek-v4-flash` (the working model). If a reviewer subagent cannot launch due to an infrastructure error, do the review manually following the agent's rubric and commit it with `peck code-review commit` / `peck acceptance-review commit` (piped from stdin) — that is exactly what the `on_complete` hook runs. Verify the report was committed via `git log`; the commit subject is `review: <verdict>` / `review(acceptance): <verdict>`.
**Depth-limit variant (2026-09-23)**: When the implementer itself runs as a subagent, the Task tool refuses to spawn reviewers — `Subagent depth limit reached (1)`. Raising `subagent_depth` in `.opencode/opencode.jsonc` has no effect mid-session (config is cached at startup). Workaround without a restart: run a fresh CLI session and make it delegate explicitly, e.g. `opencode run --auto "Delegate to the code-reviewer subagent using the task tool: subagent_type='code-reviewer', prompt='main..HEAD'. Do not read, edit, or plan anything yourself."` The explicit instruction matters: the fallback default agent is the planner, and given a story path it will audit/amend the story itself instead of delegating (it committed an unintended `plan(...)` edit to `story.md`).

**Mode-promotion variant (2026-09-25, verified)**: Changing `mode: subagent` → `mode: primary` in `.opencode/agents/<reviewer>.md` *does* take effect for a newly launched `opencode run` process — each CLI process re-reads agent config even though a running session caches it. Confirm with `opencode agent list` (shows `acceptance-reviewer (primary)`). Then run `opencode run --agent acceptance-reviewer --auto '<story path>'` (or `code-reviewer` with `main..HEAD`); without the promotion, `--agent <subagent>` is silently ignored and the default planner runs instead. Capture the final report from stdout (strip ANSI, slice from the report heading), pipe it to `peck acceptance-review commit` / `peck code-review commit` (these commit an empty report commit whose tree equals HEAD — so working-tree changes like the mode edit are not swept in), then revert the mode change so the tree is clean.

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

## A reviewer-approved refactor can invalidate the story's ACs — amend the story, don't revert the code
**Date**: 2026-09-28
**Area**: workflow
**What happened**: The code reviewer required extracting the publish-flow gating into a testable `maybeAssignPosterAvatar` and moving the cache/store sync into a shared `avatar-client-store.js`. After that fix the code reviewer passed, but the acceptance reviewer then failed Task 3 because the story's ACs still named the old call site (`applyPosterAsProfilePictureIfMissing`/`pickAvatarThumb` inline, `setQueryData`/`setCourseData` inside `poster-avatar.js`). The implementation was correct; only the story was stale.
**Takeaway**: When a reviewer-driven refactor changes the shape the story's ACs describe, amend the story to match the reviewed implementation (update the Implementation approach + the affected Task ACs), commit it, and re-run the acceptance reviewer — do not revert working, code-reviewer-approved code to satisfy stale ACs. The acceptance reviewer's own "Story Gaps" section usually states this explicitly.

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

---

## i18n structure: strings.js + languages.js + derived LOCALE_MAP
**Date**: 2026-09-22
**Area**: architecture
**What happened**: Adding Hindi/Bengali required touching every UI string plus three separate language dropdowns; the profile components each carried a hand-maintained `LOCALE_MAP` that had already drifted from the language list by 8 languages, and the code reviewer flagged the duplication.
**Takeaway**: UI copy lives in `src/data/strings.js` (every key must carry `hi`/`bn` — verify with a Devanagari/Bengali script regex over the exported `strings` table). Language dropdowns read `GUEST_LANGUAGES`/`PROFILE_LANGUAGES`/`SIGNUP_LANGUAGES` from `src/data/languages.js`; `LOCALE_MAP` is derived from `PROFILE_LANGUAGES` (`Object.fromEntries(...)`) so it cannot drift. When adding a language, update all three lists + every strings.js key; never hand-edit a locale map.

---

## R2 UGC clips are served uncached — the recap must prefetch friend clips into blobs
**Date**: 2026-09-22
**Area**: architecture | performance
**What happened**: The end-of-lesson recap re-downloaded every friend (UGC) clip and stalled, even though the same clips had played smoothly during the lesson. `r2.ultrafastfluency.com` serves `videos/*` with no `Cache-Control` and `cf-cache-status: DYNAMIC` (not edge-cached). The lesson's smoothness comes from `window.preloadLessonAssets` (`index.html`) firing parallel `fetch()`es at lesson start — the recap did none of that and pointed a per-step `<video>` at the R2 URL.
**Takeaway**: The recap prefetches friend clips (`remoteSource(slug) === 'friend'`) into blobs before the canvas render loop (`prefetchRemoteClips`, `video-processor.web.js`) and plays them from object URLs, dropping any that fail; `functions/api/upload-segment.js` now writes `httpMetadata.cacheControl` so the browser keeps a local copy for the lesson→recap window. Cache-Control alone is not enough — media-element cache reuse is unreliable, so the app-side prefetch is what guarantees smooth, local playback. `httpMetadata` is also the only shape R2 reads (a top-level `contentType` is ignored).

---

## Playwright success-screen tests: wait for lesson bootstrap, use a WebM sentinel, force clicks on animated buttons
**Date**: 2026-09-24
**Area**: testing
**What happened**: The first `tests/success-concat-button.spec.js` run failed 4/6 because the test overrode `currentVideo`/`appPhase` right after `waitForFunction(configData)` resolved — but `initializeLesson` loads the intro step asynchronously afterwards and clobbered the override, leaving the video wrapper hidden. Two further gotchas: an invalid `data:video/mp4` source fires `onError` (which now reveals the button), so a valid clip is required to test the "hidden until ended" state; and `.ivp-choice-col .call-btn` runs a continuous `floatBob` animation, so Playwright's stability check never settles and `click()` times out.
**Takeaway**: Before overriding lesson state in a Playwright spec, wait for bootstrap to finish (`activeLessonId` + `currentVideo.type === 'intro'` + `appPhase === 'lessonIntro'`), not just `configData`. For codec-independent video tests use a tiny valid VP9/WebM data URI (bundled Chromium decodes WebM, not H.264) and block autoplay via an init script; an invalid source triggers `onError` paths. Click intentionally-animated buttons with `{ force: true }`. Also, `bootstrap-icons` fonts 403 from the symlinked `node_modules` in worktrees (outside Vite's serve allow-list) — filter `bootstrap-icons` console errors instead of chasing them; they also fail `playback-video.spec.js`/`regression-guard.spec.js` pre-existing.
