# Friend lessons: skip the mode chooser on the first question

## Context

Story 028 added the Replay / Answer / Tutorial overlay for simple-video response steps, but left the *first* response step on the `firstResponse` phase, where `IntroChoices` shows the mode chooser (`src/modules/lesson/step-executor-webonly.js:55-56`). For a friend lesson that chooser offers only the Video Call button, and its click goes straight to recording — so the very first question a friend sees has no video-first `play → overlay` moment, even though every later question does. Testing `/course/wouldrather/lesson/a` confirmed it: step index 2 → `firstResponse` + mode chooser, step index 3/4 → `simpleVideo` + the 028 overlay.

For a friend lesson the one-button chooser is redundant: friend lessons are video-only (`isFriendLesson`), the camera is warmed during the step load, and the decision overlay's Answer already starts video recording. This story makes a friend lesson's first response step skip the chooser and use its normal per-video flow:
- simple clip → `simpleVideo` (mic hidden, subtitles low) → clip end → `simpleVideo-decisionTime-response` overlay from story 028;
- interactive clip → the existing `interactiveVideo+<type>` phase and its decision overlay;
- no clip → `recording/answering`.

Non-friend lessons keep the `firstResponse` chooser so audio-only and text-only stay reachable.

## Out of Scope

- The `IntroChoices` component and story 020's "video-only chooser" behaviour are not removed; it simply is not reached naturally for friend lessons any more. Its spec (`tests/friend-video-only.spec.js`) forces `firstResponse` and keeps passing.
- Non-friend lessons: the first response step still shows the three-option chooser.
- No change to the 028 overlay, to interactive decision buttons, or to which steps carry simple vs interactive clips.
- The speech-engine loading/retry UI that `IntroChoices` shows on the first step is not reproduced elsewhere; on a friend lesson the first question relies on the step-load camera warmup and the overlay's Answer button. No new loading UI is added.
- Native is out of scope (web-only module).

## Implementation approach

### Extract the phase decision into a pure module

Add `src/modules/lesson/step-phase-logic.js` (no React, no DOM, no store) with `resolveStepPhase({ step, isFirstResponseStep, isRetry, isFriendLesson })`. It reproduces the current branch order exactly, except the `firstResponse` branch also requires `!isFriendLesson`:

```js
const RESPONSE_TYPES = ['closedResponse', 'openResponse', 'friendClosedResponse'];

function interactivePhase(responseType) {
    return 'interactiveVideo+' + (
        responseType === 'openResponse' ? 'openResponse'
            : responseType === 'friendClosedResponse' ? 'friendClosedResponse'
                : 'closedResponse'
    );
}

export function resolveStepPhase({ step, isFirstResponseStep = false, isRetry = false, isFriendLesson = false } = {}) {
    const responseType = step?.responseType;
    if (responseType === 'lessonIntro') return 'lessonIntro';
    if (responseType === 'success') return 'lessonSuccess';
    if (RESPONSE_TYPES.includes(responseType) && isFirstResponseStep && !isRetry && !isFriendLesson) return 'firstResponse';
    if (step.interactiveVideoUrl && !isRetry) return interactivePhase(responseType);
    if (responseType === 'viewAndContinue' && step.simpleVideoUrl) return 'viewAndContinueVideo';
    if (step.simpleVideoUrl) return 'simpleVideo';
    return 'recording/answering';
}
```

### Wire it into `resetUIForNewStep`

In `src/modules/lesson/step-executor-webonly.js`, replace the inline `if/else` chain with the pure call. Compute friend-ness from the route (the canonical predicate, `src/modules/user/friend-lesson-detection.js`), guarded for non-browser contexts:

```js
import { isFriendLesson } from '../user/friend-lesson-detection.js';
import { resolveStepPhase } from './step-phase-logic.js';
...
const friendLesson = typeof window !== 'undefined'
    ? isFriendLesson({ search: window.location.search, pathname: window.location.pathname })
    : false;
const phase = resolveStepPhase({ step, isFirstResponseStep, isRetry, isFriendLesson: friendLesson });
appStore.getState().transitionTo(phase, {}, { fromStepLoad: true });
```

`isFriendLesson` is true for a `?shareCode=` URL or a lesson id `a`/`b` in any course, so the "ordinary lessons `a`" limitation in the product doc now also applies to the chooser skip (documented caveat).

### Docs

Amend the 028 feature bullet in `docs/product.md` to note that friend lessons also cover the first question (no mode chooser).

## Tasks

### Task 1 - Pure phase resolution covers the friend/non-friend matrix

Create `src/modules/lesson/step-phase-logic.js` and `src/modules/lesson/step-phase-logic.test.js`.

- friend lesson + first response step + `friendClosedResponse` + `simpleVideoUrl` + no retry
  - → returns `'simpleVideo'`
- friend lesson + first response step + `closedResponse` + `simpleVideoUrl` + no retry
  - → returns `'simpleVideo'`
- friend lesson + first response step + `openResponse` + `simpleVideoUrl` + no retry
  - → returns `'simpleVideo'`
- friend lesson + first response step + `friendClosedResponse` + `interactiveVideoUrl` + no retry
  - → returns `'interactiveVideo+friendClosedResponse'`
- friend lesson + first response step + `openResponse` + `interactiveVideoUrl` + no retry
  - → returns `'interactiveVideo+openResponse'`
- friend lesson + first response step + `closedResponse` + `interactiveVideoUrl` + no retry
  - → returns `'interactiveVideo+closedResponse'`
