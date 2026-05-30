# Chat Bubble System — Migration Plan

## Background

The current system has two parallel rendering paths. ~80% of messages travel the legacy path: `feedback-builder.js → feedback-renderer.web.js → HTML strings → addChatMessage({ type: 'htmlChunk' }) → dangerouslySetInnerHTML`. The React component tree is largely sidelined. This plan eliminates the HTML bridge entirely, making `feedback-builder.js` the single source of truth with structured data flowing directly into typed message objects rendered by dedicated components.

---

## Final Message Type Inventory

### Unchanged types
These are already clean structured types with no HTML string involvement. No changes required.

| Type | Role | Notes |
|---|---|---|
| `aiLoading` | system | Spinner during AI call |
| `continueWidget` | system | Incoming-call style answer button |
| `video` | user | Recorded video response |

### Revised types

**`standard`** (user and system) — gains two optional props for bilingual display:
```ts
// System variant
{
  role: 'system',
  type: 'standard',
  content: string,          // plain text, never HTML
  translation?: string,     // secondary language string
  translationLang?: string, // BCP-47 code e.g. "es"
  botName: string,
  avatarUrl: string,
}

// User variant
{
  role: 'user',
  type: 'standard',
  content: string,
  translation?: string,
  translationLang?: string,
  userName: string,
  userAvatarUrl: string,
}
```
Used for: cues (both step types), headsUp text, tutor chat messages. When `translation` and `translationLang` are present, both `SystemBubble` and `UserBubble` render the translation inline as `<span lang={translationLang}>` immediately after the primary content. No `dangerouslySetInnerHTML`.

**`praise`** — simplified to image-only; text praise moves to `standard`:
```ts
{
  role: 'system',
  type: 'praise',
  praiseData: { type: 'image', content: string },  // image src
  botName: string,
  avatarUrl: string,
}
```
Text praise (`praiseData.type === 'text'`) is emitted as a `standard` system bubble with `translation` and `translationLang` where present. `PraiseBubble` becomes single-purpose: one `<img>` branch, no string branch, no `dangerouslySetInnerHTML`.

**`grammarDiff`** — absorbs the grammar score line (no separate `stat` message for grammar):
```ts
{
  role: 'system',
  type: 'grammarDiff',
  score: number,
  errorCount: number,
  complexityScore: number,
  original: string,
  correction: string,
  // botName + avatarUrl resolved from sectionKey 'grammar' at render time
}
```
`GrammarDiffBubble` renders all three sub-elements within a single bubble: header, score line (`{score}% · {errorCount} error(s). {complexityScore}% complexity`), then the diff rows. The diff is rendered via JSX from a token array — see Phase 5 for the `diff-utils.js` refactor.

**`pragmatics`** — props renamed to reflect that values are plain text, not HTML; `message` dropped as it is always empty at source:
```ts
{
  role: 'system',
  type: 'pragmatics',
  header: string,      // the section label, plain text
  correction: string,  // AI-returned corrected sentence, plain text
  botName: string,
  avatarUrl: string,
}
```
The previous `contentHTML` / `correctionHTML` prop names were misleading — they were called "HTML" only because `createPragmaticsBubbleHTML()` template-literalled plain strings into an HTML wrapper. Both values are plain text at the source (`answers.js`). `PragmaticsBubble` renders them directly as `<div>{header}</div>` and `<div>{correction}</div>` — no `dangerouslySetInnerHTML`.

### New types

**`stat`** — replaces all `createStatsBubbleHTML` output and `fluencyBubble` htmlChunks:
```ts
{
  role: 'system',
  type: 'stat',
  sectionKey: 'fluency' | 'pronunciation' | 'flow' | 'vocabulary' | 'grammar' |
              'formality' | 'nativeLike' | 'understanding' | 'listening',
  score: number,            // raw score value
  isPerfect: boolean,       // true when 💯 should be shown instead of a numeric percentage
  isOverall: boolean,       // true for the fluency bubble (Joe Walsh, unshifted first)
  attemptLabel?: string,
  attemptCount?: number,
  parts: Array<
    | { display: 'inline' | 'block', label: string, value: string | number }
    | { display: 'block', type: 'idioms', count: number, items: string[] }
  >,
  // botName + avatarUrl resolved from sectionKey at render time — not stored in message
}
```
`StatsBubble` derives the display string from `isPerfect ? '💯' : \`${score}%\`` — no pre-rendered strings in the data layer. It always renders with the teal left border regardless of `sectionKey`, including for `isOverall: true`. The `sectionKey → { botName, avatarUrl }` mapping (currently buried in `renderFeedbackToHTML`) is extracted to a standalone lookup shared between the pipeline and the component.

