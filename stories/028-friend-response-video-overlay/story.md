# Simple-video response steps: Replay / Answer / Tutorial decision overlay

## Context

A response step (`closedResponse`, `openResponse`, `friendClosedResponse`) can carry an interactive video (`interactiveVideoUrl`) or a plain clip (`simpleVideoUrl`). An interactive response raises the "what next?" decision overlay when its controller reaches decision time (`useInteractiveVideo.js:53-59`, `InteractiveVideoPlayer.web.jsx`), which is what drives the ear/mic `DecisionButtons`. A simple-video response step has no controller: `resetUIForNewStep` sends it to the `simpleVideo` phase with `bottomState: 'controlIcon'` (`src/modules/lesson/step-executor-webonly.js:71-72`, `src/modules/store/store.js:29`), so the mic (or text) button appears immediately while the clip plays and no decision overlay ever shows. The learner therefore never gets the Replay / Answer / Tutorial choice the interactive path gives them, and the always-present mic button reserves the bottom band that the clip's subtitles should be using.

This story makes a simple-video response step show the same "what next?" overlay after its clip plays: while the clip plays the mic control is hidden and the freed bottom space goes to the subtitles; when the clip ends (or fails to load) a water overlay appears with Replay / Answer / Tutorial buttons. Closed responses reuse the "repeat exactly" copy/label; open responses reuse the "did you understand?" copy/label. Behaviour is chosen from the video type, not a hardcoded list of response types, so any response step that is later configured with a simple clip is covered.

## Out of Scope

- The first response step's mode chooser (`firstResponse` / `IntroChoices`) is unchanged: the first time the first response step is shown it still presents the video-only mode chooser.
- Interactive-video response steps (e.g. `model.json` `wa`/`wfa`) keep their existing ear/mic `DecisionButtons` overlay; their options are not changed to Replay / Answer / Tutorial.
- `viewAndContinue` and `lessonSuccess` simple-video overlays and their subtitle position are unchanged.
- Native (`.native.*`) is out of scope; only the web player is changed.
- No lesson-config content changes and no change to which steps use a simple vs interactive clip.
- The simple-clip scrubber (`.ivp-scrubber`) is unchanged.

## Implementation approach

The trigger is the **phase**, not the response type: a simple-video response step is exactly the `simpleVideo` phase (`resetUIForNewStep` only assigns it when `step.simpleVideoUrl` is set and `step.interactiveVideoUrl` is not, for a response type other than `viewAndContinue`/`success`/`lessonIntro`). So `SimpleVideoPlayer` fires the overlay whenever the current phase is `simpleVideo`, which keeps the rule type-agnostic.

### New pure module: `src/modules/video/response-decision-logic.js`

No React, no DOM (per `agents.md` logic/presentation separation). Mirrors the interactive classification (`useInteractiveVideo.js:55-57`, `DecisionButtons.jsx:13-15`):

```js
const CLOSED_RESPONSE_TYPES = ['closedResponse', 'friendClosedResponse'];

export function isClosedResponseType(responseType) {
    return CLOSED_RESPONSE_TYPES.includes(responseType);
}
export function getResponseOverlayTextKey(responseType) {
    return isClosedResponseType(responseType) ? 'video_repeat_exactly' : 'video_did_understand';
}
export function getResponseAnswerLabelKey(responseType) {
    return isClosedResponseType(responseType) ? 'video_repeat_now' : 'video_respond_now';
}
```

### New pure module: `src/modules/lesson/recordable-phases.js`

Move `RECORDABLE_PHASES` out of `step-executor-webonly.js` and add `'simpleVideo-decisionTime-response'`, plus an `isRecordablePhase(phase)` helper (the list must be unit-testable). `step-executor-webonly.js:259` then calls `isRecordablePhase(phaseNow)`. The decision phase must be recordable or `onRecordingStart` logs "unexpected phase" and never enters `recording/answering`, stranding a live mic behind the overlay.

### Store (`src/modules/store/store.js`)

- `simpleVideo` phase mapping: `bottomState` changes `'controlIcon'` → `'hidden'` (mic hidden before the overlay).
- Add phase mapping:
  `'simpleVideo-decisionTime-response': { topState: 'topBarOnly', mediaState: 'decisionOverlay', bottomState: 'responseDecisionButtons', showMission: true }`.
