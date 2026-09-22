# Lesson recap flags — `recapOverlay` + `recapSources` replace `webcamOnly`

## Context

The end-of-lesson recap is one canvas recording composed of the user's own webcam clips plus optional `remote` (prompt) clips, and drawn with one overlay card. Both choices are currently made by a single lesson flag, `webcamOnly`, in `VideoRenderPlanner.generatePlan()`:

1. **Clip selection** — `if (needsRemote && !lesson?.webcamOnly)` gates every `remote` segment (`src/modules/video/video-processor-logic.js:106`). There is no way to say "include the friend's prompt clips but not the system prompts": the flag is all-or-nothing.
2. **Overlay** — `variant: tailingLesson?.webcamOnly ? 'shareCta' : 'fluency'` (`video-processor-logic.js:146-153`), which the web processor turns back into a boolean and `resolveOverlayElements` uses to pick the share CTA instead of the legacy CALCULATING FLUENCY / FLUENCY SCORE card (`video-processor-logic.js:53-66`, `video-processor.web.js:170`).

This produces two reported bugs in the friend challenge. First, the "Answer/Respond" lessons (`wa`/`wfa` in `src/config/model.json`, `b` in `src/config/friend.json`) use `friendClosedResponse` steps (ungraded — `src/modules/answer/answer-pipeline.js:885`) but have no `webcamOnly` flag, so they render the fluency card on an ungraded recap. Second, clip selection cannot express the desired friend-challenge composition: the friend's recorded prompts (identified by `{friendCode}` in the config, resolved to `-response-NN` slugs at runtime) must always be concatenated with the user's webcam clips, while the system/model prompt videos must never appear in those lessons — yet system prompts must keep appearing in the normal (non-friend) lessons.

This story introduces two orthogonal lesson-level flags and retires `webcamOnly` entirely:

- `recapOverlay` (`"fluency"` | `"shareCta"` | `"none"`, default `"fluency"`) — which overlay card renders.
- `recapSources` (`"system"` | `"friend"` | `"none"`, default `"system"`) — which prompt-video category is concatenated. The user's webcam clips are always included.

The caller-facing behaviour change is: friend-type lessons show the share CTA (not fluency) and concatenate webcam + friend prompts only; ask lessons show the share CTA and concatenate webcam only; normal lessons are unchanged.

## Out of Scope

- Changing the share CTA copy, the `example.com` placeholder, the 48h deadline, or any drawing code. `buildShareUrl`, `buildShareDeadline`, the `share_cta_*` strings, and the headline/tailing-card rendering are unchanged by this story.
- Changing the `-response-NN` naming convention itself. It is already load-bearing in `getVideoUrl` (`video-url.js:14-20`); this story reuses it as the friend/system classifier but does not alter how clips are keyed or uploaded.
- Mixing friend and system prompts in one lesson. `recapSources` is a single mutually-exclusive mode; a lesson that needs both is not supported.
- Implementing the overlay/native variants in `src/modules/video/video-processor.native.jsx`. It is a dead-code reference implementation (no importer, no RN dependency), never reads `step.variant`, and always renders the fluency card; only its header note is updated.
- Wiring `friend.json` into a course flow beyond the flag edits. It is already fetched by `courseId` (`src/routes/AppLayout.jsx:18`); no routing or seed changes.
- Rewriting the historical `webcamOnly` entry in `docs/learnings.md` (dated 2026-09-19). This story supersedes it, but that entry is a dated record and is not edited here.
- Adding `recapSources`/`recapOverlay` to any lesson other than the six friend-challenge lessons listed in the mapping table.

## Implementation approach

### 1. Flag semantics

Both flags are optional lesson-level strings with a pure resolver each (predicate, not prose):

```
RECAP_OVERLAYS = ["fluency", "shareCta", "none"]
RECAP_SOURCES  = ["system",  "friend",   "none"]

resolveRecapOverlay(lesson) = RECAP_OVERLAYS.includes(lesson?.recapOverlay) ? lesson.recapOverlay : "fluency"
resolveRecapSources(lesson) = RECAP_SOURCES.includes(lesson?.recapSources) ? lesson.recapSources : "system"
```

Unknown, empty, or non-string values resolve to the default, so every other course config (`gt2.json`, `t.json`, `test-api.json`) and every normal lesson keeps today's behaviour byte-for-byte.

### 2. Friend vs system classification

A `remote` prompt is a *friend video* iff its resolved target slug ends in `-response-NN` — the same rule `getVideoUrl` already uses to route to the `/videos/` UGC namespace. A friend prompt is still only a `remote` slice when it is the prompt of a step the user recorded; ask lessons (`w`/`wf`/`a`) have no friend prompts because no friend has answered yet.

