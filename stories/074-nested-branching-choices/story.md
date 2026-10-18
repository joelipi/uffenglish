# Nested (two-step) branching choices with per-level overlay text

## Context

Story 054 added the `branching` step: after its clip ends the learner sees one flat column of labelled buttons and each button jumps to a chosen step. Real conversations need a fork with a second question inside it — the learner first picks a coarse option ("Yes" / "No"), and *then* picks the exact answer that belongs to that option ("I love it" / "I like it a little"). Today that would require one branching step per coarse option and a way to jump between them, which is not expressible and not authorable.

This story lets a single `chooseStep` nest: an entry that carries its own `chooseStep` array is a **group** (the first row of buttons), and choosing it reveals its **children** (the second row). It also gives the overlay's instructional headline one string per level, so the first row reads "Choose how you will respond." and every deeper row reads "Now choose exactly what you want to say." — both localized in `src/data/strings.js`.

The recursive shape is deliberate: two steps are the natural use, but the resolver walks any depth, so no second feature is needed if a group ever nests again. All existing flat `chooseStep` configs keep rendering exactly as today (a single level).

## Out of Scope

- No `src/config/*.json` edits — the app reads nested `chooseStep`, but no course ships one yet.
- No Google Sheet columns, no generator/translator changes (separate future work, exactly as story 054 left the flat form).
- No changes to recording, transcription, scoring, or the answer pipeline: a `branching` step still records nothing and is scored by nothing.
- No interactive-video branching — only `simpleVideoUrl`.
- No backward (`nextStep < 1`) step navigation; the new Back button only moves between *choice levels* on the same step, it never changes `currentStepIndex`.
- No cap on nesting depth, and no native (`*.native.jsx`) counterpart.

## Implementation approach

### Config contract — recursive `chooseStep`

An entry with an **array** `chooseStep` is a group; an entry without one is a leaf carrying `nextStep`:

```json
{ "responseType": "branching", "simpleVideoUrl": "do_you_like_nature",
  "chooseStep": [
    { "text": { "en": "Yes", "es": "Sí" },
      "chooseStep": [
        { "nextStep": 1, "text": { "en": "I love it" } },
        { "nextStep": 2, "text": { "en": "I like it a little" } }
      ] },
    { "text": { "en": "No" },
      "chooseStep": [
        { "nextStep": 3, "text": { "en": "I don't like it" } }
      ] }
  ] }
```

- Leaf `nextStep` offsets stay **1-based and relative to the branching step's own index** (`targetIndex = currentStepIndex + nextStep`), at every depth.
- A group is kept only when it has `text` and **at least one valid descendant leaf**; a leaf is kept only when it has `text` and an integer `nextStep >= 1` resolving inside `[0, stepCount)`. Invalid entries are dropped recursively, so a group whose only children are invalid disappears entirely.
- An empty resolved top level keeps the existing `showContinue` fallback (a Continue button that advances one step) so a mis-authored step cannot strand the learner.
- A flat `chooseStep` of leaves renders exactly as story 054 did (one level, no Back button).

### Per-level overlay headline

The branching overlay headline is chosen by the current choice depth, not by the phase alone:

- depth `0` (the first row of buttons) → `video_choose_how_respond` ("Choose how you will respond."), the existing string.
- depth `>= 1` (any row after a group is chosen) → the new `video_choose_exactly` ("Now choose exactly what you want to say.").

Both keys are localized (`en/es/pt/fr/hi/bn`) in `src/data/strings.js`, so the headline is bilingual like the buttons.

### Pure module rules (`src/modules/lesson/branch-choice-logic.js`)

`resolveNode(entry, currentStepIndex, stepCount)` (not exported) resolves one entry to a node:
- not an object, or no `text` → `null`.
- `Array.isArray(entry.chooseStep)` → recurse over every child, keep the node only when at least one child resolves; node is `{ text, children }`.
- else → keep only when `nextStep` is an integer `>= 1` and `currentStepIndex + nextStep` is in `[0, stepCount)`; node is `{ text, targetIndex }`.

