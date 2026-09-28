# Friend lessons: video-recording mode only

## Context

A friend-challenge lesson exists so the learner makes a video and shares it with someone else: the ask lesson (`friend.json` lesson `a`) records the questions that publish to R2, and the answer lesson (`friend.json` lesson `b`, `model.json` `wa`/`wfa`) records the friend's answers that get concatenated. Today the first-response mode chooser (`src/components/widgets/IntroChoices.jsx`) offers three options for every lesson — Audio Only (`#audioOnlyButton`), Video Call (`#continueButton`), and Text Only (`#textOnlyButton`) — so a friend can pick audio-only or text-only, producing a clip that cannot become the shared video the lesson is for.

This story forces video for friend lessons: hide Audio Only and Text Only in the chooser so Video Call is the only selectable mode. It is a UI-only change in `IntroChoices.jsx`; recording, scoring, and recap code are untouched.

A "friend lesson" reuses the definition already established and shipped in `src/modules/user/friend-lesson-detection.js` (`isFriendLesson`): the route is a lesson opened with a case-insensitive `?shareCode=` URL parameter, or the route's lesson id is `a` or `b` (in any course).

## Out of Scope

- **Non-friend lessons** — they keep all three mode options unchanged.
- **Backend / recording / scoring / recap** — no change to `answer-pipeline.js`, `MicrophoneToggle`, `DecisionButtons`, or the R2 export path.
- **The speech-engine recovery flow** — the loading "preparing" guidance and the failure "Try Again" retry stay exactly as they are; only the Text Only fallback is removed for friend lessons.
- **The `?restart` query parameter and other non-`shareCode` query params** — they do not make a lesson a friend lesson.
- **Localization** — the button `aria-label`s stay hardcoded English as they are today; no new `Strings` keys.
- **Re-litigating the friend-lesson predicate** — the `a`/`b` + `?shareCode=` rule from story 016 is reused as-is, including its documented side effect on `model.json`/`gt2.json` lesson `a`.

## Implementation approach

### 1. Reuse the existing detector

`src/modules/user/friend-lesson-detection.js` already exports:

```js
isFriendLesson({ search, pathname }) // true when ?shareCode= present OR lesson id is 'a'/'b'
```

`IntroChoices.jsx` is rendered inside the lesson route (`LessonContainer`), so it can read the live route with `useLocation()` from `react-router-dom`:

```js
import { useLocation } from 'react-router-dom';
import { isFriendLesson } from '../../modules/user/friend-lesson-detection.js';

const location = useLocation();
const friendLesson = isFriendLesson({ search: location.search, pathname: location.pathname });
```

No new module and no new helper is needed.

### 2. Hide Audio Only and Text Only in `IntroChoices.jsx`

Only two render sites produce the buttons:

```js
const voiceButtons = (disabled) => (
    <>
        {!friendLesson && (
            <button className="btn call-icon" id="audioOnlyButton" aria-label="Audio Only" onClick={handleAudioClick} disabled={disabled}>
                <i className="bi bi-telephone-fill text-white"></i>
            </button>
        )}
        <button className="btn call-btn" id="continueButton" aria-label="Video Call" onClick={handleVideoClick} disabled={disabled}>
            <i className="bi bi-camera-video-fill"></i>
        </button>
    </>
);

const textOnlyBtn = friendLesson ? null : (
    <button className="btn call-icon" id="textOnlyButton" aria-label="Text Only" onClick={handleTextClick}>
        <i className="bi bi-keyboard-fill text-white"></i>
    </button>
);
```

Every branch already composes from those two variables, so the resulting behavior (unchanged code paths) is:

| engine UI state (`getSpeechUiState`) | non-friend lesson | friend lesson |
|---|---|---|
| `ready` | `#audioOnlyButton` + `#continueButton` + `#textOnlyButton` | `#continueButton` only |
| `loading` / `slow` | disabled `#audioOnlyButton` + disabled `#continueButton` + `#textOnlyButton` (+ Retry when `slow`) | disabled `#continueButton` only (+ Retry when `slow`) |
| `failed` | recovery text + `#retryEngineButton` + `#textOnlyButton` | recovery text + `#retryEngineButton` only |

`finishModeSelection(false, false)` is the only handler left reachable for friend lessons, so `isTextMode` stays `false` and `isCameraOff` stays `false` (video). Because the keyboard toggle in `MicrophoneToggle.web.jsx`/`DecisionButtons.jsx` renders only when `isTextMode` is already true, and friend lessons can no longer enter text mode, those need no change.

### 3. Composition edge cases

- `?shareCode=...` on any lesson id (including `wa`/`wfa` opened from a friend link) → friend → video only.
- Lesson id `a`/`b` without a share code → friend → video only.
- Non-friend lesson with a `?restart` (or any other) query param → not friend → all three options.
- The `isFriendLesson` result can change between renders only if the route changes; `IntroChoices` re-renders on navigation because it consumes `useLocation()`.

## Tasks

### Task 1 - Friend lessons render only the video option (`tests/friend-video-only.spec.js`, new Playwright)