- Add `src/modules/video/video-source.js` (pure, no browser globals, no URL construction):
  ```js
  export const FRIEND_VIDEO_REGEX = /-response-\d+$/i;
  export function isFriendVideoSlug(slug) {
      return typeof slug === 'string' && FRIEND_VIDEO_REGEX.test(slug);
  }
  export function remoteSource(slug) {
      return isFriendVideoSlug(slug) ? 'friend' : 'system';
  }
  ```
- Refactor `getVideoUrl` (`video-url.js:14-20`) to import `isFriendVideoSlug` and drop its duplicated inline regex, so the classifier has a single source of truth.

### 3. Config mapping (the only JSON changes)

`webcamOnly` is removed from every lesson in both files (it is fully replaced by `recapSources`).

| file | lesson | `recapSources` | `recapOverlay` | recap contains |
|---|---|---|---|---|
| `src/config/model.json` | `w` (Ask) | `"none"` | `"shareCta"` | webcam only |
| `src/config/model.json` | `wf` (Ask) | `"none"` | `"shareCta"` | webcam only |
| `src/config/model.json` | `wa` (Answer) | `"friend"` | `"shareCta"` | webcam + friend prompts |
| `src/config/model.json` | `wfa` (Answer) | `"friend"` | `"shareCta"` | webcam + friend prompts |
| `src/config/friend.json` | `a` (Ask) | `"none"` | `"shareCta"` | webcam only |
| `src/config/friend.json` | `b` (Respond) | `"friend"` | `"shareCta"` | webcam + friend prompts |
| every other lesson | — | absent (`"system"`) | absent (`"fluency"`) | unchanged |

### 4. `src/modules/video/video-processor-logic.js` (stays platform-agnostic)

- Import `remoteSource` from `./video-source.js`.
- Add and export `resolveRecapOverlay(lesson)` and `resolveRecapSources(lesson)` (the resolver predicates above), plus the canonical `RECAP_OVERLAYS`/`RECAP_SOURCES` lists so config tests share them.
- `generatePlan()` remote gate becomes category-aware and no longer reads `webcamOnly`:
  ```js
  const sources = resolveRecapSources(lesson);          // 'system' default (lesson may be null)
  if (needsRemote) {
      const remoteUrl = this._getRemoteTarget(rec);
      if (remoteUrl && remoteSource(remoteUrl) === sources) {
          plan.push({ type: 'remote', targetId: remoteUrl, subtitle: this._getStepCue(rec), isFirst: plan.length === 0 });
      }
  }
  ```
  `needsRemote` (retry dedupe) is unchanged. Consequence: with `recapSources: "friend"`, **every** friend prompt on a recorded step is concatenated regardless of any other lesson flag, and no system prompt is ever included; with `"none"`, no remote prompt is included; with `"system"` (or no flag), system prompts interleave exactly as today.
- Tailing step: `variant: resolveRecapOverlay(tailingLesson)` (the `tailingLesson` lookup and the empty-recordings → `null` → `"fluency"` default are unchanged). `durationMs`, `fluencyData`, and `shareCode` are unchanged.
- `resolveOverlayElements` takes the variant instead of the flag:
  ```js
  export function resolveOverlayElements({ variant = 'fluency', hasShareCta = false, isFirst = false, tailing = false } = {}) {
      if (variant === 'shareCta') {
          return { fluencyCard: false, headlineBlock: hasShareCta, tailingCard: hasShareCta && tailing };
      }
      if (variant === 'none') {
          return { fluencyCard: false, headlineBlock: false, tailingCard: false };
      }
      return { fluencyCard: !!isFirst || !!tailing, headlineBlock: false, tailingCard: false };
  }
  ```
- Add and export `isShareCtaEnabled(variant, shareCode) => variant === 'shareCta' && !!shareCode`, preserving today's rule that a `shareCta` recap with no `shareCode` renders nothing (no fluency fallback).

### 5. `src/modules/video/video-processor.web.js` wiring

- In `process()` replace `const webcamOnly = tailingStep?.variant === 'shareCta';` with:
  ```js
  const overlayVariant = tailingStep?.variant || 'fluency';
  const shareCta = isShareCtaEnabled(overlayVariant, shareCode) ? { /* unchanged object */ } : null;
  ```
  The CTA object (`share_cta_headline`, `share_cta_deadline`, `buildShareDeadline(Date.now(), userLang)`, `buildShareUrl(shareCode)`) is unchanged.