Exported:
- `resolveBranchNodes(step, currentStepIndex, stepCount)` → the resolved top-level nodes (array order preserved), `[]` when `chooseStep` is absent/non-array.
- `resolveBranchChoices(step, currentStepIndex, stepCount)` → **every leaf** reachable through the tree, depth-first in array order, as `{ text, targetIndex }`. Keeps its story-054 signature so `video-processor-logic.js` `branchParentIndexForResponse` still sees every target.
- `buildBranchChoiceView({ step, currentStepIndex, stepCount, lang })` → `{ choices, showContinue }`; each choice is `{ key, label, targetIndex }` (leaf) or `{ key, label, children }` (group), where `children` is the same shape recursively and `key` is the entry's index among its visible siblings. `showContinue` is `choices.length === 0`.
- `resolveBranchLevel(view, path)` → `{ choices, canGoBack, showContinue }`: walks `path` (an array of `key`s) through `children`; `canGoBack` is true only when the path actually descended; an absent/invalid path or an entry without `children` falls back to the root level rather than throwing; `showContinue` is the root's `showContinue` only at the root.
- `getBranchHeadingKey(depth)` → `BRANCH_DEEP_OVERLAY_TEXT_KEY` when `Number(depth) > 0`, else `BRANCH_OVERLAY_TEXT_KEY`.
- `BRANCH_DEEP_OVERLAY_TEXT_KEY === 'video_choose_exactly'`.

The English-vs-translation cap (`stepShowsEnglish`, `BRANCH_LABEL_CHAR_CAP`) is applied **per level**, across the sibling choices visible at that level (only one level is visible at a time), preserving the "every button in the visible column agrees" property.

### Wiring and separation of concerns

- `LessonContainer` owns the choice depth as React state (`branchPath`, an array of keys) and resets it to `[]` whenever `currentStepIndex` changes and when Replay is pressed (a fresh clip must start at the first row). It derives the visible level with `resolveBranchLevel(branchView, branchPath)` and passes `view` plus the handlers `onChoose` / `onChooseGroup` / `onBack` / `onReplay` / `onContinue` to `BranchChoiceButtons`; it also passes `branchDepth={branchPath.length}` to `SimpleVideoPlayer`. No offset math or tree walking happens in the container.
- `BranchChoiceButtons` stays presentational: it renders the pre-built `view`, calls `onChoose(targetIndex)` for a leaf, `onChooseGroup(key)` for a group, `onBack()` for the Back button, and keeps only the tutorial-modal visibility as local state. It imports no store, player, progression or logic module.
- `SimpleVideoPlayer` accepts a `branchDepth` prop (default `0`) and passes it to `getSimpleVideoOverlayTextKey(appPhase, currentVideo, branchDepth)`; the copy decision stays in the pure resolver.

## Tasks

### Task 1 - Pure recursive branch logic

Files: `src/modules/lesson/branch-choice-logic.js`, `src/modules/lesson/branch-choice-logic.test.js`.

- `BRANCH_DEEP_OVERLAY_TEXT_KEY` + `getBranchHeadingKey`
  - → `BRANCH_DEEP_OVERLAY_TEXT_KEY === 'video_choose_exactly'`
  - → `getBranchHeadingKey(0)` and `getBranchHeadingKey()` are `BRANCH_OVERLAY_TEXT_KEY`
  - → `getBranchHeadingKey(1)`, `(2)` are `BRANCH_DEEP_OVERLAY_TEXT_KEY`
- nested step (group offsets resolved from index 2 of a 6-step lesson) + `resolveBranchNodes`
  - → returns 2 top-level nodes, each with `children`
  - → the first node's `children[0].targetIndex` is `currentStepIndex + nextStep`
  - → each node carries the original `text` object
- `resolveBranchChoices` on the same nested step
  - → returns every reachable leaf in depth-first array order with their `targetIndex`
- `resolveBranchNodes`/`resolveBranchChoices` with a group whose every child is invalid (bad offsets, out of range, no text)
  - → that group is dropped entirely (not returned as a leaf)
- a leaf entry that is valid at the top level with no nested `chooseStep`
  - → returned as a leaf with `targetIndex` and no `children`