`display` is always set by `feedback-builder.js` or the pipeline mapping — never by call sites ad-hoc. `StatsBubble` checks for `part.type === 'idioms'` and renders the list; all other parts fall through to the generic `label`/`value` path.

**`teacherFeedback`** — replaces `teacherHTML` htmlChunk (incorrect path):
```ts
{
  role: 'system',
  type: 'teacherFeedback',
  content: string,          // from Strings.get() × incorrectAttempts, plain text
  translation?: string,
  translationLang?: string,
  botName: string,
  avatarUrl: string,
}
```

**`possibleAnswer`** — replaces `possibleHTML` htmlChunk (incorrect path):
```ts
{
  role: 'system',
  type: 'possibleAnswer',
  label: string,            // from Strings.get() e.g. "A possible answer:"
  answer: string,           // stepData.possibleAnswer, plain text
  botName: string,
  avatarUrl: string,
}
```

---

## Eliminated Designs

These were considered during design and deliberately dropped:

| Considered | Reason dropped |
|---|---|
| `cue` message type | Cue is always a `standard` bubble — system for openResponse, user for closedResponse. Language resolved at construction time. |
| `CueBubble` component | Not needed; `SystemBubble` / `UserBubble` handle it via `translation` props. |
| `CorrectWrapperBubble` component | `correctWrapperHTML` bundled user identity + cue into one HTML row. Split into a `standard` user bubble (the cue) which provides user framing for free. |
| `ReactDOMServer.renderToString` | Existed only to produce HTML strings from `<BilingualText>` for injection. Deleted, not migrated. `BilingualText` returns to render-only JSX contexts. |
| Text praise as `praise` type | Text praise is visually identical to any other `standard` system bubble. Only the image variant warrants a dedicated type. |
| `headsUp` as a dedicated type | Renders identically to `standard` system bubble. No special component needed. |

---

## Revised ChatInterface Dispatch

```
chatHistory.map(msg)
  │
  ├── role: 'user'
  │     ├── type: 'video'         →  VideoBubble
  │     └── type: 'standard'      →  UserBubble (+ optional translation span)
  │
  └── role: 'system'
        ├── type: 'continueWidget'  →  ContinueWidgetBubble
        ├── type: 'stat'            →  StatsBubble        (sectionKey → bot identity)
        ├── type: 'grammarDiff'     →  GrammarDiffBubble  (score + diff in one bubble)
        ├── type: 'pragmatics'      →  PragmaticsBubble
        ├── type: 'praise'          →  PraiseBubble       (image only)
        ├── type: 'teacherFeedback' →  TeacherFeedbackBubble
        ├── type: 'possibleAnswer'  →  PossibleAnswerBubble
        ├── type: 'aiLoading'       →  AiLoadingBubble
        └── type: 'standard'        →  SystemBubble (+ optional translation span)

  (no htmlChunk branch)
```

---

## Migration Phases

### Phase 1 — Data Model Cleanup
**Risk: Low. No rendering changes.**

- Define a discriminated union type for `ChatMessage` — one interface per `type`, only the props each actually needs. The dispatch in `ChatInterface.jsx` becomes exhaustive and type-checked.
- Add optional `translation: string` and `translationLang: string` to the `standard` type definition in preparation for Phase 2. No rendering change yet.
- Remove `chatHeaderMode` from the store. It is written by `showChat()` but never read by `ChatHeader.jsx`.
- Remove `replaceLastMessage()` from production code, or relocate to test utilities where it is actually exercised.

---

### Phase 2 — Wire the Feedback Pipeline to Structured Types

The core migration. `feedback-builder.js` section objects flow directly into typed `addChatMessage` calls. `feedback-renderer.web.js` is bypassed completely by the end of this phase.

#### 2a — Extract the bot identity mapping