- Add `isShareCtaEnabled` to the `video-processor-logic.js` import list (`:9`).
- Rename the `executeRenderLoop` options-bag field `webcamOnly` to `overlayVariant` (`:309` definition, `:237` call) with default `'fluency'`.
- Rename `drawTextOverlay`'s trailing `webcamOnly` parameter to `overlayVariant` (`:647` definition, `:510-515` call) and call `resolveOverlayElements({ variant: overlayVariant, hasShareCta: !!shareCta, isFirst, tailing })` (`:652-657`). The `fluencyCard` / `headlineBlock` / `tailingCard` drawing blocks are untouched.
- `renderStepToBlob` (`:956-1001`) keeps passing `{ silent: true }` only → default `overlayVariant = 'fluency'`, `isFirst = false`, no tailing step → no overlay on friend-facing R2 clips, exactly as today.

### 6. Edge cases

- `recapSources: "friend"` but no friend prompts recorded (e.g. an ask lesson misconfigured): the recap is webcam-only — no error, no fallback to system prompts.
- `recapSources: "none"`: no prompt video on any segment, regardless of step config.
- A `recapSources: "friend"` lesson that also carries a stale `webcamOnly: true` (or any other unrecognised flag): friend prompts are still concatenated — the lesson-level `recapSources` mode is authoritative.
- Retry recordings (same `originalStepIndex`): `needsRemote` still dedupes the prompt, so a friend's question is concatenated once before the retried answers.
- Empty recordings: no lesson resolves → tailing variant `"fluency"` (unchanged).
- Unknown/empty/non-string `recapSources` → `"system"`; unknown/empty/non-string `recapOverlay` → `"fluency"`.
- `recapOverlay: "shareCta"` + no `shareCode` (guest / logged-out): `shareCta` is `null` → all-false → bare tail, no fluency fallback.
- `recapOverlay: "none"`: no card on any segment, regardless of `shareCode`.

## Tasks

### Task 1 - Add `recapSources` + `recapOverlay`, remove `webcamOnly`, in both config files

- `src/config/model.json` parsed + lessons `w`, `wf` inspected
  - → `recapSources === 'none'` and `recapOverlay === 'shareCta'` on each
- `src/config/model.json` parsed + lessons `wa`, `wfa` inspected
  - → `recapSources === 'friend'` and `recapOverlay === 'shareCta'` on each
- `src/config/model.json` parsed + every other lesson inspected
  - → `recapSources` and `recapOverlay` are `undefined` on all of them
- `src/config/friend.json` parsed + lesson `a` inspected
  - → `recapSources === 'none'` and `recapOverlay === 'shareCta'`
- `src/config/friend.json` parsed + lesson `b` inspected
  - → `recapSources === 'friend'` and `recapOverlay === 'shareCta'`
- Both config files parsed + every lesson inspected for `webcamOnly`
  - → `webcamOnly` is `undefined` on every lesson of both files
- Both config files parsed + every `recapSources` / `recapOverlay` value collected
  - → each `recapSources` value is one of `'system' | 'friend' | 'none'`
  - → each `recapOverlay` value is one of `'fluency' | 'shareCta' | 'none'`

### Task 2 - Friend/system classifier (`video-source.js`, `video-url.test.js`)

- `isFriendVideoSlug` called with `'abc123-model-w-response-01'`, `'zzz9-model-wf-response-02'`
  - → `true` for each (friend/UGC slugs after `{friendCode}` substitution)
- `isFriendVideoSlug` called with `'testvideo02'`, `'do_you_have_rolls_too'`, `'response'`, `''`, `null`, `undefined`, `42`
  - → `false` for each (no false positive on `-response` without a trailing number)
- `remoteSource` called with a `-response-NN` slug / a teacher slug / `null`
  - → `'friend'` / `'system'` / `'system'` respectively
- `getVideoUrl('abc123-model-w-response-01')` and `getVideoUrl('testvideo02')` called
  - → UGC slug routes to the `/videos/` namespace; teacher slug routes to `assets/videos/` (existing `video-url.test.js` cases still pass)

### Task 3 - Planner clip selection by `recapSources` (`video-processor-logic.test.js`)

- `resolveRecapSources` called with `{ recapSources: 'system' }`, `{ recapSources: 'friend' }`, `{ recapSources: 'none' }`
  - → returns the same value each time
- `resolveRecapSources` called with `{}`, `null`, `undefined`, `{ recapSources: 'bogus' }`, `{ recapSources: '' }`, `{ recapSources: true }`
  - → returns `'system'` for each