- `resolveBranchNodes` with a flat `chooseStep` of leaves
  - → returns those leaves unchanged (story-054 compatibility)
- `resolveBranchNodes` when `chooseStep` is absent, `{}`, or a string
  - → `[]`
- `buildBranchChoiceView` for a nested step with lang `es`
  - → `showContinue` false
  - → `choices[0]` is `{ key: 0, label, children: [...] }` (no `targetIndex`)
  - → `choices[0].children[1]` is `{ key: 1, label, targetIndex }` (no `children`)
  - → the English/translation cap is decided per level (a long label in one group does not strip English from a sibling level)
- `buildBranchChoiceView` for a step whose `chooseStep` yields no valid nodes
  - → `{ choices: [], showContinue: true }`
- `resolveBranchLevel`
  - → `resolveBranchLevel(view)` returns the root `choices` with `canGoBack` false
  - → `resolveBranchLevel(view, [0])` returns the first group's `children` with `canGoBack` true
  - → `resolveBranchLevel(view, [1, 0])` walks two levels
  - → an out-of-range path (`[9]`), a path into a leaf (`[choice0key]` where that choice has no `children`), or a non-array path falls back to the root with `canGoBack` false
  - → at the root, `showContinue` mirrors `view.showContinue`; when descended it is false
- module source (purity guard, unchanged from 054)
  - → contains no `from 'react'`, no `appStore`, no `document.`, and no `window.`

### Task 2 - Per-level overlay headline and player wiring

Files: `src/modules/video/response-decision-logic.js`, `src/modules/video/response-decision-logic.test.js`, `src/components/SimpleVideoPlayer.web.jsx`, `src/data/strings.js`, guard in `src/modules/lesson/branch-choice-wiring.test.js`.

- `getSimpleVideoOverlayTextKey(BRANCH_OVERLAY_PHASE, null)` (no third arg)
  - → `BRANCH_OVERLAY_TEXT_KEY` (story-054 behavior preserved)
- `getSimpleVideoOverlayTextKey(BRANCH_OVERLAY_PHASE, null, 1)`
  - → `BRANCH_DEEP_OVERLAY_TEXT_KEY`
- `getSimpleVideoOverlayTextKey('simpleVideo', null, 3)`
  - → `'video_continue'` (the branch depth is ignored outside the branch phase)
- `Strings.getBilingual('video_choose_exactly', 'en').english`
  - → `'Now choose exactly what you want to say.'`
  - → `.localized` is a non-empty string for `es`, `pt`, `fr`, `hi`, `bn`
- `SimpleVideoPlayer.web.jsx` source
  - → the component signature accepts `branchDepth`
  - → `overlayTextKey` is assigned from `getSimpleVideoOverlayTextKey(appPhase, currentVideo, branchDepth)`
- `LessonContainer.jsx` source
  - → renders `<SimpleVideoPlayer branchDepth={branchPath.length} />`

### Task 3 - Nested choice row: container state, Back button, styles

Files: `src/components/LessonContainer.jsx`, `src/components/widgets/BranchChoiceButtons.jsx`, `src/components/widgets/BranchChoiceButtons.test.jsx`, `src/assets/css/app.css`, guard in `src/modules/lesson/branch-choice-wiring.test.js`.

- LessonContainer source (separation guard)
  - → declares `branchPath` state and resets it on `currentStepIndex` change
  - → derives the visible level with `resolveBranchLevel(`
  - → passes `onChooseGroup` and `onBack` to `<BranchChoiceButtons`
  - → contains no offset math (`+ step.nextStep` / `+ nextStep`) and no `formatBranchChoiceLabel(`
- `BranchChoiceButtons` with a nested `view` whose first choice is a group (`children` present)
  - → clicking `#branchChoiceBtn-0` calls `onChooseGroup` with the group's `key` (and not `onChoose`)
- `BranchChoiceButtons` with a `view` whose choice is a leaf
  - → clicking `#branchChoiceBtn-0` calls `onChoose` with the leaf `targetIndex`
- `BranchChoiceButtons` with `view.canGoBack` true
  - → renders `#branchBackBtn`; clicking it calls `onBack`