- `answerFlowTransitions`:
  - `simpleVideo`: `['recording/answering', 'simpleVideo-decisionTime-response']`
  - `'simpleVideo-decisionTime-response'`: `['simpleVideo', 'recording/answering']`

### Player (`src/components/SimpleVideoPlayer.web.jsx`)

- Read `currentVideo` reactively (`useStore(appStore, s => s.currentVideo)`).
- `handleEnded`: keep the existing `viewAndContinue`/`success` branches, then add: when `appStore.getState().appPhase === 'simpleVideo'`, `transitionTo('simpleVideo-decisionTime-response', {}, { fromStepLoad: true })`.
- `handleError`: keep the existing `success` branch, then add the same `simpleVideo` → decision transition so a broken/undecodable clip still reveals the buttons instead of stranding the learner with a hidden mic.
- Overlay text: `appPhase === 'simpleVideo-decisionTime-response'` → `getBilingual(getResponseOverlayTextKey(currentVideo?.responseType), overlayLang)`; keep the existing `video_continue_create` (success) and `video_continue` (view-and-continue) fallbacks.
- Render the water overlay for `appPhase === 'simpleVideo-decisionTime-response'` (extend the existing condition at line 379).
- Subtitle container: add the class `subtitles-at-bottom` when `appPhase === 'simpleVideo'` (pre-overlay response step), alongside the existing `timed-subtitles-container` class.

### CSS (`src/assets/css/app.css`)

- Add `.ivp-subtitle-scroll-container.subtitles-at-bottom { bottom: 0 !important; max-height: 60% !important; }` (higher specificity than the existing `bottom:150px; max-height:calc(60% - 150px)` rule at line 1194, so the subtitles use the band the mic used to reserve).
- Extend the glow-suppression rule at lines 1006-1010 with `#responseReplayBtn::before, #responseTutorialBtn::before` (only the middle Answer button glows, matching `ViewAndContinueButtons`).

### New component: `src/components/widgets/ResponseDecisionButtons.jsx`

Model on `ViewAndContinueButtons.jsx` (Replay / Tutorial) plus `DecisionButtons.jsx` (middle mic/text button). Reads `currentVideo.responseType` and `isTextMode`; ids `#responseReplayBtn`, `#responseAnswerBtn`, `#responseTxtBtn`, `#responseTutorialBtn`:

- Replay: `transitionTo('simpleVideo', {}, { fromStepLoad: true })` then `getCurrentVideoPlayer()?.replay()`.
- Answer (voice): call `getSpeechInputToggleCallback()` and do **not** transition — `onRecordingStart` enters `recording/answering` once the mic is live, so a getUserMedia failure keeps the overlay mounted (same contract as `DecisionButtons.handleMicClick`).
- Answer (text, when `isTextMode`): `transitionTo('recording/answering')` then toggle `textInputVisible`/`setMicActive`/`triggerPauseAllVideos` (same as `DecisionButtons.handleTxtClickOverlay`). The mic button is `d-none` in text mode and the keyboard button is `d-none` otherwise.
- Tutorial: open the existing `TutorialModal`.
- Middle label: `getResponseAnswerLabelKey(currentVideo?.responseType)`; Replay `video_replay`; Tutorial `watch_tutorial`.

### Wiring (`src/components/LessonContainer.jsx`)

Render `<ResponseDecisionButtons />` when `bottomState === 'responseDecisionButtons'`, in the same `d-flex justify-content-center align-items-center w-100` row wrapper used by `presentDecisionButtons`.

## Tasks

### Task 1 - Response decision classification is pure and total

Create `src/modules/video/response-decision-logic.js` and `src/modules/video/response-decision-logic.test.js`.

- module imported + `getResponseOverlayTextKey('closedResponse')` called
  - → returns `'video_repeat_exactly'`
- `getResponseOverlayTextKey('friendClosedResponse')` called
  - → returns `'video_repeat_exactly'`
- `getResponseOverlayTextKey('openResponse')` called
  - → returns `'video_did_understand'`
- `getResponseOverlayTextKey(undefined)` / `(null)` / `('viewAndContinue')` / `('success')` / `('lessonIntro')` called
  - → returns `'video_did_understand'` (unknown/future types fall to the open copy)
- `getResponseAnswerLabelKey('closedResponse')` and `('friendClosedResponse')` called
  - → return `'video_repeat_now'`
- `getResponseAnswerLabelKey('openResponse')` and `(undefined)` called
  - → return `'video_respond_now'`
