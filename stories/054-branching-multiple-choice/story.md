# Add a `branching` step type with multiple-choice buttons that jump to a chosen step

## Context

Today every response step asks the learner to answer one prompt, and any lesson that wants to teach several ways to answer a question must play one long video covering all of them before the learner can respond. Courses need a fork: a question step that, after its clip finishes, offers a set of labelled buttons — each button jumps straight to the step that teaches and checks one particular answer.

This story adds a new `branching` response type that the app consumes from `src/config/*.json`. A branching step plays a `simpleVideoUrl` clip, then raises a water overlay whose bottom band contains a vertically stacked column of text buttons in the middle, with the usual Replay (left) and Watch Tutorial (right) corner buttons left in place. Choosing a button jumps the lesson to that option's target step. The branching step itself records nothing and is scored by nothing — it is pure navigation.

**Fork convergence needs one new field.** A linear `steps` array cannot make several alternative response steps all fall through into one shared continuation: only one step can be immediately before it, so with the current "advance by +1" rule, finishing choice 1 would fall into choice 2's step. To converge without contorting the config, this story adds an optional per-step **`nextStep`** offset that `loadNextStep` honors after a step completes (default `+1` when absent). Each alternative step points past its siblings at the shared continuation. This is resolved in the single `loadNextStep` function that every advance path already calls (friend auto-advance, the continue widget, `viewAndContinue`, and `LessonContainer`), so branching needs no special-case advance logic.

The Google Sheet columns and the `scripts/generate-config-from-sheet.mjs` support that would author `chooseStep`/`nextStep` are **separate, future work**; this story defines and implements the runtime contract the generator will eventually emit.

## Out of Scope

- No Google Sheet columns, no generator/translator changes, and no `src/config/*.json` edits — the app reads `chooseStep`/`nextStep` but no course ships one yet.
- No changes to recording, transcription, scoring, or the answer pipeline's feedback: a `branching` step produces no recording, no clip, and no score.
- No interactive-video branching — only `simpleVideoUrl`.
- No cap on the number of choices.
- No backward (`nextStep < 1`) navigation; offsets are forward-only, so a branch cannot loop.
- No native (`*.native.jsx`) counterpart; the repo treats unwired native files as reference.

## Implementation approach

### Config contract (consumed by the app)

A fork is a `branching` step whose `chooseStep` entries carry offsets, followed by the alternative steps, each carrying a `nextStep` that lands on the shared continuation:

```json
{ "responseType": "branching", "simpleVideoUrl": "do_you_like_nature",
  "chooseStep": [
    { "nextStep": 1, "text": { "en": "Yes, I like nature", "es": "Sí, me gusta la naturaleza" } },
    { "nextStep": 2, "text": { "en": "No, I don't like nature" } },
    { "nextStep": 3, "text": { "en": "I neither like nor dislike it" } }
  ] },
{ "responseType": "friendClosedResponse", "simpleVideoUrl": "say_yes",     "cue": { "en": "Yes, I like nature" }, "nextStep": 3 },
{ "responseType": "friendClosedResponse", "simpleVideoUrl": "say_no",      "cue": { "en": "No, I don't like nature" }, "nextStep": 2 },
{ "responseType": "friendClosedResponse", "simpleVideoUrl": "say_neither", "cue": { "en": "I neither like nor dislike it" }, "nextStep": 1 },
{ "responseType": "viewAndContinue", "simpleVideoUrl": "shared_next" }
```