- Planner built with a lesson `{ recapSources: 'system' }` (steps carrying system `interactiveVideoUrl`) + 3 recordings matching its `lessonId` + `generatePlan()`
  - → a `remote` step precedes each first-attempt `webcam` step (interleaving preserved)
- Planner built with a lesson `{ recapSources: 'friend' }` and steps whose `interactiveVideoUrl` values are `-response-NN` slugs + 3 recordings
  - → every emitted `remote` step's `targetId` is a friend/UGC slug; one precedes each first-attempt `webcam` step
- Planner built with a lesson `{ recapSources: 'friend' }` whose steps mix one friend `-response-NN` prompt and one system prompt, with recordings on both
  - → the friend prompt appears as a `remote` step
  - → the system prompt does **not** appear (never system in a friend lesson)
- Planner built with a lesson `{ recapSources: 'none' }` whose recorded steps carry prompt URLs + recordings
  - → zero `remote` steps
- Planner built with a lesson `{ recapSources: 'friend', webcamOnly: true }` and friend `-response-NN` prompts on the recorded steps
  - → friend `remote` steps are still emitted (any friend video concatenates regardless of other flags)
- Two recordings sharing one `originalStepIndex` (retry) + `{ recapSources: 'friend' }` config
  - → exactly one `remote` step for the pair (existing dedupe locked), followed by both `webcam` steps
- Empty recordings array + any config
  - → plan is exactly `[tailing]` with `variant === 'fluency'`
- `src/modules/video/video-processor-logic.js` read as source text
  - → contains no `window`/`document`/`navigator` reference and no URL scheme (existing platform-agnostic guard still passes)

### Task 4 - Planner overlay variant + decision table (`video-processor-logic.test.js`, `video-processor-share-cta.test.js`)

- `resolveRecapOverlay` called with `{ recapOverlay: 'shareCta' }`, `{ recapOverlay: 'none' }`, `{ recapOverlay: 'fluency' }`
  - → returns the same value each time
- `resolveRecapOverlay` called with `{}`, `null`, `undefined`, `{ recapOverlay: 'bogus' }`, `{ recapOverlay: '' }`, `{ recapOverlay: true }`
  - → returns `'fluency'` for each
- Planner built with a lesson `{ recapOverlay: 'shareCta' }` + recordings + `generatePlan()`
  - → tailing `variant === 'shareCta'` with `durationMs === 4000` and `fluencyData` equal to the constructor arg
- Planner built with a lesson `{ recapOverlay: 'none' }` / with no `recapOverlay`
  - → tailing `variant === 'none'` / `'fluency'` respectively
- Planner built with a lesson `{ webcamOnly: true }` and no `recapOverlay` + recordings
  - → tailing `variant === 'fluency'` (overlay no longer follows `webcamOnly`)
- Constructor called with 4 args (no `shareCode`) + a `recapOverlay: 'shareCta'` lesson
  - → tailing `shareCode` is `null`
- `resolveOverlayElements` called with each row of the §4 decision table
  - → `{ variant: 'fluency', isFirst: true }` / `{ variant: 'fluency', tailing: true }` → `fluencyCard` true
  - → `{ variant: 'fluency' }` and `{}` (defaults) → all three false
  - → `{ variant: 'bogus', isFirst: true }` → `fluencyCard` true (unknown variant falls through to fluency)
  - → `{ variant: 'shareCta', hasShareCta: true, isFirst: true }` → `{ false, true, false }`
  - → `{ variant: 'shareCta', hasShareCta: true, tailing: true }` → `{ false, true, true }`
  - → `{ variant: 'shareCta', hasShareCta: false, isFirst: true }` and `{ ..., tailing: true }` → all three false (no fluency fallback)
  - → `{ variant: 'none', hasShareCta: true, isFirst: true }` and `{ ..., tailing: true }` → all three false
- `resolveOverlayElements` called with the removed key, e.g. `{ webcamOnly: true, isFirst: true }`
  - → `fluencyCard` true (the flag is ignored — decoupling locked)
- `isShareCtaEnabled` called with `('shareCta', 'ab12')`, `('shareCta', '')`, `('shareCta', null)`, `('fluency', 'ab12')`, `('none', 'ab12')`
  - → `true`, `false`, `false`, `false`, `false` respectively

### Task 5 - Web wiring pass-through (`video-processor.web.js`)