- `isClosedResponseType('closedResponse')` / `('friendClosedResponse')` called
  - → return `true`
- `isClosedResponseType('openResponse')` / `(undefined)` / `('')` called
  - → return `false`

### Task 2 - Recordable phases are single-sourced and the new phase is allowed

Create `src/modules/lesson/recordable-phases.js` + `src/modules/lesson/recordable-phases.test.js`; update `src/modules/lesson/step-executor-webonly.js` to import `isRecordablePhase` and use it at the `onRecordingStart` gate. Update `src/modules/store/store.js` (phase mapping + transitions) and extend `src/modules/store/store.test.js`.

- `transitionTo('simpleVideo', {}, { fromStepLoad: true })` called
  - → `appPhase === 'simpleVideo'`
  - → `mediaState === 'simpleVideo'`
  - → `bottomState === 'hidden'`
  - → `topState === 'topBarOnly'`
- `transitionTo('simpleVideo-decisionTime-response', {}, { fromStepLoad: true })` called
  - → `appPhase === 'simpleVideo-decisionTime-response'`
  - → `mediaState === 'decisionOverlay'`
  - → `bottomState === 'responseDecisionButtons'`
  - → `topState === 'topBarOnly'`
  - → `showMission === true`
- state at `simpleVideo` + `transitionTo('simpleVideo-decisionTime-response')` (no `fromStepLoad`) called
  - → `console.warn` is not called with an "Unexpected transition" message
- state at `simpleVideo-decisionTime-response` + `transitionTo('simpleVideo')` (no `fromStepLoad`) called
  - → no "Unexpected transition" warning
- state at `simpleVideo-decisionTime-response` + `transitionTo('recording/answering')` (no `fromStepLoad`) called
  - → no "Unexpected transition" warning
- `isRecordablePhase('simpleVideo-decisionTime-response')` called
  - → returns `true`
- `isRecordablePhase('firstResponse')` and `isRecordablePhase('interactiveVideo-decisionTime-friendClosedResponse')` called
  - → return `true` (regression: existing recordable phases preserved)
- `isRecordablePhase('recording/answering')` and `('interactiveVideo+friendClosedResponse')` called
  - → return `false`
- `src/modules/lesson/step-executor-webonly.js` source read with `readFileSync`
  - → does not contain `RECORDABLE_PHASES.includes(`
  - → contains `isRecordablePhase(`

### Task 3 - SimpleVideoPlayer raises the overlay and frees the subtitle band

Update `src/components/SimpleVideoPlayer.web.jsx` and `src/assets/css/app.css`. Add `tests/simple-response-overlay.spec.js` (Playwright; real codecs are not required — use the WebM data-URL sentinel pattern from `tests/success-concat-button.spec.js:11` and block autoplay for it). Setup helper: `page.goto('/course/model/lesson/g')`, wait for `configData`, dismiss the guest modal + mark logged in, set `userData.native_language = 'en'`, then `setCurrentVideo({ type:'simple', responseType, url: SENTINEL_SRC, config:{ subtitles:'Follow along.' } })`, `setMediaVisible(true)`, and `transitionTo('simpleVideo', {}, { fromStepLoad: true })`.

- simple response step mounted and playing-gated (autoplay blocked)
  - → `bottomState === 'hidden'`
  - → `#micBtn` has count 0
  - → `.ivp-subtitle-scroll-container` has class `subtitles-at-bottom`
  - → computed `bottom` of `.ivp-subtitle-scroll-container` is `0px`
  - → `.ivp-overlay.water-surface` has count 0
- `ended` dispatched on `.ivp-video` with `responseType` `'friendClosedResponse'`
  - → `appPhase === 'simpleVideo-decisionTime-response'`
  - → `.ivp-overlay.water-surface` is visible
  - → `.ivp-overlay-text` text is `Can you repeat that exactly?`
- `ended` with `responseType` `'openResponse'`
  - → `.ivp-overlay-text` text is `Did you understand completely?`
  - → `#responseAnswerBtn`'s `.ivp-choice-label-text` text is `RESPOND NOW`
- `ended` with `responseType` `'friendClosedResponse'`
  - → `#responseAnswerBtn`'s `.ivp-choice-label-text` text is `REPEAT NOW`
