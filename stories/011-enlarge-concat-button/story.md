# Big, glowing concatenate button on the lesson success screen

## Context

At the end of a lesson the learner lands on `SuccessScreen` (`src/components/widgets/SuccessScreen.jsx:19`), which renders the video-concatenation trigger as a small outline button:

```jsx
// src/components/widgets/SuccessButtons.jsx:117-128
<button id="processBtn" className="btn btn-outline-primary w-100" onClick={handleProcess}>
  <i className="bi bi-film text-white" />
</button>
```

Clicking it runs `handleProcess` → `processVideo(...)` + `exportSegmentsToR2(...)` (`SuccessButtons.jsx:60-109`). It is the only action on the screen, yet it is visually the least prominent control in the app. Every earlier decision point trains the learner to press a large, glowing circular `.call-btn` that appears over the video after the clip finishes: the view-and-continue flow transitions on video end (`SimpleVideoPlayer.web.jsx:167-181` → `simpleVideo-decisionTime-viewAndContinue`), the water overlay renders at `SimpleVideoPlayer.web.jsx:360-373`, and the buttons glow via `.ivp-choice-col .call-btn::before` → `@keyframes btnGlowPulse` in `src/assets/css/app.css:962-972,1027-1034`.

The success step already carries a short "you're almost done, press the button below" clip: every `responseType: "success"` step in `src/config/*.json` has `simpleVideoUrl: "success"` (e.g. `src/config/model.json:93-97`, whose subtitles read "Oprime el botón para calcular tu calificación de fluidez"). Today that video plays and simply stops — no overlay, no glow, no state change (`handleEnded` only reacts to `viewAndContinue`). This story makes the final step behave exactly like the earlier ones: when the success video ends, the water overlay appears and the concat button is revealed as a large, glowing `.call-btn`.

## Out of Scope

- Adding or re-recording the "almost done" video. The existing `success` slug is used as-is.
- Changing the concat/processing behavior, `processVideo`, `exportSegmentsToR2`, the `Generating...` spinner state, or the post-generation `Share`/`Repeat`/`Continue` buttons.
- The guest `SaveClipsModal` flow (`SaveClipsModal.web.jsx`) and its timing.
- New visible UI copy or a text label above the button. The overlay reuses the existing `video_continue` string and the button keeps its film icon.
- `SimpleVideoPlayer.native.jsx` (dead-code reference implementation; it has no `handleEnded`).
- Any change to `src/config/*.json`.

## Implementation approach