- `BranchChoiceButtons` with `view.canGoBack` false/absent
  - → renders no `#branchBackBtn` (story-054 view shape keeps working)
- all existing story-054 component cases (bilingual labels, `showContinue`, replay, tutorial) still pass unchanged
- `Strings.getBilingual('branch_back', 'en').english`
  - → `'BACK'`; `.localized` non-empty for `es`, `pt`, `fr`, `hi`, `bn`
- component source (separation guard, extended)
  - → still imports none of `appStore`, `getCurrentVideoPlayer`, `jumpToStep`, `resolveBranchChoices`, `formatBranchChoiceLabel`, `branch-choice-logic`, `resolveBranchLevel`
  - → contains no `transitionTo(`
- `app.css` (scoped guard)
  - → contains a `.branch-choice-group-btn` block and a `.branch-choice-caret` block with their key properties

### Task 4 - Nested targets stay visible to the video processor

Files: `src/modules/video/video-processor-logic.test.js` (extend), guard in `src/modules/lesson/branch-choice-wiring.test.js`.

- `branchParentIndexForResponse`-style lookup where a branching step's nested leaves include `recIndex`
  - → resolves that branching step as the parent (the flattened `resolveBranchChoices` reaches nested leaves)
- `video-processor-logic.js` source
  - → still resolves branch targets via `resolveBranchChoices(` (no local offset math)

## Technical Context

- `src/modules/lesson/branch-choice-logic.js` — the pure module extended here; story 054 defines its existing exports and purity.
- `src/components/LessonContainer.jsx` — owns `currentStepIndex`, builds `branchView` (lines ~156-165) and renders `BranchChoiceButtons` under `bottomState === 'branchChoices'` (lines ~279-288) and `<SimpleVideoPlayer />` (line ~314).
- `src/components/widgets/BranchChoiceButtons.jsx` — the presentational row; props `{ view, onChoose, onReplay, onContinue }` today.
- `src/modules/video/response-decision-logic.js` `getSimpleVideoOverlayTextKey(appPhase, currentVideo)` — the single phase-to-copy decision; `src/components/SimpleVideoPlayer.web.jsx` renders its result as `overlayBilingual` (line ~52) inside `.ivp-overlay`.
- `src/modules/video/video-processor-logic.js` `branchParentIndexForResponse` (line ~176) calls `resolveBranchChoices(...).map(c => c.targetIndex)`; recursion in `resolveBranchChoices` keeps it correct with no change to that file.
- Strings: `src/data/strings.js` `getBilingual(key, lang)`; add `video_choose_exactly` and `branch_back` with all six languages, next to the existing `video_choose_how_respond`.
- `normalizeConfig` only flattens `step`/`explanation`/`subtitles`/`incues`, so nested `chooseStep[].text` objects are preserved.
- Styles: `src/assets/css/app.css` `.branch-choice-*` blocks (lines ~757-813) are hand-written; extend them.
- Tests: vitest + jsdom; component tests use `react-dom/client` + `act` (see `BranchChoiceButtons.test.jsx`); source guards read files with `node:fs` and slice the specific block.

## Notes

- **Back button is deliberate.** Without it a learner who taps the wrong group is stuck on that group's children; Back only pops the choice level (it never moves `currentStepIndex`), so it stays navigation within one step.
- **Heading text per level.** Level 0 reuses story 054's `video_choose_how_respond` ("Choose how you will respond."); deeper levels use the new `video_choose_exactly`. Both are ordinary `strings.js` copy, so rewording either is a one-key change.
- **Separation is a hard requirement.** Tree walking, offset math, target validation, label selection, level resolution and the heading-key choice live only in `branch-choice-logic.js` / `response-decision-logic.js`; the components render a pre-built view and dispatch on pure predicates.
- **Story-054 compatibility.** A flat `chooseStep` of leaves resolves to one level with no `children` and no Back button, and `getSimpleVideoOverlayTextKey(appPhase, currentVideo)` with no depth still returns the level-0 heading — existing configs and tests are unaffected.
- **Guard caution (AGENTS):** scope each source guard to the specific function/block and assert every property so removing the wiring fails the guard rather than passing vacuously.
