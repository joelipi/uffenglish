# Hide correction box when the user re-records

## Context

After a learner answers a voice step incorrectly, the app shows a "Try again" correction card (`#hint-hangman-card`, rendered by `src/components/widgets/Hints.jsx`) that displays the intended answer and a hangman-style diff of what the learner said. The pipeline then transitions back to `recording/answering` (`src/modules/answer/answer-pipeline.js:918`) so the learner can retry, which renders the microphone button.

Today the correction card stays on screen while the learner re-records. It is only cleared when the next answer is submitted (`answer-pipeline.js:704`), when a new response step loads (`src/modules/lesson/step-executor-webonly.js:208`), when feedback proceeds (`answer-pipeline.js:1002`), or when the learner taps the card's ✕ button. This means the learner can see the correction while speaking their retry, which the product does not want. The card should disappear as soon as the learner presses the microphone button to record again.

## Out of Scope

- Changing when the correction card first appears (still shown on an incorrect answer at `answer-pipeline.js:908`).
- Changing the card's content, styling, or the hangman diff algorithm.
- Changing the chat feedback bubbles (`GrammarDiffBubble`, `VocabDiffBubble`, `PragmaticsBubble`) or their persistence.
- Adding an auto-dismiss timer to the correction card.
- Changing the text-mode input path (`AnswerInput`) or the whisper review accept/reject buttons.

## Implementation approach

The correction card's visibility is driven by the Zustand store flag `hintsVisible` (`src/modules/store/store.js:326`, read in `Hints.jsx:7`). The microphone button's click handler is `handleClick` in `src/components/widgets/MicrophoneToggle.web.jsx:58`, which delegates to the callback registered via `getSpeechInputToggleCallback()`.

Decision: hide the card synchronously in the microphone click handler, before invoking the speech callback. This matches the requirement literally ("when the user presses the microphone button again, that correction box should no longer be visible") and is deterministic/testable. If microphone access subsequently fails, the card stays hidden and the existing media-error message (`step-executor-webonly.js:287-301`) is shown — the learner can still retry, and the card is not needed to attempt a retry.

Implementation:

1. In `MicrophoneToggle.web.jsx` `handleClick`, call `appStore.getState().setHintsVisible(false)` before `getSpeechInputToggleCallback()` is invoked. `appStore` is already imported in this file (line 3).
2. Do not change the callback-registration path or the speech orchestrator.

Edge cases:

- The mic button is only rendered when `bottomState` is `controlIcon` or `micActiveOrAnswerInput` (`MicrophoneToggle.web.jsx:85`). The correction card is shown together with `bottomState: 'micActiveOrAnswerInput'` after an incorrect answer (`phaseMapping['recording/answering']`, `store.js:37`), so the button is present whenever the card is.
- If `hintsVisible` is already `false` (no correction card), calling `setHintsVisible(false)` is a no-op — safe.
- The ✕ close button and the existing clear sites remain unchanged; this adds one more clear site.
- The text-mode toggle button (`#txtBtn`, `handleTextClick`) is out of scope and must not clear the card.
- Reappearance is preserved: the incorrect-answer branch (`answer-pipeline.js:888-921`) unconditionally calls `setHintsVisible(true)` (line 908) and regenerates `hangmanOps` from the new response (line 901) on every incorrect attempt, so a later different mistake re-shows the card. This branch is untouched by the change. Note the pre-existing gate `incorrectAttempts < 2` for `closedResponse` (line 888) — the card reappears only while that holds; `friendClosedResponse` always reappears. This gate is existing behavior and is not modified.

## Tasks

### Task 1 - Hide the correction card on microphone press

- correction card visible (`hintsVisible === true`) + user presses `#micBtn`
  - → `hintsVisible` becomes `false`
  - → the registered speech toggle callback is still invoked exactly once
- correction card not visible (`hintsVisible === false`) + user presses `#micBtn`
  - → `hintsVisible` remains `false`
  - → the registered speech toggle callback is still invoked exactly once
- correction card visible + user presses `#txtBtn` (text-mode toggle)
  - → `hintsVisible` is unchanged (still `true`)
- card hidden by a mic press + user submits another incorrect answer on the same step
  - → `hintsVisible` becomes `true` again
  - → `hangmanOps` reflects the new (different) user response, not the previous one