The `sectionKey → { botName, avatarUrl }` table currently lives inside `renderFeedbackToHTML()`. Extract it to a standalone shared lookup (a plain exported object). Both the pipeline (message construction) and `StatsBubble` (render-time resolution) will use it.

#### 2b — Migrate `addAIFeedbackMessages()`

Strip the dual-input logic:
- Remove the `typeof input === 'string'` branch entirely.
- Remove the object fallback to `htmlChunk`.
- Accept only typed section objects from `feedback-builder`.
- For each section, resolve `botName`/`avatarUrl` from the lookup extracted in 2a.
- Dispatch to the appropriate `addChatMessage` call per section type.

#### 2c — Migrate `handleCorrectFeedbackUI` (answer-pipeline.jsx ~lines 88–130)

| Was | Becomes |
|---|---|
| `correctWrapperHTML` (user avatar + cue + translation as one HTML row) | `standard` user bubble: `content` (resolved language string), `translation`, `translationLang`, `userName`, `userAvatarUrl` |
| `getPraiseHTML(praiseResult)` → `addChatMessage({ type: 'praise', content: htmlString })` | `addChatMessage({ type: 'praise', praiseData: praiseResult, botName, avatarUrl })` when `praiseResult.type === 'image'`; `standard` system bubble when `praiseResult.type === 'text'` |
| `explanation[i]` from `renderExplanationsToHTML` — grammar_diff chunk | `grammarDiff` typed message: `score`, `errorCount`, `complexityScore`, `original`, `correction` |
| `explanation[i]` from `renderExplanationsToHTML` — pragmatics chunk | `pragmatics` typed message: `header`, `correction`, `botName`, `avatarUrl` |
| `explanation[i]` from `renderExplanationsToHTML` — raw or message chunk | `standard` system bubble: `content` (chunk.content is already plain text from API responses), `botName`, `avatarUrl` |
| `fluencyBubble` (`allFeedbackHTML[0]`) | `stat` message with `isOverall: true`, `sectionKey: 'fluency'` from `feedback-builder` |
| `stepData.headsUp` | `standard` system bubble: `content`, `botName`, `avatarUrl` |

#### 2d — Migrate `handleIncorrectFeedbackUI` (answer-pipeline.jsx ~lines 132–247)

| Was | Becomes |
|---|---|
| `explanation` from `renderExplanationsToHTML` — grammar_diff chunk | `grammarDiff` typed message |
| `explanation` from `renderExplanationsToHTML` — pragmatics chunk | `pragmatics` typed message: `header`, `correction`, `botName`, `avatarUrl` |
| `explanation` from `renderExplanationsToHTML` — raw or message chunk | `standard` system bubble: `content` (plain text from API responses), `botName`, `avatarUrl` |
| `teacherHTML` (Strings.get() × incorrectAttempts + localized translation) | `teacherFeedback` typed message: `content`, `translation`, `translationLang`, `botName`, `avatarUrl` |
| `fluencyBubble` | `stat` with `isOverall: true` as above |
| `possibleHTML` (Strings.get() label + stepData.possibleAnswer) | `possibleAnswer` typed message: `label`, `answer`, `botName`, `avatarUrl` |
| `headsUpText` / `headsUpStr` | `standard` system bubble |

#### 2e — Migrate `handleAnswer` open/closed response paths (lines 565–594)

| Was | Becomes |
|---|---|
| `ReactDOMServer.renderToString(<BilingualText />)` + `<strong>` wrap + `htmlChunk` | **openResponse:** `standard` system bubble with `content` (resolved from `cue` by `userLang`), `translation`, `translationLang`, `botName`, `avatarUrl` |
| Same, closedResponse path | **closedResponse:** `standard` user bubble with same props, `userName`, `userAvatarUrl` |
| `immediateStatsHtmlArr` from `renderFeedbackToHTML` | `stat` typed messages via updated `addAIFeedbackMessages` |

`ReactDOMServer.renderToString` is deleted outright. Language string resolution from the `cue` bilingual object (`{ en, es }`) happens at message construction time using `userLang`.

#### 2f — Migrate `_renderPresent` in `step-loader-execute.js`

| Was | Becomes |
|---|---|
| `explanationHTML` from `renderExplanationsToHTML` → `addAIFeedbackMessages([strings])` | Structured explanation objects → updated `addAIFeedbackMessages` |

---