All Task ACs are covered by one new Playwright spec, `tests/success-concat-button.spec.js` (the repo's UI test runner per `agents.md` §4); no unit-test-only behaviour is introduced.

### 1. New phase `lessonSuccess-decisionTime` (`src/modules/store/store.js`)

Add one entry to `phaseMapping` (immediately after `lessonSuccess`, `store.js:42`), mirroring the view-and-continue decision phase (`store.js:36`):

```js
'lessonSuccess-decisionTime': { topState: 'topBarOnly', mediaState: 'decisionOverlay', bottomState: 'lessonSuccess', showMission: false },
```

- `bottomState: 'lessonSuccess'` keeps `SuccessScreen` mounted, so the guest-modal `useEffect` in `VideoButton` (`SuccessButtons.jsx:44-56`) still fires when the success screen appears.
- `mediaState: 'decisionOverlay'` suppresses `SimpleVideoPlayer`'s tap-to-play icon (`SimpleVideoPlayer.web.jsx:404`) and the webcam, exactly like the earlier decision phase. The video stays mounted because `SimpleVideoPlayer` gates only on `currentVideo.type === 'simple'` + `mediaVisible` (`SimpleVideoPlayer.web.jsx:338`); neither this phase nor its mapping changes those.
- No `answerFlowTransitions` entry is needed: `handleEnded` calls `transitionTo(..., { fromStepLoad: true })`, which skips answer-flow validation (`store.js:345-351`).

### 2. Reveal on video end (`src/components/SimpleVideoPlayer.web.jsx`)

Extend `handleEnded` (`:167-181`) with a success branch plus a success log (`agents.md` §2):

```js
} else if (cv?.responseType === 'success') {
    console.log('[SimpleVideo] Success video ended → revealing concat button');
    appStore.getState().transitionTo('lessonSuccess-decisionTime', {}, { fromStepLoad: true });
}
```

Generalise the overlay condition (`:360`) to render for both decision phases. The overlay text, `video_continue` = "Press a button below." (`src/data/strings.js:1397-1402`), is already the correct instruction:

```jsx
{(appPhase === 'simpleVideo-decisionTime-viewAndContinue' || appPhase === 'lessonSuccess-decisionTime') && (
    <> {/* unchanged click-block + .ivp-overlay.water-surface markup */} </>
)}
```

### 3. Big glowing button (`src/components/widgets/SuccessButtons.jsx`)

In `VideoButton`, subscribe to `appPhase` and `currentVideo`, and replace the `button.state === 'idle'` block (`:117-128`) so the button renders only once the success clip is done — or immediately when the step has no success clip at all:

```jsx
const appPhase = useStore(appStore, state => state.appPhase);
const currentVideo = useStore(appStore, state => state.currentVideo);
// ...
if (button.state === 'idle') {
  const successVideoPending = currentVideo?.responseType === 'success';
  const revealed = appPhase === 'lessonSuccess-decisionTime' || !successVideoPending;
  if (!revealed) return null;
  return (
    <button type="button" id="processBtn" className="btn call-btn" onClick={handleProcess} aria-label="Create my video">
      <i className="bi bi-film" />
    </button>
  );
}
```

- `!successVideoPending` is the no-video fallback (e.g. a `unitcomplete` step with no `simpleVideoUrl`, where `handleUnitComplete` still enters `lessonSuccess`): with no clip to wait for, the button is revealed immediately rather than stranding the learner.
- Drop `text-white` from the icon: `.call-btn` forces `color: #1a1a1a !important` (`app.css:610-614`); every other call button uses a bare `<i>` for the same reason.
- The guest-modal `useEffect` is unaffected: it runs on `button.visible`, not on whether the idle button renders.

### 4. Reuse the glow (`src/assets/css/app.css`)

Add, next to the existing per-id glow rules (after `#state-intro-choices #continueButton`, `app.css:990`):

```css
#processBtn {
    position: relative;
    z-index: 0;
    animation: floatBob 3.5s ease-in-out infinite;
}
#processBtn::before {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    pointer-events: none;
    z-index: -1;
    background: transparent;
    box-shadow: 0 0 25px 8px rgba(255, 255, 255, 0.85);
    animation: btnGlowPulse 2s ease-in-out infinite;
}
```

`.call-btn` already supplies the 60×60 white circle, radius, padding, and icon sizing (`app.css:592-614`), so only the glow/float pseudo-element is new; both keyframes (`floatBob`, `btnGlowPulse`) already exist. The glow is inherently conditional because the button is only rendered once revealed.

### 5. Edge cases

- Success step with no `simpleVideoUrl` (`currentVideo` null) → button revealed immediately (predicate above).
- `viewAndContinue` video end → unchanged (`simpleVideo-decisionTime-viewAndContinue`).
- Guest: the modal still opens at success-screen appearance; after dismissal the video/overlay/button behave the same.
- Video cannot autoplay (blocked/muted) → the existing tap-to-play icon still starts it; the button is revealed on `ended`.
- Video file missing → the button stays hidden, the same accepted R2 dependency as every other step (product Known Limitations).

## Tasks

### Task 1 - Phase + transition plumbing

- success `simple` `currentVideo` present in phase `lessonSuccess` + `transitionTo('lessonSuccess-decisionTime', {}, { fromStepLoad: true })`
  - → `appPhase === 'lessonSuccess-decisionTime'`
  - → `bottomState === 'lessonSuccess'` (SuccessScreen still mounted)
  - → `mediaState === 'decisionOverlay'`
  - → `showMission === false`
  - → no `console.warn` about an unexpected transition

### Task 2 - Success video end reveals the overlay

- phase `lessonSuccess`, `currentVideo.responseType === 'success'`, video wrapper visible + native `ended` event dispatched on `.ivp-video`
  - → `appPhase === 'lessonSuccess-decisionTime'`
- phase `lessonSuccess` before `ended`
  - → no `.ivp-overlay.water-surface` in the DOM
- phase `lessonSuccess-decisionTime`
  - → `.ivp-overlay.water-surface` is visible over the video
  - → `.ivp-overlay-text` reads "Press a button below."
- phase `viewAndContinueVideo`, `currentVideo.responseType === 'viewAndContinue'` + `ended`
  - → `appPhase === 'simpleVideo-decisionTime-viewAndContinue'` (no regression)

### Task 3 - Big, glowing concat button

- phase `lessonSuccess`, success video still pending
  - → `#processBtn` is not rendered (`count === 0`)
- phase `lessonSuccess-decisionTime`
  - → `#processBtn` is visible
  - → has class `call-btn`
  - → bounding box is ≈60×60 px (between 56 and 64)
  - → `getComputedStyle(el, '::before').animationName` contains `btnGlowPulse`
  - → `getComputedStyle(el, '::before').boxShadow` is not `none`
- phase `lessonSuccess` with `currentVideo === null` (no success clip)
  - → `#processBtn` is visible immediately
- `#processBtn` clicked after reveal, with `src/modules/video/video-processor.js` stubbed
  - → `successVideoButton.state === 'processing'`
  - → `successCanvasVisible === true`

### Task 4 - No unexpected console output

- full reveal flow (`lessonSuccess` → `ended` → `lessonSuccess-decisionTime`)
  - → no `pageerror`
  - → no console error outside the documented noise list (favicon, source map, Whisper, vite, 401/Unauthorized)

## Technical Context

- No new dependencies. The spec uses the existing `@playwright/test` 1.60.0 (`package.json:23`); `playwright.config.js` runs `npx vite --port 5173` with `baseURL: http://localhost:5173` and `testDir: tests/`, so the spec lives at `tests/success-concat-button.spec.js` and uses the relative lesson path `/course/model/lesson/g` (the `agents.md` §4 pattern; its port 3000 is the `npm run dev` port, while Playwright serves 5173).
- `window.appStore` is the Playwright bridge (`src/hooks/use-app-bootstrap-webonly.js:26-31`); tests drive `setSuccessScreen`, `setCurrentVideo`, `transitionTo`, and read `appPhase` / `successVideoButton` / `successCanvasVisible` through it.
- React 19.2.0 + Zustand 5.0.13: `useStore(appStore, selector)` subscriptions are the established pattern. The new phase is pure data added to `phaseMapping`, covered by the existing `store.test.js` `transitionTo` suite.
- `agents.md` §1 forbids DOM APIs in app code; the new logic uses React state and CSS classes only. The spec's `page.evaluate` / `dispatchEvent` / `page.route` calls are test-harness code, not app code.
- `agents.md` §5: Playwright's bundled Chromium cannot decode H.264/AAC, so the spec must not depend on the `success.mp4` actually decoding. It uses a `data:video/mp4` sentinel source and relies on the existing 3 s FOUC fallback (`SimpleVideoPlayer.web.jsx:104-106`) to make the video wrapper visible, so the spec is offline-capable and codec-independent.
- `playwright.config.js` `testIgnore` already excludes the stale `tests/success-screen.spec.js`; the new spec is not ignored and runs under the default `chromium` project.

## Notes

**Assumptions (state explicitly, revise if wrong):**

1. The "great, you're almost done, just press the button below" clip is the existing `simpleVideoUrl: "success"` step (`src/config/model.json:93-97`; also referenced by `t.json` and `friend.json`). No new video is added.
2. "Get big" means the button is revealed on video end as the standard 60 px `.call-btn`, not that a previously-visible small button grows in place. This matches the earlier steps, where the bottom action is hidden while the clip plays. If an always-visible button is preferred instead, the reveal gate in Task 3 is the only thing to change.
3. No text label is added above the button; the overlay's existing "Press a button below." carries the instruction, and the user's "look like the other buttons" is satisfied by the overlay + glow.

**Test harness details (Playwright):**

- Prevent the success clip from autoplaying/ending on its own so the pre-reveal state is deterministic: `page.addInitScript` overrides `HTMLMediaElement.prototype.play` to reject only when `this.src` starts with `data:video/mp4`, then the test dispatches `new Event('ended')` on `.ivp-video`. React 19 attaches media listeners directly to the element, so the native dispatch invokes `onEnded`.
- Use a `data:video/mp4;base64,AAAA` sentinel as `currentVideo.url` (set via `setCurrentVideo`) so there is no network request and no codec dependency; wait for `.ivp-main-wrapper` to become visible (the 3 s FOUC fallback) before asserting.
- Stub the processor in the click test with `page.route('**/video-processor.js*', ...)` returning `export async function processVideo(){ return { blob: null }; }` plus no-op `shareVideo`/`exportSegmentsToR2`, so no real canvas/MediaRecorder work runs and no `alert` fires.
- Set `isLoggedIn: true` and `userData: { native_language: 'en', auth_method: 'supabase', $id: 'test-user' }` before `setSuccessScreen` so the guest `SaveClipsModal` does not open (it would make the page inert and block the button click) and the overlay copy is pinned to English.

**Known implementation risks (fallbacks if the primary harness proves flaky):**

1. If dispatching a native `ended` event does not invoke React's `onEnded` in the runner, trigger the handler through the element's React props (test-only): read the `__reactProps$...` key off the `<video>` node and call its `onEnded()`. The app code and the phase transition are unchanged either way.
2. If `page.route('**/video-processor.js*')` fails to intercept the Vite-transformed module URL, assert only the synchronous state change (`successVideoButton.state === 'processing'` immediately after click) and add `[Success] Video generation failed` to the expected-noise list, since real canvas/MediaRecorder work cannot succeed headlessly.
3. If the invalid `data:video/mp4` sentinel produces a console error, add the sentinel (`data:video/mp4`) to the expected-noise list — it is intentional and unrelated to the feature.

**Manual verification:**

1. `npm run dev`, open `/course/model/lesson/g`, reach the success step (or drive `window.appStore` as the spec does).
2. While the `success` clip plays: no bottom button, no overlay.
3. When it ends: the blue water overlay + "Press a button below." appear, and the film button is a large white glowing circle with the same float/pulse as earlier steps.
4. Press it: the `Generating...` state and the recap generation proceed exactly as before; the Share/Repeat/Continue buttons are unchanged.

**Review checklist:**

- `#processBtn` keeps its id (the guest-modal comments and any external tooling reference it) and its `onClick={handleProcess}`.
- The view-and-continue overlay and its buttons are unchanged.
- Existing comments and `console.log` statements are preserved; the new success log is added (`agents.md` §2).
- No `document`/`window` API added to app code (`agents.md` §1).