## Technical Context

- React 19.2.0, Zustand 5.0.13, Vitest 4.1.6, jsdom 29.1.1 — all already in `package.json`; no new dependencies.
- `MicrophoneToggle.web.jsx` is the web implementation; `MicrophoneToggle.js` re-exports it and `MicrophoneToggle.native.jsx` is a stub. Only the web file needs changing.
- Platform split is by file suffix: Vite resolves `.web.jsx` before `.jsx` (`vite.config.js:57`), and React Native's Metro bundler resolves `.native.jsx`. The change therefore lives only in the web file and cannot leak into a native build. `MicrophoneToggle.native.jsx` is a separate stub that already imports `appStore` (line 6) but does not yet implement the mic flow.
- Separation of concerns is preserved: calling store actions directly from a component is the established convention in this codebase, not a layering violation. `MicrophoneToggle.web.jsx` already calls `appStore.getState().setTextInputVisible/setMicActive/triggerPauseAllVideos` in `handleTextClick` (lines 68-80), and `DecisionButtons.jsx` (lines 35-45) and `IntroChoices.jsx` (lines 42-47) do the same. Adding `setHintsVisible(false)` follows the identical pattern.
- The store (`src/modules/store/store.js`) is platform-agnostic plain Zustand with no DOM dependencies, so `hintsVisible` and `setHintsVisible` are shared across web and native. No new platform-specific logic is introduced.
- `appStore` is a Zustand vanilla store (`createStore` + `persist`) exported from `src/modules/store/store.js`; components read it via `useStore(appStore, selector)` and mutate via `appStore.getState().<action>()`.
- `hintsVisible` is not declared in the store's initial state object (`store.js:69-192`), so it starts `undefined` (falsy). `Hints.jsx:12` treats falsy as hidden. Tests should set it explicitly.
- Existing test patterns: `src/modules/answer/answer-pipeline.test.js` uses `appStore.setState({...})` in `beforeEach` and asserts store state. `src/components/video-overlay-italic.test.js` asserts against source text. No existing test renders a React component, and `@testing-library/react` is **not** installed.
- Test approach for Task 1 (no new dependencies): create `src/components/widgets/MicrophoneToggle.test.jsx` and render the component with `react-dom/client` (`createRoot`) inside `React.act` (both available: `react-dom` 19.2.0, `React.act` is a function). Set `bottomState: 'micActiveOrAnswerInput'` and `hintsVisible: true` via `appStore.setState`, register a mock callback with `setSpeechInputToggleCallback(vi.fn())`, query `#micBtn`, dispatch a click, and assert `appStore.getState().hintsVisible === false` and the mock callback was called once. For the text-button case, query `#txtBtn` and assert `hintsVisible` is unchanged. Wrap state updates and clicks in `act` to flush React. Clean up the root in `afterEach`.
- Reappearance test approach: extend `src/modules/answer/answer-pipeline.test.js` using its existing `setupStore(friendStep)` harness. Call `pipeline.handleAnswer` with an incorrect response, assert `hintsVisible === true` and capture `hangmanOps`; then `appStore.setState({ hintsVisible: false })` (simulating the mic press), call `pipeline.handleAnswer` again with a *different* incorrect response, and assert `hintsVisible === true` and `hangmanOps` differs from the first capture. `friendClosedResponse` is used because it has no `incorrectAttempts < 2` gate.

## Notes

- The correction card is `#hint-hangman-card` in `Hints.jsx`; the store flag is `hintsVisible`. Do not confuse it with the chat correction bubbles (`GrammarDiffBubble`/`VocabDiffBubble`/`PragmaticsBubble`), which are out of scope.
- `setHintsVisible(false)` is already called at `answer-pipeline.js:704`, `answer-pipeline.js:1002`, and `step-executor-webonly.js:208`; this story adds the mic-press site only.
- No new strings, no localization changes.
- React Native migration: the behavior is implemented only in `MicrophoneToggle.web.jsx`. When the RN mic flow is implemented in `MicrophoneToggle.native.jsx`, it should also call `setHintsVisible(false)` on mic press to keep parity. This is a future task, not part of this story; the shared store flag makes it a one-line addition.