### Phase 3 — Delete the HTML Bridge

Once all callers in Phase 2 are migrated and verified:

- Delete `feedback-renderer.web.js` — all three exported functions (`renderFeedbackToHTML`, `renderExplanationsToHTML`, `getPraiseHTML`) are now dead code.
- Delete `feedback-renderer.js` (the three-line platform shim).
- The duplicate LCS diff implementation (`buildGrammarDiff`, lines 43–68) is deleted with the file. `diff-utils.js` remains as the single canonical diff implementation and will be refactored in Phase 5.

---

### Phase 4 — Remove `htmlChunk`

Once Phase 3 is complete, `htmlChunk` should have no remaining callers. Verify, then:

- Remove the `'htmlChunk'` branch from `ChatInterface.jsx`.
- Delete the `HtmlChunk` wrapper component.
- Remove `type: 'htmlChunk'` from the discriminated union.

---

### Phase 5 — Eliminate Remaining `dangerouslySetInnerHTML`

With the HTML pipeline gone, every remaining `dangerouslySetInnerHTML` in a bubble component is replaced with controlled JSX. There are no exceptions.

| Component | Current usage | Target |
|---|---|---|
| `UserBubble` | `content` as HTML string | Plain text + `<span lang>` for translation |
| `SystemBubble` | `content` as HTML string | Plain text + `<span lang>` for translation |
| `StatsBubble` | Concatenates `header + statsParts.join('. ')` | Controlled JSX: `isPerfect ? '💯' : \`${score}%\``, `parts` mapped to inline/block elements |
| `AiLoadingBubble` | `content` is always a plain text string | Plain text directly |
| `PragmaticsBubble` | `contentHTML` + `correctionHTML` via `dangerouslySetInnerHTML` | Props renamed to `header` + `correction`. Both are plain text at source (`answers.js`). Rendered as `<div>{header}</div>` and `<div>{correction}</div>` directly. |
| `PraiseBubble` | String branch uses `dangerouslySetInnerHTML` | String branch deleted entirely (text praise moves to `standard`). Image branch renders `<img src={praiseData.content}>` — no HTML involved. |
| `GrammarDiffBubble` | Uses `renderGrammarDiffHTML()` which produces an HTML string of `<span class="diff-del/ins">` markup | Refactor `diff-utils.js`: rename `renderGrammarDiffHTML()` to `computeGrammarDiff()`, return `DiffToken[]` instead of an HTML string. `GrammarDiffBubble` maps the token array to JSX spans directly. No `dangerouslySetInnerHTML`. |

The `computeGrammarDiff()` token array shape:
```ts
type DiffToken = {
  type: 'unchanged' | 'del' | 'ins',
  text: string,
}

// GrammarDiffBubble renders:
{tokens.map((token, i) =>
  token.type === 'unchanged'
    ? token.text
    : <span key={i} className={`diff-${token.type}`}>{token.text}</span>
)}
```
The LCS algorithm itself is unchanged — only the output format changes from an HTML string to a token array.

---

### Phase 6 — Store and Helper Cleanup

- `addAIFeedbackMessages()` in `chat-interface.js` is now a thin function: call `showChat(true)`, iterate typed section objects, call `addChatMessage`. Evaluate whether it belongs as a store action rather than a module-level side-effectful helper.
- `chatHeaderMode` is already removed (Phase 1). Simplify `showChat()` accordingly — it currently sets two store values but one was always ignored.
- Audit `chatModeActive` visibility logic in `LessonContainer.jsx` for any tightening now possible with a fully typed message model.

---

## New Components Required

| Component | Replaces |
|---|---|
| `TeacherFeedbackBubble` | `teacherHTML` htmlChunk |
| `PossibleAnswerBubble` | `possibleHTML` htmlChunk |

All other previously anticipated new components were eliminated during design.

---

## Files Deleted by End of Migration

| File | Reason |
|---|---|
| `js/components/feedback-renderer.web.js` | All three exports dead after Phase 2 |
| `js/components/feedback-renderer.js` | Platform shim with nothing left to shim |

## Files With Significant Reduction

