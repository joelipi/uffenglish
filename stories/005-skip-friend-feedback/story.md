# Skip feedback step on correct friendClosedResponse answers

## Context

`friendClosedResponse` steps are the "answer your friend's question" steps in the friend-challenge lessons (`wf`/`wfa` in `src/config/model.json`). Each is preceded by a `viewAndContinue` step that already auto-advances (`showFeedbackAndProceed` calls `onContinue()` directly for `viewAndContinue` + `simpleVideoUrl`, `src/modules/answer/answer-pipeline.js:1025-1027`). But when the learner answers a `friendClosedResponse` correctly, the pipeline still runs the standard feedback step: `handleAnswer` transitions to the `feedback` phase, `handleCorrectFeedbackUI` posts a praise message and plays the correct sound, and `showFeedbackAndProceed` mounts a continue widget the user must click to advance.

The `friendClosedResponse`-specific behavior that was implemented (commit `c5a5822` "Unlimited retries on friendClosedResponse") only covers: skipping scoring (`answer-pipeline.js:809`, `:885-886`), unlimited retries on incorrect answers via the hangman retry (`:888`), and suppressing point deductions on speech errors (`step-executor-webonly.js:233,315,328,340,357`). The correct-answer path was never changed to skip feedback, so the feedback step still appears — the intended "answer correctly → flow straight into the next step" UX is missing.

## Out of Scope

- No changes to `closedResponse` or `openResponse` feedback behavior — those keep the praise message + continue widget.
- No changes to the `friendClosedResponse` incorrect-answer hangman retry path.
- No changes to config, strings, store phases, or UI components.
- No changes to the `viewAndContinue` auto-advance behavior.

## Implementation approach

Code change in `src/modules/answer/answer-pipeline.js` `handleAnswer()`, plus unit tests in `src/modules/answer/answer-pipeline.test.js`.

Insert an early auto-advance branch between the incorrect-retry block (ends `:921`) and the `openResponse`/`closedResponse` feedback block (`:923`):

```js
// friendClosedResponse: on a correct answer, auto-advance to the next step
// without the feedback step (no praise message, no continue widget).
if (stepData.responseType === "friendClosedResponse" && isCorrect) {
    if (stepData.interactiveVideoUrl) {
        appStore.getState().setStepCount(appStore.getState().stepCount + 1);
    }
    if (_deps.loadNextStep) {
        _deps.loadNextStep(stepData);
        return;
    }
    // Fall through to the standard feedback path if progression deps are missing.
}
```

Rules and decisions:

- `_deps.loadNextStep` is the exact function the continue widget's `onContinue` invokes when `isCorrect` (`:1001-1002`). Calling it directly reproduces the full progression — progress bar update, `step_completed` tracking, `resetForNextStep`, `currentStepIndex` increment, next-step load via `callLoadStep`, and next-video preload (`lesson-progression.js:40-74`) — without any feedback UI.
- The `stepCount` increment mirrors `showFeedbackAndProceed` (`:984-987`) so the `lesson_complete` tracking event (`step-loader-logic.js:115`) stays consistent for interactive-video steps (all `friendClosedResponse` steps carry `interactiveVideoUrl`).
- `loadNextStep` → `callLoadStep` → `loadStep` calls `clearChat()` and `resetUIForNewStep` (`step-executor-webonly.js:103,111`), so no stale feedback renders and the phase transitions to the next step's phase.
- Guard `if (_deps.loadNextStep)`: if progression deps are absent (e.g. a direct `handleAnswer` call without `_deps`), fall through to the existing feedback path rather than silently doing nothing. `showFeedbackAndProceed` already guards the same way (`:1001`).
- The branch is keyed on `responseType === "friendClosedResponse" && isCorrect`, so `closedResponse`/`openResponse` and the `friendClosedResponse` incorrect path are untouched.

## Tasks

### Task 1 — Auto-advance on correct friendClosedResponse answers

- `friendClosedResponse` step (plain-string cue, `interactiveVideoUrl` set) + matching response + `handleAnswer` called with `_deps = { loadNextStep: spy, callLoadStep: spy }`
  - → `loadNextStep` called once with the stepData
  - → `stepCount` incremented by exactly 1
  - → `chatHistory` contains no `continueWidget` message and no message with `type === 'praise'` or `botName === 'Joe Walsh'`
  - → `appPhase` is not `'feedback'`
- `friendClosedResponse` step + non-matching response + `handleAnswer` called
  - → `loadNextStep` NOT called
  - → `appPhase === 'recording/answering'` (hangman retry preserved)
- `closedResponse` step + matching response + `handleAnswer` called (regression)
  - → `loadNextStep` NOT called
  - → `appPhase === 'feedback'`
  - → `chatHistory` contains a `continueWidget` message
- `friendClosedResponse` step + matching response + `handleAnswer` called with `_deps = {}` (no `loadNextStep`)
  - → no throw
  - → `appPhase === 'feedback'` (falls back to the standard feedback path)
  - → `chatHistory` contains a `continueWidget` message

## Technical Context

- No new dependencies. Tests use the existing vitest 4.1.6 + jsdom 29.1.1 setup; test files are colocated `*.test.js` (vitest excludes `tests/**` and `*.spec.js`, which are Playwright).
- `handleAnswer` is already exercised by `src/modules/answer/answer-pipeline.test.js` (calls with `_deps` at position 7 and `{ pauseCount: 0, netDuration: 0 }` stats) — storage/analytics/posthog imports resolve in jsdom and `analyzeSpeech`/`updateSpeechRecording` are safe to call.
- For `closedResponse`/`friendClosedResponse`, `processAnswerLogic` → `evaluateClosedResponse` (`answers.js:21-92`) is deterministic (normalize + similarity ≥ 95 threshold), so tests can drive `isCorrect` with real logic using a plain-string cue — no mocking of the NLP layer needed.
- `getCurrentStepIndex` (`answers.js:217-251`) matches by `step` + cue against the store's `currentStepIndex`; the test config must place the step at the store's `currentStepIndex` and give the step a `step` field.
- `native_language` defaults to `'en'` in the test store; `getRandomPraise` returns a praise object for any lang.

## Notes

- Manual verification: `npm run dev`, open `http://localhost:3000/course/model/lesson/wf`, dismiss the guest modal, answer a `friendClosedResponse` step correctly (mic, or the text-mode fallback) → the app advances to the next `viewAndContinue` step immediately with no praise message and no continue button. Answer incorrectly → hangman retry as before.
- The `wfa` lesson's `friendClosedResponse` steps get the same behavior automatically (keyed on `responseType`).
- No Playwright spec is added: the change is a single branch in `handleAnswer`, fully covered by the unit tests; an E2E would require mic/whisper bypasses and add flakiness.