Bootstrapping each case: load the route, wait for `window.appStore.getState().configData`, dismiss the guest/language dialog if present, then force the chooser deterministically with `window.appStore.getState().transitionTo('firstResponse', {}, { fromStepLoad: true })` and wait for `bottomState === 'introChoices'` (same pattern as `tests/whisper-engine-fallback.spec.js:249-255`). Reach the three engine states the way that spec does, so the state cannot flip underneath the assertions:
- **loading:** `await page.route('**r2.ultrafastfluency.com/whisper/onnx-community/**', HANG)` (never fulfill) so the engine stays loading.
- **ready:** hang the download, then `setWhisperReady(true)` / `setWhisperEngineFailed(false)`.
- **failed:** abort `**r2.ultrafastfluency.com/whisper/**` and `**cdn.jsdelivr.net/**`, then wait for `isWhisperEngineFailed === true`.

- friend route `/course/friend/lesson/b` + engine **ready** + chooser shown
  - → `#continueButton` is visible and enabled
  - → `#audioOnlyButton` has count `0`
  - → `#textOnlyButton` has count `0`
  - → `#state-intro-choices button` has count `1`
- friend route `/course/friend/lesson/b` + engine held in the **loading** state (Whisper download hung) + chooser shown
  - → `#continueButton` is visible and disabled
  - → `#audioOnlyButton` has count `0`
  - → `#textOnlyButton` has count `0`
  - → `#speechEngineStatusText` is visible
- friend route `/course/friend/lesson/b` + engine driven to the **failed** state (Whisper/jsdelivr aborted, `isWhisperEngineFailed === true`) + chooser shown
  - → `#retryEngineButton` is visible
  - → `#textOnlyButton` has count `0`
  - → `#audioOnlyButton` has count `0`
- friend route opened via share code `/course/model/lesson/g?shareCode=friendtest1` + engine **ready** + chooser shown
  - → `#continueButton` is visible
  - → `#audioOnlyButton` has count `0`
  - → `#textOnlyButton` has count `0`
- non-friend route `/course/model/lesson/w` + engine **ready** + chooser shown
  - → `#audioOnlyButton`, `#continueButton`, `#textOnlyButton` are all visible

## Technical Context

- **No new dependencies.** Reuses React 19.2.0, `react-router-dom` 7.15.1, `zustand` 5.0.13, and the existing detector `src/modules/user/friend-lesson-detection.js` (shipped via `stories/016-friend-lesson-modals`). Unit tests: vitest 4.1.6 + jsdom 29.1.1. Browser tests: `@playwright/test` 1.60.0 (`playwright.config.js`, `webServer: npx vite --port 5173`, `baseURL: http://localhost:5173`).
- **Chooser button ids** (existing test hooks): `#audioOnlyButton` (Audio Only), `#continueButton` (Video Call), `#textOnlyButton` (Text Only), `#retryEngineButton` (Try Again), `#speechEngineStatusText` (loading note), all inside `#state-intro-choices` (`src/components/widgets/IntroChoices.jsx`).
- **Engine state** is read from `getSpeechUiState({ isReady: isWhisperReady, isFailed: isWhisperEngineFailed, loadingMs })` (`src/modules/speech/speech-ui-state.js`): default store flags give `loading`; `setWhisperReady(true)` gives `ready`; `setWhisperEngineFailed(true)` gives `failed`.
- **Forcing the chooser** with `transitionTo('firstResponse', {}, { fromStepLoad: true })` is an established test pattern (`tests/whisper-engine-fallback.spec.js:249-255` forces `interactiveVideo-decisionTime-closedResponse` the same way); `firstResponse` maps to `bottomState: 'introChoices'` (`src/modules/store/store.js:27`).
- **`/course/model/lesson/w` is not a friend lesson** under the predicate (lesson id `w`, no share code), so it is the correct non-friend regression control and keeps the existing `tests/whisper-engine-fallback.spec.js` assertions valid.
- **`#continueButton` is unique to the chooser**; the success screen's button is `#continueButtonSuccess`.

## Notes

- **Reused predicate side effect (accepted in story 016, extended here):** because detection is route-only and does not use the course id, `model.json` lesson `a` and `gt2.json` lesson `a` ("Soda 1", ordinary lessons) are also treated as friend lessons and become video-only. This is the same trade-off already documented for the guest modal. If that is ever undesirable, the predicate must change (out of scope here).
- **Model ask lessons `w`/`wf` are not friend lessons** under the predicate (ids are not `a`/`b` and they are not opened with a share code), so they keep all three options; `wa`/`wfa` are covered only when opened via a `?shareCode=` friend link.
- **Engine-failed state:** a friend lesson shows the recovery guidance and the Try Again retry, with no Text Only fallback and no video button (the existing failure UI never renders voice buttons). This is intentional — video requires the speech engine, so Retry is the only path — and does not violate the "never strand" rule because Retry is present.
- **No change needed in `MicrophoneToggle.web.jsx` / `DecisionButtons.jsx`:** their keyboard toggle is only rendered while `isTextMode` is already true, which a friend lesson can no longer reach. The mic toggle they expose does not select audio-only mode.
- **Logging (`agents.md` §2):** this story adds no new logging; do not remove existing logs.
- **Manual verification:** open a friend link on a phone, confirm the chooser shows only the camera button (no phone/keyboard icons) while the engine loads and once ready, and confirm a non-friend lesson still shows all three.
