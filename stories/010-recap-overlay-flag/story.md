# `recapOverlay` flag — decouple the recap overlay from `webcamOnly`

## Context

The end-of-lesson recap is one canvas recording whose overlay card is currently chosen by a single lesson flag that also chooses the clips. `VideoRenderPlanner.generatePlan()` reads `lesson.webcamOnly` for two unrelated jobs: (1) whether `remote` (model prompt) segments are pushed into the recap (`src/modules/video/video-processor-logic.js:106`), and (2) which card the tailing step carries — `variant: tailingLesson?.webcamOnly ? 'shareCta' : 'fluency'` (`video-processor-logic.js:146-153`). The web processor turns that variant back into a boolean and `resolveOverlayElements` uses it to pick the share-CTA overlay instead of the legacy CALCULATING FLUENCY / FLUENCY SCORE card (`video-processor-logic.js:53-66`, `video-processor.web.js:170`).

Because the overlay is derived from the clip-selection flag, any lesson that is not `webcamOnly` gets the fluency card, even when the lesson is ungraded. That is the reported bug: the "Answer/Respond" friend-challenge lessons (`wa`/`wfa` in `src/config/model.json`, `b` in `src/config/friend.json`) use `friendClosedResponse` steps — which skip scoring and feedback (`src/modules/answer/answer-pipeline.js:885`) — yet they contain no `webcamOnly` flag, so their recap renders CALCULATING FLUENCY and FLUENCY SCORE. They need the share CTA instead, while keeping the friend's question clips (`remote` steps) in the recap. A clip-selection boolean cannot express that combination.

This story adds a lesson-level `recapOverlay` string flag that alone decides the overlay, and reduces `webcamOnly` to its clip-selection job. `recapOverlay` is orthogonal to `webcamOnly` and (unlike it) can express "no overlay".

## Out of Scope