- `video-processor.web.js` read as source text
  - → no longer references the identifier `webcamOnly` (it reads the resolved `overlayVariant`)
  - → imports and uses `isShareCtaEnabled` for the `shareCta` gate
  - → passes `overlayVariant` (not `webcamOnly`) through the `executeRenderLoop` options bag and into `drawTextOverlay` → `resolveOverlayElements`
- `renderStepToBlob` source inspected
  - → still passes only `{ silent: true }` to `executeRenderLoop` (friend-facing R2 clips remain overlay-free)

## Technical Context

- No new dependencies. Unit tests use the existing vitest 4.1.6 + jsdom 29.1.1 setup; test files are colocated `*.test.js` (`vitest.config.js` excludes `tests/**` and `*.spec.js`, which are Playwright).
- `src/modules/video/video-source.js` is a new pure module (no browser globals, no URL construction) imported by both `video-url.js` and `video-processor-logic.js`, so the friend/system regex has one definition. `video-url.js` is imported widely (`answer-pipeline.js`, `step-executor-webonly.js`, `video-loader.web.js`, `video-processor.web.js`, hooks/components), so the refactor must keep `getVideoUrl`'s behaviour identical — `video-url.test.js` already covers UGC vs teacher routing.
- `video-processor-logic.js` must stay platform-agnostic; the existing source-guard test (`video-processor-logic.test.js:120-141`) asserts no `window`/`document`/`navigator` and no URL scheme in that file, and the new helpers must not introduce either.
- `src/config/model.test.js` asserts only per-lesson step sequences and `wf` step fields; lesson-level flags do not affect it, so it needs no changes.
- `src/modules/video/model-config.test.js` currently asserts `webcamOnly` is set on exactly `w`/`wf`. That assertion must be replaced with: no lesson in `model.json` has `webcamOnly`, plus the `recapSources`/`recapOverlay` matrix; add the same matrix for `friend.json`.
- `friend.json` is fetched by `AppLayout.jsx:18` as `/src/config/${courseId}.json` when `courseId === 'friend'`, so the flags are live there.
- `src/modules/video/video-processor.native.jsx` never reads `step.variant` (only `step.type === 'tailing'`), so the new `"none"` variant cannot break it; update only its header comment (lines 6-12) to name `recapOverlay`/`recapSources` instead of `webcamOnly`/`shareCta`.
- `{friendCode}` is substituted in place by `normalizeConfig` (`config-normalizer.js:5-11,42`) when the course loads, so the planner only ever sees resolved slugs (`abc123-model-w-response-01`). The `-response-NN` suffix survives substitution (including the empty-`friendCode` case, which yields `model-w-response-01`).

## Notes

**Manual verification (canvas pixels cannot be unit-tested in jsdom; the decision logic is covered by Tasks 2-4):**

1. `npm run dev`.
2. Ask recap (CTA + webcam only): open `/course/model/lesson/wf`, complete the steps, set a `shareCode`/language, Generate → no CALCULATING FLUENCY anywhere; only the user's clips (no system prompts); headline block top 25%; tailing CTA card with URL.
3. Answer recap (fix): open `/course/model/lesson/wfa` (or `wa` with a `?sharecode=` friend code) → the friend's question clips ARE interleaved before each answer; NO system prompt clips; NO CALCULATING FLUENCY / FLUENCY SCORE; the share CTA renders instead.
4. Friend config: open `/course/friend/lesson/b` with a `?sharecode=` friend code → same as step 3; `/course/friend/lesson/a` → webcam-only CTA recap.
5. Normal-lesson regression: `/course/model/lesson/g` → unchanged: system prompts interleaved, CALCULATING FLUENCY on the first segment, FLUENCY SCORE tailing card.
6. Missing `shareCode` on a `shareCta` lesson (guest): bare tail — no headline, no tailing card, no fluency fallback.

**Working-tree caveat (do not sweep silently):** `src/config/friend.json` already has an uncommitted edit removing `"webcamOnly": true` from lesson `b`. This story intentionally removes `webcamOnly` from the remaining lessons and adds the two new flags, so the final staged diff for `friend.json` should show only the intended flag edits (including that removal) — review it with `git diff` before staging.

**Review checklist (non-automatable / structural):**

- `webcamOnly` no longer appears in either config file, in `video-processor-logic.js`, or in `video-processor.web.js`.
- `remoteSource` is the single classifier for friend vs system; `video-url.js` no longer duplicates the `-response-NN` regex.
- `isShareCtaEnabled` keeps the "`shareCta` with no `shareCode` renders nothing" rule — no fluency fallback.
- Existing comments and `console.log` statements are preserved per `agents.md`.
- Native header comment updated to name `recapOverlay`/`recapSources`.