- `error` dispatched on `.ivp-video` while `appPhase === 'simpleVideo'`
  - → `appPhase === 'simpleVideo-decisionTime-response'` and the overlay is visible (not stranded)
- any of the `ended` cases + no `Unexpected transition` console warning collected
  - → the transition-warning list is empty

### Task 4 - Replay / Answer / Tutorial buttons drive the step

Create `src/components/widgets/ResponseDecisionButtons.jsx`; wire it into `src/components/LessonContainer.jsx`. Extend `tests/simple-response-overlay.spec.js`.

- decision phase for a `friendClosedResponse` simple step reached
  - → `#responseReplayBtn`, `#responseAnswerBtn`, `#responseTutorialBtn` are visible
  - → labels read `REPLAY VIDEO`, `REPEAT NOW`, `WATCH TUTORIAL`
- `#responseReplayBtn` clicked
  - → `appPhase === 'simpleVideo'`
  - → `bottomState === 'hidden'` and `.ivp-subtitle-scroll-container` has class `subtitles-at-bottom` again
- `#responseTutorialBtn` clicked
  - → `.tutorial-modal-overlay` is visible
  - → clicking the overlay outside `.tutorial-modal-content` (e.g. `position: { x: 5, y: 5 }`; the content stops propagation) dismisses it (`count === 0`)
- speech toggle callback replaced via `import('/src/modules/lesson/step-loader-callbacks.js').setSpeechInputToggleCallback(() => { window.__speechCalled = true; })`, then `#responseAnswerBtn` clicked in voice mode
  - → `window.__speechCalled === true`
  - → `appPhase` is still `simpleVideo-decisionTime-response` (recording is entered by `onRecordingStart`, not the button)
- `isTextMode` set true, then `#responseTxtBtn` clicked
  - → `appPhase === 'recording/answering'`
  - → `textInputVisible === true`

### Task 5 - Existing overlays and flows are unaffected

- existing `tests/success-concat-button.spec.js` run
  - → passes (view-and-continue copy is still `Press a button below.`; success overlay and concat button unchanged)
- existing `tests/whisper-engine-fallback.spec.js` run
  - → passes (interactive `closedResponse` decision overlay still yields `bottomState === 'decisionButtons'`)
- existing `tests/friend-video-only.spec.js` run
  - → passes (first-response mode chooser unchanged)
- `src/modules/store/store.test.js` run
  - → passes, including the existing `simpleVideo`-adjacent transition tests
- full unit suite `npm test -- --run` run
  - → passes

## Notes

- **Overlay-on-every-ended rule:** `SimpleVideoPlayer` raises the overlay whenever a simple clip ends while `appPhase === 'simpleVideo'`, so it appears on the initial play and after every Replay (the Replay button returns to `simpleVideo` first). No "already answered" suppression is added.
- **Retry rule (traced to `answer-pipeline.js:888-921`):** a wrong `friendClosedResponse`, or a wrong `closedResponse` within its retry budget, is handled inside the answer pipeline *without* reloading the step: it replays the simple clip, then transitions straight to `recording/answering` with the correction/hangman card, so the overlay does **not** re-appear and the mic is available again for the retry. Only reload-based retries (`openResponse`, and `closedResponse` after its retry budget via `callLoadStep` → `resetUIForNewStep`) return to the `simpleVideo` phase and therefore run the clip-ended → overlay sequence again. This is left as-is.
- **First response step, retry only:** the *initial* presentation of the first response step stays the `firstResponse` mode chooser. A wrong first `friendClosedResponse`/`closedResponse` follows the retry rule above (replay + `recording/answering`, no overlay); a reload-based retry follows that rule. Tightening this is out of scope.
- **Replay while the clip is already at its end** works because the SimpleVideoPlayer `replay()` handle seeks to 0 and plays (`SimpleVideoPlayer.web.jsx:68-74`).
- **Subtitles:** the low subtitle position is keyed to `appPhase === 'simpleVideo'`, so it reverts to the normal `bottom: 150px` band as soon as the decision phase or any recording phase begins.
- **Text mode:** friend lessons never offer text (`friend-video-only`), but non-friend lessons can; the decision overlay therefore keeps a keyboard alternative so a text-mode learner is never left with a hidden mic and no way to answer.
- Test commands: unit `npm test -- --run`; E2E `npx playwright test tests/simple-response-overlay.spec.js` (bundled Chromium is sufficient — the sentinel is WebM, not H.264).