| File | What is removed |
|---|---|
| `js/modules/answer-pipeline.jsx` | All inline HTML string construction in `handleCorrectFeedbackUI` and `handleIncorrectFeedbackUI`; `ReactDOMServer.renderToString` call |
| `js/components/chat/ChatInterface.jsx` | `htmlChunk` branch and `HtmlChunk` component |
| `js/components/chat/chat-interface.js` | Dual-input string/object logic in `addAIFeedbackMessages` |
| `js/components/chat/PraiseBubble.jsx` | String branch and `praiseData.type` switching logic |
| `js/modules/diff-utils.js` | `renderGrammarDiffHTML()` replaced by `computeGrammarDiff()` returning `DiffToken[]`; HTML string serialization removed |

---

## Per-Phase Testing

### Phase 1 — Data Model Cleanup
No rendering changes, so no visual verification needed. Coverage comes from existing store tests:
- Confirm `store.test.js` passes without modification — the discriminated union is additive and should not break existing message construction.
- Confirm `replaceLastMessage` tests still pass after relocation to test utilities.
- Grep for any reads of `chatHeaderMode` to confirm no live code depends on it before deleting.

### Phase 2 — Wire the Feedback Pipeline
Highest-risk phase. Each sub-step (2c, 2d, 2e, 2f) should be verified independently before moving to the next.

For each migrated caller, add a unit test that drives the function under test with a representative input and asserts on the resulting `chatHistory` array in the store — shape, order, and prop values. Do not assert on rendered HTML. Representative cases:

- `handleCorrectFeedbackUI`: assert `chatHistory` contains a `standard` user bubble (cue), a `praise` message with `praiseData.type === 'image'` or a `standard` system bubble for text praise, `stat` messages in section order, and no `htmlChunk` entries.
- `handleIncorrectFeedbackUI`: assert `grammarDiff` message contains `score`, `errorCount`, `complexityScore`, `original`, `correction`; assert `teacherFeedback` and `possibleAnswer` present with plain text props.
- `handleAnswer` open/closedResponse: assert cue appears as `standard` system bubble (open) or `standard` user bubble (closed); assert `translation` and `translationLang` props are set.

Run the Playwright smoke test on the `/course/model/lesson/x` path after all of Phase 2 is complete and before moving to Phase 3.

### Phase 3 — Delete the HTML Bridge
After deleting `feedback-renderer.web.js` and `feedback-renderer.js`:
- Confirm the build has no remaining imports of either file. A grep or the bundler's dead-code warnings are sufficient.
- Re-run the Playwright smoke test. If Phase 2 tests passed, Phase 3 should be silent — this is a deletion, not a behaviour change.

### Phase 4 — Remove `htmlChunk`
- Grep for `htmlChunk` across the codebase and confirm zero results before deleting the dispatch branch.
- Run existing `ChatInterface` render tests if present; otherwise a quick React Testing Library test asserting that an `htmlChunk` message in `chatHistory` throws or renders nothing (depending on how the exhaustive union is handled) is sufficient to confirm the branch is gone.

### Phase 5 — Eliminate `dangerouslySetInnerHTML`
Component-level. For each modified bubble component, add or update a React Testing Library test:
- `UserBubble` / `SystemBubble`: assert translation renders as `<span lang="es">` with correct text; assert no `dangerouslySetInnerHTML` attribute on any element.
- `StatsBubble`: assert score line renders `💯` when `isPerfect` is true and `85%` when false; assert idioms list renders as expected for a vocabulary section.
- `GrammarDiffBubble`: assert `diff-del` and `diff-ins` spans render correctly from a known `original`/`correction` pair without any raw HTML injection.
- `PragmaticsBubble`: assert `header` and `correction` render as plain text nodes.
- `PraiseBubble`: assert an image praise message renders an `<img>` with the correct `src`; assert no string branch exists.

### Phase 6 — Store and Helper Cleanup
- Re-run the full store test suite after any `addAIFeedbackMessages` restructuring.
- Run the Playwright smoke test as the final end-to-end gate across both `openResponse` and `closedResponse` step types.

---

## Ordering Note

Message ordering within the feedback sequence is determined entirely by the sequence of `addChatMessage` calls in the pipeline, not by any sort logic in the store or renderer. The correct order — stat bubbles by section (listening → vocabulary → grammar → formality → smoothness → understanding), then `teacherFeedback`, then overall fluency stat, then `continueWidget` — must be preserved explicitly in the migrated pipeline code.