- friend lesson + first response step + response type + no video + no retry
  - → returns `'recording/answering'`
- non-friend lesson + first response step + `closedResponse`/`friendClosedResponse` + `simpleVideoUrl` + no retry
  - → returns `'firstResponse'`
- non-friend lesson + first response step + `closedResponse`/`friendClosedResponse` + `interactiveVideoUrl` + no retry
  - → returns `'firstResponse'`
- friend lesson + first response step + `simpleVideoUrl` + retry
  - → returns `'simpleVideo'` (the `firstResponse`/interactive branches already require `!isRetry`)
- non-friend lesson + first response step + `simpleVideoUrl` + retry
  - → returns `'simpleVideo'`
- friend lesson + a later (non-first) response step + `simpleVideoUrl`
  - → returns `'simpleVideo'` (unchanged from 028)
- `lessonIntro` step (friend or not)
  - → returns `'lessonIntro'`
- `success` step (friend or not)
  - → returns `'lessonSuccess'`
- `viewAndContinue` + `simpleVideoUrl`
  - → returns `'viewAndContinueVideo'`
- non-response step with `interactiveVideoUrl` and an unknown/omitted response type
  - → returns `'interactiveVideo+closedResponse'` (preserves the existing default)

### Task 2 - `resetUIForNewStep` uses the pure resolver and route friend detection

Update `src/modules/lesson/step-executor-webonly.js`. Add `tests/friend-first-question-overlay.spec.js`.

- `src/modules/lesson/step-executor-webonly.js` source read with `readFileSync`
  - → contains `resolveStepPhase(`
  - → contains `isFriendLesson(`
  - → does not contain `phase = 'firstResponse'`
- friend lesson `/course/wouldrather/lesson/a`, step index 2 loaded via `loadStep`
  - → `appPhase === 'simpleVideo'`
  - → `bottomState === 'hidden'`
  - → `#state-intro-choices` has count 0
  - → `#micBtn` has count 0
  - → `.ivp-subtitle-scroll-container` has class `subtitles-at-bottom`
  - → dispatching `ended` on `.ivp-video` gives `appPhase === 'simpleVideo-decisionTime-response'` and a visible `.ivp-overlay.water-surface` with text `Can you repeat that exactly?` (`video_repeat_exactly`) and `#responseAnswerBtn`
- friend lesson via share code `/course/model/lesson/wa?shareCode=friendtest1`, step index 2 (interactive `friendClosedResponse`) loaded via `loadStep` (`wa` is friend only through `?shareCode=`)
  - → `appPhase === 'interactiveVideo+friendClosedResponse'`
  - → `#state-intro-choices` has count 0
- friend lesson via share code `/course/model/lesson/g?shareCode=friendtest1`, step index 1 (`closedResponse` interactive) loaded via `loadStep`
  - → `appPhase === 'interactiveVideo+closedResponse'`
  - → `#state-intro-choices` has count 0
- non-friend lesson `/course/model/lesson/w`, step index 1 (`closedResponse` interactive) loaded via `loadStep`
  - → `appPhase === 'firstResponse'`
  - → `#state-intro-choices` has count 1
- non-friend lesson `/course/model/lesson/wa`, step index 2 (interactive `friendClosedResponse`) loaded via `loadStep` (no share code)
  - → `appPhase === 'firstResponse'` (regression: `wa` is not a `a`/`b` id)
  - → `#state-intro-choices` has count 1
- any of the above + transition warnings collected
  - → the "Unexpected transition" warning list is empty

### Task 3 - Documentation and regressions

- `docs/product.md` final state (amended during planning; do not revert)
  - → the simple-video response decision overlay bullet also links `stories/029-friend-first-question-overlay` and states the friend first question is covered
- existing `tests/simple-response-overlay.spec.js` run
  - → passes (later-step overlay behaviour unchanged)
- existing `tests/friend-video-only.spec.js` run
  - → passes (the forced `firstResponse` chooser still renders video-only for friend lessons)
- existing `tests/success-concat-button.spec.js` and `tests/whisper-engine-fallback.spec.js` run
  - → pass
- full unit suite `npm test -- --run` run
  - → passes

## Notes

- **Overlay copy string:** the 028 overlay copy for a `friendClosedResponse` step is `video_repeat_exactly`, whose English value is `Can you repeat that exactly?` (`src/data/strings.js`). Use the exact rendered text from the string, not a paraphrase.
- **Route detection caveat:** `isFriendLesson` is route-only (`?shareCode=` or lesson id `a`/`b`, any course), so the ordinary lessons `a` in `model.json`/`gt2.json` also skip the chooser on their first question. This matches the documented "friend lesson detection" limitation.
- **This branch is based on `028-friend-response-video-overlay`**, which is not merged to `main`. The review range `origin/main..HEAD` therefore also contains the 028 commits; they already passed their own review. Do not rebase onto `main` (which would drop the 028 dependency); rebase onto `origin/main` only if `main` advances, preserving 028, and resolve `docs/product.md`/`agents.md` conflicts by keeping both changes.
- **Branch numbering:** a stale local branch `029-friend-closed-response-overlay` exists; this branch is `029-friend-first-question-overlay`. Confirm `git branch --show-current` before committing.
- Test commands: unit `npm test -- --run`; E2E `npx playwright test tests/friend-first-question-overlay.spec.js` (bundled Chromium is sufficient; use the WebM data-URL sentinel/anti-autoplay pattern from `tests/success-concat-button.spec.js` and wait for `configData` + `appPhase === 'lessonIntro'` before calling `loadStep`).