- Changing clip selection. `webcamOnly` keeps gating the `remote` push (`video-processor-logic.js:106`) exactly as today; the ask lessons (`w`, `wf`, `a`) stay `webcamOnly: true`.
- Changing the share CTA copy, the `example.com` placeholder, the 48h deadline, or any drawing code. `buildShareUrl`, `buildShareDeadline`, the `share_cta_*` strings, and the headline/tailing-card rendering are unchanged.
- Using the new `"none"` value on any lesson. It is supported and tested, but no lesson config adopts it in this story.
- Implementing the overlay variants in `src/modules/video/video-processor.native.jsx`. It is a dead-code reference implementation (no importer, no RN dependency), never reads `step.variant`, and always renders the fluency card; its header note is updated to match the new contract.
- The pre-existing working-tree removal of `"webcamOnly": true` from `friend.json` lesson `b`. That edit is retained as-is (it is correct under the new model: `b` must keep the friend's `remote` question clips in its recap).
- Wiring `friend.json` into a course flow beyond adding the flag. It is already fetched by `courseId` (`src/routes/AppLayout.jsx:18`); no routing or seed changes.

## Implementation approach

### 1. Flag semantics and config mapping

Add an optional lesson-level string `recapOverlay`. It is one of `"fluency"`, `"shareCta"`, or `"none"`. Resolution rule (predicate, not prose):

```
resolveRecapOverlay(lesson) = lesson?.recapOverlay ∈ {"fluency", "shareCta", "none"}
    ? lesson.recapOverlay
    : "fluency"
```

Absent, empty, or unrecognized values resolve to `"fluency"`, so every other course config (`gt2.json`, `t.json`, `test-api.json`) and every non-friend lesson keeps today's behaviour byte-for-byte.

Config edits (the only JSON changes):

| file | lesson | `webcamOnly` | `recapOverlay` | rationale |
|---|---|---|---|---|
| `src/config/model.json` | `w` (Ask) | `true` (unchanged) | `"shareCta"` | asker recap = webcam-only share ad |
| `src/config/model.json` | `wf` (Ask) | `true` (unchanged) | `"shareCta"` | same |
| `src/config/model.json` | `wa` (Answer) | absent (unchanged) | `"shareCta"` | friend's recap keeps question clips but shows the CTA, not fluency |
| `src/config/model.json` | `wfa` (Answer) | absent (unchanged) | `"shareCta"` | same |
| `src/config/friend.json` | `a` (Ask) | `true` (unchanged) | `"shareCta"` | same as `w` |
| `src/config/friend.json` | `b` (Respond) | absent (retain working-tree state) | `"shareCta"` | same as `wa` |

No other lesson in any config file gains `recapOverlay` or `webcamOnly`.

### 2. `src/modules/video/video-processor-logic.js` (stays platform-agnostic)

- Add an internal `RECAP_OVERLAYS = ['fluency', 'shareCta', 'none']` constant and export `resolveRecapOverlay(lesson)` implementing the predicate above.
- `generatePlan()` tailing step: replace `variant: tailingLesson?.webcamOnly ? 'shareCta' : 'fluency'` with `variant: resolveRecapOverlay(tailingLesson)`. The `tailingLesson` lookup (`:146`) and the empty-recordings → `null` → `"fluency"` default are unchanged. `durationMs`, `fluencyData`, and `shareCode` are unchanged.
- The `remote` gate (`:106`) is untouched — `webcamOnly` remains here only.
- Change `resolveOverlayElements` to take the variant instead of the flag:

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

  Decision table (the else branch covers `'fluency'`, unknown values, and the default):

  | variant | hasShareCta | isFirst | tailing | → fluencyCard | headlineBlock | tailingCard |
  |---|---|---|---|---|---|---|
  | fluency (or unknown/default) | – | true | false | true | false | false |
  | fluency (or unknown/default) | – | – | true | true | false | false |
  | fluency (or unknown/default) | – | – | – | false | false | false |
  | shareCta | true | true | false | false | true | false |
  | shareCta | true | – | true | false | true | true |
  | shareCta | false | any | any | false | false | false |
  | none | any | any | any | false | false | false |

- Add and export a pure gate for the CTA object: `isShareCtaEnabled(variant, shareCode) => variant === 'shareCta' && !!shareCode`. This preserves today's rule that a `shareCta` recap with no `shareCode` renders nothing (no fluency fallback).

### 3. `src/modules/video/video-processor.web.js` wiring

- In `process()` replace:
  ```js
  const webcamOnly = tailingStep?.variant === 'shareCta';
  ```
  with:
  ```js
  const overlayVariant = tailingStep?.variant || 'fluency';
  const shareCta = isShareCtaEnabled(overlayVariant, shareCode) ? { /* unchanged object */ } : null;
  ```
  The CTA object (`share_cta_headline`, `share_cta_deadline`, `buildShareDeadline(Date.now(), userLang)`, `buildShareUrl(shareCode)`) is unchanged.
- Add `isShareCtaEnabled` to the `video-processor-logic.js` import list (`:9`), which already imports `VideoRenderPlanner`, `resolveOverlayElements`, etc.
- Rename the `executeRenderLoop` options bag field `webcamOnly` to `overlayVariant` (`:309` definition, `:237` call) with default `'fluency'`.
- Rename `drawTextOverlay`'s trailing `webcamOnly` parameter to `overlayVariant` (`:647` definition, `:510-515` call) and pass it to `resolveOverlayElements({ variant: overlayVariant, hasShareCta: !!shareCta, isFirst, tailing })` (`:652-657`). The `fluencyCard` / `headlineBlock` / `tailingCard` drawing blocks are untouched.
- `renderStepToBlob` (`:956-1001`) keeps passing `{ silent: true }` only → default `overlayVariant = 'fluency'`, `isFirst = false`, no tailing step → no overlay on friend-facing R2 clips, exactly as today.

### 4. Edge cases

- `recapOverlay: "shareCta"` + no `shareCode` (guest / logged-out): `shareCta` is `null` → `resolveOverlayElements` returns all-false → bare tail, no fluency fallback (unchanged from today's `webcamOnly` behaviour).
- `recapOverlay: "none"`: no card on any segment, regardless of `shareCode`.
- `webcamOnly: true` with no `recapOverlay`: fluency card (proves the flags are independent).
- `recapOverlay: "shareCta"` with no `webcamOnly`: `remote` clips are interleaved into the recap (the `wa`/`wfa`/`b` case) and the CTA renders.
- Empty recordings: no lesson resolves → tailing variant `"fluency"` (unchanged).
- Unknown `recapOverlay` value or non-string: resolves to `"fluency"`.

## Tasks

### Task 1 - Add `recapOverlay` to `model.json` and `friend.json`

- `src/config/model.json` parsed + lessons `w`, `wa`, `wf`, `wfa` inspected
  - → each has `recapOverlay === 'shareCta'`
- `src/config/model.json` parsed + every other lesson inspected
  - → `recapOverlay` is `undefined` on all of them
- `src/config/model.json` parsed + lessons carrying `webcamOnly` inspected
  - → exactly `['w', 'wf']` (unchanged)
- `src/config/friend.json` parsed + lessons `a` and `b` inspected
  - → both have `recapOverlay === 'shareCta'`
- `src/config/friend.json` parsed + lessons carrying `webcamOnly` inspected
  - → exactly `['a']` (lesson `b` has no `webcamOnly`)
- Both config files parsed + every `recapOverlay` value collected
  - → every value is one of `'fluency' | 'shareCta' | 'none'`

### Task 2 - Planner decoupling (`video-processor-logic.test.js`)

- `resolveRecapOverlay` called with `{ recapOverlay: 'shareCta' }`, `{ recapOverlay: 'none' }`, `{ recapOverlay: 'fluency' }`
  - → returns the same value each time
- `resolveRecapOverlay` called with `{}`, `{ recapOverlay: undefined }`, `null`, `undefined`
  - → returns `'fluency'` for each
- `resolveRecapOverlay` called with `{ recapOverlay: 'bogus' }`, `{ recapOverlay: '' }`, `{ recapOverlay: true }`, `{ recapOverlay: 0 }`
  - → returns `'fluency'` for each
- `VideoRenderPlanner` built with a lesson config `{ webcamOnly: true }` (no `recapOverlay`, steps carrying `interactiveVideoUrl`) + 3 recordings matching its `lessonId` + `generatePlan()` called
  - → zero `remote` steps
  - → tailing `variant === 'fluency'` (overlay no longer follows `webcamOnly`)
- Planner built with a lesson config `{ recapOverlay: 'shareCta' }` (no `webcamOnly`, steps carrying `interactiveVideoUrl`) + 3 recordings + `generatePlan()`
  - → a `remote` step precedes each first-attempt `webcam` step (interleaving preserved)
  - → tailing `variant === 'shareCta'`
- Planner built with a lesson config `{ recapOverlay: 'none' }` + recordings
  - → tailing `variant === 'none'`
- Planner built with an unset `recapOverlay` + recordings
  - → tailing `variant === 'fluency'`
- Two recordings sharing `originalStepIndex` (retry) + `{ webcamOnly: true }` config
  - → zero `remote` steps (existing dedupe behaviour preserved)
- Empty recordings array + `generatePlan()`
  - → plan is exactly `[tailing]` with `variant === 'fluency'`
- Constructor called with 4 args (no `shareCode`), lesson with `recapOverlay: 'shareCta'`
  - → tailing `shareCode` is `null`; `durationMs === 4000`; `fluencyData` equals the constructor arg
- `src/modules/video/video-processor-logic.js` read as source text
  - → contains no `window`/`document`/`navigator` reference and no URL scheme (existing platform-agnostic guard still passes)

### Task 3 - Overlay decision table and CTA gate (`video-processor-share-cta.test.js`)

- `resolveOverlayElements` called with each row of the §2 decision table
  - → returns the matching `{ fluencyCard, headlineBlock, tailingCard }`
  - → `{ variant: 'fluency', isFirst: true }` and `{ variant: 'fluency', tailing: true }` → `fluencyCard` true
  - → `{ variant: 'fluency' }` and `{}` (defaults) → all three false
  - → `{ variant: 'shareCta', hasShareCta: true, isFirst: true }` → `{ false, true, false }`
  - → `{ variant: 'shareCta', hasShareCta: true, tailing: true }` → `{ false, true, true }`
  - → `{ variant: 'shareCta', hasShareCta: false, isFirst: true }` and `{ variant: 'shareCta', hasShareCta: false, tailing: true }` → all three false (no fluency fallback)
  - → `{ variant: 'none', hasShareCta: true, isFirst: true }` and `{ variant: 'none', hasShareCta: true, tailing: true }` → all three false
  - → `{ variant: 'bogus', isFirst: true }` → `{ true, false, false }` (unknown defaults to fluency)
- `resolveOverlayElements` called with the removed `webcamOnly` key, e.g. `{ webcamOnly: true, isFirst: true }`
  - → `fluencyCard` true (the flag is ignored — decoupling locked)
- `isShareCtaEnabled` called with `('shareCta', 'ab12')`, `('shareCta', '')`, `('shareCta', null)`, `('fluency', 'ab12')`, `('none', 'ab12')`
  - → `true`, `false`, `false`, `false`, `false` respectively

### Task 4 - Web wiring pass-through (`video-processor.web.js`)

- `video-processor.web.js` read as source text
  - → no longer references the identifier `webcamOnly` (it now reads the resolved `overlayVariant`)
  - → imports and uses `isShareCtaEnabled` for the `shareCta` gate
  - → passes `overlayVariant` (not `webcamOnly`) through the `executeRenderLoop` options bag and into `drawTextOverlay` → `resolveOverlayElements`
- `renderStepToBlob` source inspected
  - → still passes only `{ silent: true }` to `executeRenderLoop` (friend-facing R2 clips remain overlay-free)

## Technical Context

- No new dependencies. Unit tests use the existing vitest 4.1.6 + jsdom 29.1.1 setup; test files are colocated `*.test.js` (`vitest.config.js` excludes `tests/**` and `*.spec.js`, which are Playwright).
- `video-processor-logic.js` is the platform-agnostic layer and is the only module the overlay decision tables live in; keep the drawing in `video-processor.web.js` (see `docs/learnings.md` §"`video-processor.native.jsx` is an unwired placeholder"). Both the planner and the overlay table are already unit-tested with plain imports (no DOM), so the new tests follow the same pattern.
- The existing source-guard in `video-processor-logic.test.js:120-141` asserts no browser globals and no URL scheme; the new helpers must not introduce either.
- `src/config/model.test.js` asserts only per-lesson step sequences and `wf` step fields; lesson-level flags like `recapOverlay`/`webcamOnly` do not affect it, so it needs no changes.
- `src/modules/video/model-config.test.js` already asserts `webcamOnly` is set on exactly `w`/`wf`; that assertion stays true. Extend it (or add a colocated sibling) for the `recapOverlay` matrix across both config files.
- `friend.json` is fetched by `AppLayout.jsx:18` as `/src/config/${courseId}.json` when `courseId === 'friend'`, so the flag is live there.
- `src/modules/video/video-processor.native.jsx` never reads `step.variant` (only `step.type === 'tailing'`), so the new `"none"` variant cannot break it; update only its header comment (lines 6-12) to say the overlay is now `recapOverlay`-driven.

## Notes

**Manual verification (canvas pixels cannot be unit-tested in jsdom; the decision logic is covered by Tasks 2-3):**

1. `npm run dev`.
2. Ask recap (CTA preserved): open `/course/model/lesson/wf`, complete the steps, ensure a `shareCode` and language are set, Generate → no CALCULATING FLUENCY anywhere; webcam-only clips; headline block top 25%; tailing CTA card with URL.
3. Answer recap (regression fixed): open `/course/model/lesson/wfa` (or `wa` with a `?sharecode=` friend code) → the friend's question clips ARE interleaved; NO CALCULATING FLUENCY / FLUENCY SCORE card; the share CTA renders instead.
4. Unflagged lesson (regression): `/course/model/lesson/g` → unchanged: remote prompts interleaved, CALCULATING FLUENCY on the first segment, FLUENCY SCORE tailing card.
5. Missing `shareCode` on a `shareCta` lesson (guest): bare tail — no headline, no tailing card, no fluency fallback.

**Working-tree caveat (do not sweep silently):** `src/config/friend.json` currently has an uncommitted edit removing `"webcamOnly": true` from lesson `b`. This story retains that state, so staging `friend.json` will include that removal. Confirm the staged diff contains only the `recapOverlay` additions plus that known removal.

**Review checklist (non-automatable / structural):**

- `webcamOnly` appears in `video-processor-logic.js` only in the `remote` gate (`:106`); it no longer appears in `generatePlan`'s tailing step or in `resolveOverlayElements`.
- `isShareCtaEnabled` keeps the "`shareCta` with no `shareCode` renders nothing" rule — no fluency fallback.
- Existing comments and `console.log` statements are preserved per `agents.md`.
- Native header comment updated to name `recapOverlay` instead of `webcamOnly`.