- `chooseStep` (branching steps only) is optional. When present it is an array; **array order is button order** (top to bottom). Each entry has `nextStep` (a **1-based offset** from the branching step's own index: target index = `currentStepIndex + nextStep`, integer ≥ 1) and `text` (a localized object exactly like `cue`: `{en, es, pt, fr, hi, bn}`).
- `nextStep` (any step) is optional. After the step completes, the next index is `currentStepIndex + nextStep`; when absent, non-integer, or `< 1`, it defaults to `+1`. An index `>= lesson.steps.length` ends the lesson (next lesson or completion), exactly as advancing past the last step does today.
- `text` is left as an object by `normalizeConfig` (it only flattens `step`/`explanation`/`subtitles`), so it renders bilingually with `formatBilingualText`.

### Resolution rules (pure)

`resolveBranchChoices(step, currentStepIndex, stepCount)` returns `[{ text, targetIndex }]`, dropping any entry that:

- has a non-integer or `< 1` `nextStep` (`Number.isInteger`), or
- resolves to `targetIndex < 0 || targetIndex >= stepCount`, or
- has no `text`.

An absent / non-array `chooseStep` → `[]`. Entries are kept in array order.

`resolveNextStepIndex(step, currentStepIndex)` returns `currentStepIndex + offset`, where `offset` is `step.nextStep` when it is an integer ≥ 1 and `1` otherwise. It does **not** clamp to the lesson length; callers decide end-of-lesson.

### Label rules (pure)

`formatBranchChoiceLabel(text, lang)`:

- no localized value for `lang` → `{ english, localized: null, lang, showEnglish: true }` (English only).
- localized value exists and `english.length + localized.length <= BRANCH_LABEL_CHAR_CAP` (48) → both, stacked (English line then translation line).
- localized value exists and combined length `> 48` → translation only (`showEnglish: false`).

`BRANCH_LABEL_CHAR_CAP` is the single "translation only when space does not allow" knob.

### Phase flow

- A `branching` step with a clip loads in the existing `simpleVideo` phase (mic hidden, clip plays, mission visible). `resolveStepPhase` returns `simpleVideo`.
- When the clip ends — or fails to load — `SimpleVideoPlayer` transitions to the new phase `simpleVideo-decisionTime-branching` (`mediaState: 'decisionOverlay'`, `bottomState: 'branchChoices'`, `topState: 'topBarOnly'`, `showMission: true`). Its centered overlay text is the new `video_choose_how_respond` string.
- A `branching` step **without** a clip resolves straight to `simpleVideo-decisionTime-branching`.
- The bottom band renders `BranchChoiceButtons`: `ChoiceColumn` Replay (left), a `.branch-choice-col` vertical stack of text buttons (center, `flex: 2`), `ChoiceColumn` Watch Tutorial (right).
- Pressing a choice calls `jumpToStep(targetIndex)` in `lesson-progression`, which mirrors `loadNextStep` but **sets** `currentStepIndex = targetIndex` instead of advancing. `jumpToStep` is a no-op for a non-integer or out-of-range index.
- Once an alternative step is answered, the normal `loadNextStep` runs and honors that step's `nextStep`, landing on the shared continuation. No branching-specific advance code exists.
- If `resolveBranchChoices` returns `[]`, the center shows a Continue button that runs the normal `loadNextStep` (advance one step), so a mis-authored branching step cannot strand the learner.

### Wiring

`LessonContainer` computes `branchChoices` from the current step, `currentStepIndex`, and the lesson's step count, and passes `{ choices, onChoose, onContinue }` to `BranchChoiceButtons`. `onChoose` calls `jumpToStep` with the same `callLoadStep` / `loadLessonContent` deps that `onLoadNextLesson` already builds; `onContinue` reuses `onLoadNextLesson`.

### Single-source constants and helpers

`src/modules/lesson/branch-choice-logic.js` exports `BRANCH_RESPONSE_TYPE`, `BRANCH_OVERLAY_PHASE`, `BRANCH_OVERLAY_TEXT_KEY`, `BRANCH_LABEL_CHAR_CAP`, `isBranchingStep`, `resolveBranchChoices`, `resolveNextStepIndex`, `formatBranchChoiceLabel`. `store.js`, `step-phase-logic.js`, `SimpleVideoPlayer.web.jsx`, `BranchChoiceButtons.jsx`, `lesson-progression.js`, `lesson-routing.js`, and `step-executor-webonly.js` import these rather than repeating string literals or offset math.

## Tasks

### Task 1 - Pure branch-choice and step-navigation logic

Files: `src/modules/lesson/branch-choice-logic.js` (new), `src/modules/lesson/branch-choice-logic.test.js` (new).

- constants + `isBranchingStep`
  - → `BRANCH_RESPONSE_TYPE === 'branching'`
  - → `BRANCH_OVERLAY_PHASE === 'simpleVideo-decisionTime-branching'`
  - → `BRANCH_OVERLAY_TEXT_KEY === 'video_choose_how_respond'`
  - → `isBranchingStep({ responseType: 'branching' })` is true; `({ responseType: 'closedResponse' })` and `(null)` are false
- branching step at index 2 of a 6-step lesson with `chooseStep` offsets `[1, 2, 3]` and text + `resolveBranchChoices`
  - → returns 3 entries in array order with `targetIndex` 3, 4, 5
  - → each returned entry carries the original `text` object
- offsets `0`, `-1`, `1.5`, `'x'`, `null`, `undefined`, and a missing `nextStep`
  - → each such entry is dropped
- offset `4` at index 2 of a 6-step lesson (`targetIndex === stepCount`)
  - → dropped
- entry with no `text`
  - → dropped
- `chooseStep` absent, `{}`, or a string
  - → returns `[]`
- `resolveNextStepIndex` with `{ nextStep: 3 }` at `currentStepIndex` 3
  - → `6`
- `resolveNextStepIndex` with no `nextStep`, or `nextStep` of `0`, `-1`, `1.5`, `'x'`, `undefined`
  - → `currentStepIndex + 1` in every case
- `resolveNextStepIndex` with `{ nextStep: 1 }` at `currentStepIndex` 0
  - → `1`
- `resolveNextStepIndex` with `{ nextStep: 5 }` at `currentStepIndex` 6 (target beyond the lesson)
  - → `11` (the helper does not clamp; the caller treats `>= length` as end-of-lesson)
- `{ en: 'Yes', es: 'Sí' }` with lang `es` + `formatBranchChoiceLabel`
  - → `showEnglish` true, `english` `'Yes'`, `localized` `'Sí'`, `lang` `'es'`
- `{ en: 'Yes' }` with lang `es` (translation absent)
  - → `localized` null, `showEnglish` true
- `{ en: 'Yes', es: 'Sí' }` with lang `en`
  - → `localized` null, `showEnglish` true
- a label whose `english.length + localized.length` is exactly `BRANCH_LABEL_CHAR_CAP` vs one character more
  - → the first has `showEnglish` true; the second has `showEnglish` false and keeps `localized`

### Task 2 - Phase mapping and transition wiring

Files: `src/modules/store/store.js`, `src/modules/lesson/step-phase-logic.js`, `src/modules/lesson/step-phase-logic.test.js`.

- `appStore.getState().transitionTo(BRANCH_OVERLAY_PHASE, {}, { fromStepLoad: true })`
  - → `bottomState === 'branchChoices'`
  - → `mediaState === 'decisionOverlay'`
  - → `topState === 'topBarOnly'`
  - → `showMission === true`
- store source
  - → the `simpleVideo` entry in `answerFlowTransitions` includes `BRANCH_OVERLAY_PHASE` (the phase table itself is covered behaviorally by the `transitionTo` case above)
- `resolveStepPhase({ step: { responseType: 'branching', simpleVideoUrl: 'clip' } })`
  - → `'simpleVideo'`
- `resolveStepPhase({ step: { responseType: 'branching' } })`
  - → `BRANCH_OVERLAY_PHASE`
- `resolveStepPhase({ step: { responseType: 'branching', simpleVideoUrl: 'clip' }, isFirstResponseStep: true, isFriendLesson: false })`
  - → `'simpleVideo'` (a branching step never gets the `firstResponse` mode chooser)

### Task 3 - Simple-video overlay raises the branching UI

File: `src/components/SimpleVideoPlayer.web.jsx`; guard in `src/modules/lesson/branch-choice-wiring.test.js` (new).

- the file imports `isBranchingStep`, `BRANCH_OVERLAY_PHASE`, `BRANCH_OVERLAY_TEXT_KEY` from `../modules/lesson/branch-choice-logic.js`
  - → source guard asserts the import line
- `handleEnded` body (slice from `const handleEnded` to the next `const handle`)
  - → contains `isBranchingStep(cv)` and a `transitionTo(BRANCH_OVERLAY_PHASE`
  - → the branching check appears before the `viewAndContinue` check
- `handleError` body (slice from `const handleError` to the next `const handle`)
  - → contains `isBranchingStep(cv)` and `BRANCH_OVERLAY_PHASE`
- the overlay JSX render condition
  - → includes `appPhase === BRANCH_OVERLAY_PHASE`
- the `overlayTextKey` assignment
  - → maps `appPhase === BRANCH_OVERLAY_PHASE` to `BRANCH_OVERLAY_TEXT_KEY`

### Task 4 - BranchChoiceButtons component

Files: `src/components/widgets/BranchChoiceButtons.jsx` (new), `src/components/widgets/BranchChoiceButtons.test.jsx` (new).

- `choices` of `[{ text: { en: 'Yes', es: 'Sí' }, targetIndex: 3 }, { text: { en: 'No' }, targetIndex: 4 }]`
  - → renders `#branchChoiceBtn-0` and `#branchChoiceBtn-1`
  - → `#branchChoiceBtn-0` shows both `Yes` and `Sí`
  - → `#branchChoiceBtn-1` shows only `No`
  - → clicking `#branchChoiceBtn-0` calls `onChoose` with `3`
- any non-empty `choices`
  - → renders `#branchReplayBtn` and `#branchTutorialBtn`
  - → clicking `#branchReplayBtn` with a player present transitions `appPhase` to `'simpleVideo'` and calls `getCurrentVideoPlayer().replay`
  - → clicking `#branchReplayBtn` with no player present does nothing (no transition)
  - → clicking `#branchTutorialBtn` mounts the tutorial modal
- `choices === []`
  - → renders `#branchContinueBtn` and no `#branchChoiceBtn-*`
  - → clicking `#branchContinueBtn` calls `onContinue`
- a choice whose combined label length exceeds `BRANCH_LABEL_CHAR_CAP`
  - → its button renders no `.branch-choice-label-en` and shows the localized text

### Task 5 - Progression: jump, and the `nextStep` advance override

Files: `src/modules/lesson/lesson-progression.js`, `src/modules/lesson/lesson-routing.js`, `src/modules/lesson/step-executor-webonly.js`, `src/components/LessonContainer.jsx`, `src/modules/lesson/lesson-progression.test.js` (new), guard in `src/modules/lesson/branch-choice-wiring.test.js`.

- `loadNextStep` with the completed step `{ responseType: 'friendClosedResponse', nextStep: 3 }` at `currentStepIndex` 3 in an 8-step lesson
  - → sets `currentStepIndex` to 6
  - → calls `deps.callLoadStep` with `steps[6]` and the lesson
  - → sets `pendingVideoPlayType` from `steps[6]`
- `loadNextStep` with a completed step that has no `nextStep` at `currentStepIndex` 3
  - → sets `currentStepIndex` to 4 (existing behavior unchanged)
- `loadNextStep` with `{ nextStep: 5 }` at `currentStepIndex` 6 in an 8-step lesson
  - → does not call `deps.callLoadStep`
  - → ends the lesson (next-lesson navigation or completion message)
- `loadNextStep` with `{ nextStep: 0 }` or `{ nextStep: 1.5 }`
  - → advances by exactly 1
- `getNextStep` with store `currentStepIndex` 3 and `currentStep.nextStep` 3
  - → returns `steps[6]`
- `getNextStep` with no `nextStep`
  - → returns `steps[4]`
- `step-executor-webonly.js` source (the `onStepLoaded` prefetch)
  - → computes the prefetch index with `resolveNextStepIndex(` (not `currentStepIndex + 1`)
- `jumpToStep(5, deps)` with `currentStepIndex` 2 and an 8-step lesson whose `steps[5].simpleVideoUrl` is set
  - → sets `currentStepIndex` to 5
  - → calls `deps.callLoadStep` with `steps[5]` and the lesson
  - → sets `pendingVideoPlayType` to `'simple'`
- `jumpToStep(8, deps)` (`targetIndex === steps.length`) and `jumpToStep(-1, deps)`
  - → leaves `currentStepIndex` unchanged and does not call `deps.callLoadStep`
- `jumpToStep(7, deps)` (the last step)
  - → sets `currentStepIndex` to 7 and calls `deps.callLoadStep`
- LessonContainer source
  - → renders `<BranchChoiceButtons` under `bottomState === 'branchChoices'`
  - → passes `onChoose` and `onContinue`
  - → computes choices with `resolveBranchChoices(`

### Task 6 - StepLoader, heading string, CSS, normalizer preservation

Files: `src/components/StepLoader.jsx`, `src/data/strings.js`, `src/assets/css/app.css`, guard in `src/modules/lesson/branch-choice-wiring.test.js`.

- StepLoader source
  - → the `switch (step.responseType)` contains a `case 'branching':` (so it never falls through to `UnknownStepType`)
- `Strings.getBilingual('video_choose_how_respond', 'en')`
  - → `.english === 'Choose how you will respond.'`
- `Strings.getBilingual('video_choose_how_respond', 'es')`
  - → `.localized` is a non-empty string
- `app.css` (scoped guard)
  - → contains the `.branch-choice-row`, `.branch-choice-col`, and `.branch-choice-btn` rule blocks with their key properties
- `normalizeConfig` on a config containing a branching step with `chooseStep`
  - → leaves `step.chooseStep[0].text` as an object (not flattened to a string)

## Technical Context

- Phase machine: `src/modules/store/store.js` `phaseMapping` + `answerFlowTransitions`; `transitionTo(phase, data, { fromStepLoad })` resolves `{ topState, mediaState, bottomState, showMission }`. The `bottomState` value selects the component rendered in the bottom band in `src/components/LessonContainer.jsx:169-242`.
- Step-type resolution: `src/modules/lesson/step-phase-logic.js` `resolveStepPhase`; `simpleVideo` is the phase where a `simpleVideoUrl` clip plays with the mic hidden. `recordable-phases.js` lists phases that may enter recording — a branching phase is deliberately not added there.
- Simple-video end handling: `src/components/SimpleVideoPlayer.web.jsx` `handleEnded` / `handleError` (lines ~172-213) decide the post-clip phase; the water overlay JSX condition is at ~line 393 and `overlayTextKey` at ~line 43.
- Advance path (single hook): `src/modules/lesson/lesson-progression.js` `loadNextStep` increments `currentStepIndex` (`updateProgressBar` → `resetForNextStep` → `resetStepState` → `setState({ currentStepIndex })` → `callLoadStep` → `setPendingVideoPlayType`). Every caller passes the just-completed step: `answer-pipeline.js:930` (friend auto-advance), `:1015`/`:1058` (continue widget), `:1040` (viewAndContinue), and `LessonContainer.onLoadNextLesson` (lines ~101-112). The `nextStep` override goes here.
- Prefetch helpers that assume `+1` and should use `resolveNextStepIndex`: `lesson-routing.js` `getNextStep` (`storeIndex + 1`, used by `answer-pipeline.js:1026` to preload the next clip) and `step-executor-webonly.js` `onStepLoaded` (`state.currentStepIndex + 1`, lines ~128-137). Both are performance-only; correctness is owned by `loadNextStep`.
- Existing decision-row components to mirror: `src/components/widgets/ResponseDecisionButtons.jsx` (Replay / Answer / Tutorial with `ChoiceColumn` + `TutorialModal`) and `src/components/widgets/ViewAndContinueButtons.jsx`. `ChoiceColumn` renders `.ivp-choice-col` + bilingual label; `TutorialModal` takes `{ onClose }`.
- Bilingual labels: `formatBilingualText` in `src/modules/bilingual/bilingual-display.js` returns `{ english, localized, lang, shouldShowLocalized }` for `{en, es, …}` objects and already returns `shouldShowLocalized: false` for lang `en`, a missing translation, or an identical translation; `useNativeLanguage` (`src/hooks/use-native-language.js`) resolves the guest-first language.
- UI copy lives in `src/data/strings.js` (`getBilingual(key, lang)` returns `{ english, localized, lang }`); existing keys `video_replay`, `watch_tutorial` already cover the corner buttons. New heading translations to add: en `Choose how you will respond.`, es `Elige cómo vas a responder.`, pt `Escolha como você vai responder.`, fr `Choisissez comment vous allez répondre.`, hi `चुनें कि आप कैसे उत्तर देंगे।`, bn `আপনি কীভাবে উত্তর দেবেন তা বেছে নিন।`.
- Stylesheet is hand-written: `src/assets/css/app.css` (not Bootstrap). `.controls-section` is `display:flex; justify-content:space-around; align-items:flex-end`; `.ivp-choice-col` is `flex:1 1 0`.
- Tests: vitest + jsdom (`vitest.config.js`), component tests use `react-dom/client` + `act` directly (see `src/components/widgets/MicrophoneToggle.test.jsx`), source guards read files with `node:fs` (see `src/modules/lesson/step-phase-logic.test.js`, `src/components/intro-preload.test.js`).

## Notes

- **Why `nextStep` is not optional.** A `steps` array is linear; three alternative response steps cannot each be immediately before one shared continuation. Without the override the learner would finish choice 1 and be dropped into choice 2. The override is the minimal general fix and lives in the one function every advance path already funnels through.
- **Authoring stays relative on purpose.** Both `chooseStep[].nextStep` and the step-level `nextStep` are offsets, so the future sheet/generator work can emit `1, 2, 3, …` without computing absolute step indices. The cost is that inserting a step shifts offsets — acceptable for generated configs.
- **`BRANCH_LABEL_CHAR_CAP = 48` is a deliberate, tunable assumption.** It is the only "space does not allow" trigger; if real labels look cramped or the English disappears too eagerly, change this one constant and its test boundary.
- **No recap impact.** A branching step records nothing, so it yields no webcam segment and no published clip; skipped-over steps likewise produce nothing. The video processor and `RECAP_RESPONSE_BOUNDARY_TYPES` are intentionally untouched.
- **Friend lessons need no special logic** — the branching step is not a response step, so the friend-only paths (video-only mode, auto-advance, clip borrowing) never see it. Branch targets that are ordinary response steps behave exactly as they do today; the `nextStep` override applies to them uniformly.
- **Progress** advances once per step completion/jump via the existing `updateProgressBar`; skipped steps are not counted. Exact percentages are not a goal here.
- **Guard caution (AGENTS):** scope each source guard to the specific function/block (`indexOf(selector)` slices) and assert every property, so removing the wiring makes the guard fail rather than pass vacuously.
