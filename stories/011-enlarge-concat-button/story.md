# Big, glowing concatenate button on the lesson success screen

## Context

At the end of a lesson the learner lands on `SuccessScreen` (`src/components/widgets/SuccessScreen.jsx:19`), which renders the video-concatenation trigger as a small outline button:

```jsx
// src/components/widgets/SuccessButtons.jsx:117-128
<button id="processBtn" className="btn btn-outline-primary w-100" onClick={handleProcess}>
  <i className="bi bi-film text-white" />
</button>
```

Clicking it runs `handleProcess` → `processVideo(...)` + `exportSegmentsToR2(...)` (`SuccessButtons.jsx:60-109`). It is the only action on the screen, yet it is visually the least prominent control in the app. Every earlier decision point trains the learner to press a large, glowing circular `.call-btn` with a bilingual label above it that appears over the video after the clip finishes: the view-and-continue flow transitions on video end (`SimpleVideoPlayer.web.jsx:167-181` → `simpleVideo-decisionTime-viewAndContinue`), the water overlay renders at `SimpleVideoPlayer.web.jsx:360-373`, and the buttons + labels glow/rise via `.ivp-choice-col .call-btn` and `.ivp-choice-label` in `src/assets/css/app.css:885-915,936-972,1027-1034`. `ViewAndContinueButtons.jsx:56-67` is the canonical markup: an `.ivp-choice-col` containing an `.ivp-choice-label` ("CONTINUE") and a `.call-btn`.

The success step already carries a short "you're almost done, press the button below" clip: every `responseType: "success"` step in `src/config/*.json` has `simpleVideoUrl: "success"` (e.g. `src/config/model.json:93-97`, whose subtitles read "Oprime el botón para calcular tu calificación de fluidez"). Today that video plays and simply stops — no overlay, no glow, no state change (`handleEnded` only reacts to `viewAndContinue`). This story makes the final step behave exactly like the earlier ones: when the success video ends, the water overlay appears with copy that invites the learner to create and share their video, and the concat button is revealed as a large, glowing `.call-btn` labelled **CONTINUE**.

## Out of Scope

- Adding or re-recording the "almost done" video. The existing `success` slug is used as-is.
- Changing the concat/processing behavior, `processVideo`, `exportSegmentsToR2`, the `Generating...` spinner state, or the post-generation `Share`/`Repeat`/`Continue` buttons.
- The guest `SaveClipsModal` flow (`SaveClipsModal.web.jsx`) and its timing.
- The button's film icon (kept) and any change to the existing `video_continue` / `continue` strings (only a new key is added).
- `SimpleVideoPlayer.native.jsx` (dead-code reference implementation; it has no `handleEnded`).
- Any change to `src/config/*.json`.

## Implementation approach

All Task ACs are covered by the new Playwright spec `tests/success-concat-button.spec.js` (the repo's UI test runner per `agents.md` §4) plus the existing vitest string-coverage suite (`src/data/strings.test.js`), which runs automatically.

### 1. New phase `lessonSuccess-decisionTime` (`src/modules/store/store.js`)

Add one entry to `phaseMapping` (immediately after `lessonSuccess`, `store.js:42`), mirroring the view-and-continue decision phase (`store.js:36`):

```js
'lessonSuccess-decisionTime': { topState: 'topBarOnly', mediaState: 'decisionOverlay', bottomState: 'lessonSuccess', showMission: false },
```

- `bottomState: 'lessonSuccess'` keeps `SuccessScreen` mounted, so the guest-modal `useEffect` in `VideoButton` (`SuccessButtons.jsx:44-56`) still fires when the success screen appears.
- `mediaState: 'decisionOverlay'` suppresses `SimpleVideoPlayer`'s tap-to-play icon (`SimpleVideoPlayer.web.jsx:404`) and the webcam, exactly like the earlier decision phase. The video stays mounted because `SimpleVideoPlayer` gates only on `currentVideo.type === 'simple'` + `mediaVisible` (`SimpleVideoPlayer.web.jsx:338`); neither this phase nor its mapping changes those.
- No `answerFlowTransitions` entry is needed: `handleEnded` calls `transitionTo(..., { fromStepLoad: true })`, which skips answer-flow validation (`store.js:345-351`).

### 2. Reveal on video end + descriptive overlay copy (`src/components/SimpleVideoPlayer.web.jsx`, `src/data/strings.js`)

Extend `handleEnded` (`:167-181`) with a success branch plus a success log (`agents.md` §2):

```js
} else if (cv?.responseType === 'success') {
    console.log('[SimpleVideo] Success video ended → revealing concat button');
    appStore.getState().transitionTo('lessonSuccess-decisionTime', {}, { fromStepLoad: true });
}
```

Generalise the overlay condition (`:360`) to render for both decision phases, and select the copy by phase. The existing `video_continue` ("Press a button below.") stays for the earlier steps; the new `video_continue_create` key explains the outcome for the success step:

```jsx
const overlayBilingual = useMemo(
    () => getBilingual(appPhase === 'lessonSuccess-decisionTime' ? 'video_continue_create' : 'video_continue', overlayLang),
    [appPhase, overlayLang]
);
// ...
{(appPhase === 'simpleVideo-decisionTime-viewAndContinue' || appPhase === 'lessonSuccess-decisionTime') && (
    <> {/* unchanged click-block + .ivp-overlay.water-surface markup */} </>
)}
```

Add to `src/data/strings.js` next to `video_continue` (`:1397-1402`). Proposed copy (review/adjust freely — the exact wording is not load-bearing for the feature):

```js
'video_continue_create': {
    en: "Continue to create and share your video",
    es: "Continúa para crear y compartir tu video",
    pt: "Continue para criar e compartilhar seu vídeo",
    fr: "Continuez pour créer et partager votre vidéo",
    hi: "अपना वीडियो बनाने और साझा करने के लिए जारी रखें",
    bn: "আপনার ভিডিও তৈরি করতে এবং শেয়ার করতে চালিয়ে যান"
},
```

The `hi`/`bn` values are mandatory: `src/data/strings.test.js:16-31` iterates every key and asserts a Devanagari / Bengali match.

### 3. Big glowing button with a CONTINUE label (`src/components/widgets/SuccessButtons.jsx`)

In `VideoButton`, subscribe to `appPhase`, `currentVideo`, and `userData`; import `getBilingual` (`src/data/strings.js`); and replace the `button.state === 'idle'` block (`:117-128`) with the same `.ivp-choice-col` + `.ivp-choice-label` + `.call-btn` structure the earlier steps use (`ViewAndContinueButtons.jsx:56-67`), so both the label and the glow are inherited from existing CSS:

```jsx
import { getBilingual } from '../../data/strings.js';
// inside VideoButton:
const appPhase = useStore(appStore, state => state.appPhase);
const currentVideo = useStore(appStore, state => state.currentVideo);
const userData = useStore(appStore, state => state.userData);
// ...
if (button.state === 'idle') {
  const successVideoPending = currentVideo?.responseType === 'success';
  const revealed = appPhase === 'lessonSuccess-decisionTime' || !successVideoPending;
  if (!revealed) return null;
  const continueLabel = getBilingual('continue', userData?.native_language || 'en');
  return (
    <div className="ivp-choice-col" style={{ flex: '0 0 auto', minWidth: 0 }}>
      <div className="ivp-choice-label">
        <div className="ivp-choice-label-text">
          {continueLabel.localized ? (
            <React.Fragment>{continueLabel.english}<br /><span lang={continueLabel.lang}><i>{continueLabel.localized}</i></span></React.Fragment>
          ) : continueLabel.english}
        </div>
      </div>
      <button type="button" id="processBtn" className="btn call-btn" onClick={handleProcess} aria-label="Continue">
        <i className="bi bi-film" />
      </button>
    </div>
  );
}
```

- The label reuses the existing `continue` string (`strings.js:1415-1420`: "CONTINUE" / "CONTINUAR" / "जारी रखें" / "চালিয়ে যান"), exactly as `ViewAndContinueButtons` does. No new label copy.
- `!successVideoPending` is the no-video fallback (e.g. a `unitcomplete` step with no `simpleVideoUrl`, where `handleUnitComplete` still enters `lessonSuccess`): with no clip to wait for, the button is revealed immediately rather than stranding the learner.
- Drop `text-white` from the icon: `.call-btn` forces `color: #1a1a1a !important` (`app.css:610-614`); every other call button uses a bare `<i>` for the same reason.
- The guest-modal `useEffect` is unaffected: it runs on `button.visible`, not on whether the idle button renders.

### 4. No new CSS

Wrapping the button in `.ivp-choice-col` means the existing `.ivp-choice-col .call-btn` float (`app.css:936-940`) and `.ivp-choice-col .call-btn::before` glow (`app.css:962-972` → `@keyframes btnGlowPulse`, `app.css:1027-1034`) apply unchanged. The glow is inherently conditional because the whole column is only rendered once revealed. Do not add a `#processBtn`-specific glow rule; reuse is the point of this story.

### 5. Edge cases

- Success step with no `simpleVideoUrl` (`currentVideo` null) → button + CONTINUE label revealed immediately (predicate above).
- `viewAndContinue` video end → unchanged (`simpleVideo-decisionTime-viewAndContinue`, overlay still `video_continue`).
- Guest: the modal still opens at success-screen appearance; after dismissal the video/overlay/button behave the same.
- Video cannot autoplay (blocked/muted) → the existing tap-to-play icon still starts it; the button is revealed on `ended`.
- Video file missing → the button stays hidden, the same accepted R2 dependency as every other step (product Known Limitations).
- Non-en learner → the label shows the English word plus the localized line, and the overlay shows the English copy plus the localized line, matching the bilingual treatment of every other overlay.

## Tasks

### Task 1 - Phase + transition plumbing

- success `simple` `currentVideo` present in phase `lessonSuccess` + `transitionTo('lessonSuccess-decisionTime', {}, { fromStepLoad: true })`
  - → `appPhase === 'lessonSuccess-decisionTime'`
  - → `bottomState === 'lessonSuccess'` (SuccessScreen still mounted)
  - → `mediaState === 'decisionOverlay'`
  - → `showMission === false`
  - → no `console.warn` about an unexpected transition

### Task 2 - Success video end reveals the overlay with descriptive copy

- phase `lessonSuccess`, `currentVideo.responseType === 'success'`, video wrapper visible + native `ended` event dispatched on `.ivp-video`
  - → `appPhase === 'lessonSuccess-decisionTime'`
- phase `lessonSuccess` before `ended`
  - → no `.ivp-overlay.water-surface` in the DOM
- phase `lessonSuccess-decisionTime`
  - → `.ivp-overlay.water-surface` is visible over the video
  - → `.ivp-overlay-text` reads "Continue to create and share your video" (en)
  - → `.ivp-overlay-text` does not contain "Press a button below."
- phase `viewAndContinueVideo`, `currentVideo.responseType === 'viewAndContinue'` + `ended`
  - → `appPhase === 'simpleVideo-decisionTime-viewAndContinue'`
  - → `.ivp-overlay-text` still reads "Press a button below."

### Task 3 - Big, glowing button with a CONTINUE label

- phase `lessonSuccess`, success video still pending
  - → `#processBtn` is not rendered (`count === 0`)
- phase `lessonSuccess-decisionTime`
  - → `#processBtn` is visible
  - → has class `call-btn`
  - → bounding box is ≈60×60 px (between 56 and 64)
  - → `getComputedStyle(el, '::before').animationName` contains `btnGlowPulse`
  - → `getComputedStyle(el, '::before').boxShadow` is not `none`
  - → the button's `.ivp-choice-col` ancestor contains `.ivp-choice-label-text` reading "CONTINUE" (en)
- phase `lessonSuccess` with `currentVideo === null` (no success clip)
  - → `#processBtn` and its CONTINUE label are visible immediately
- `#processBtn` clicked after reveal, with `src/modules/video/video-processor.js` stubbed
  - → `successVideoButton.state === 'processing'`
  - → `successCanvasVisible === true`

### Task 4 - String coverage

- `npm test -- --run` (vitest)
  - → `src/data/strings.test.js` passes: the new `video_continue_create` key has non-empty `hi` matching Devanagari and `bn` matching Bengali
  - → no existing key regresses

### Task 5 - No unexpected console output

- full reveal flow (`lessonSuccess` → `ended` → `lessonSuccess-decisionTime`)
  - → no `pageerror`
  - → no console error outside the documented noise list (favicon, source map, Whisper, vite, 401/Unauthorized)

## Technical Context

- No new dependencies. The spec uses the existing `@playwright/test` 1.60.0 (`package.json:23`); `playwright.config.js` runs `npx vite --port 5173` with `baseURL: http://localhost:5173` and `testDir: tests/`, so the spec lives at `tests/success-concat-button.spec.js` and uses the relative lesson path `/course/model/lesson/g` (the `agents.md` §4 pattern; its port 3000 is the `npm run dev` port, while Playwright serves 5173).
- `window.appStore` is the Playwright bridge (`src/hooks/use-app-bootstrap-webonly.js:26-31`); tests drive `setSuccessScreen`, `setCurrentVideo`, `transitionTo`, and read `appPhase` / `successVideoButton` / `successCanvasVisible` through it.
- React 19.2.0 + Zustand 5.0.13: `useStore(appStore, selector)` subscriptions are the established pattern. The new phase is pure data added to `phaseMapping`, covered by the existing `store.test.js` `transitionTo` suite.
- `src/data/strings.test.js:16-31` auto-iterates `Object.keys(strings)` and requires `hi` (Devanagari, `/[\u0900-\u097F]/`) and `bn` (Bengali, `/[\u0980-\u09FF]/`) for **every** key, so the new overlay string must ship those two scripts or `npm test` fails.
- `agents.md` §1 forbids DOM APIs in app code; the new logic uses React state and CSS classes only. The spec's `page.evaluate` / `dispatchEvent` / `page.route` calls are test-harness code, not app code.
- `agents.md` §5: Playwright's bundled Chromium cannot decode H.264/AAC, so the spec must not depend on the `success.mp4` actually decoding. It uses a `data:video/mp4` sentinel source and relies on the existing 3 s FOUC fallback (`SimpleVideoPlayer.web.jsx:104-106`) to make the video wrapper visible, so the spec is offline-capable and codec-independent.
- `playwright.config.js` `testIgnore` already excludes the stale `tests/success-screen.spec.js`; the new spec is not ignored and runs under the default `chromium` project.

## Notes

**Assumptions (state explicitly, revise if wrong):**

1. The "great, you're almost done, just press the button below" clip is the existing `simpleVideoUrl: "success"` step (`src/config/model.json:93-97`; also referenced by `t.json` and `friend.json`). No new video is added.
2. "Get big" means the button is revealed on video end as the standard 60 px `.call-btn`, not that a previously-visible small button grows in place. This matches the earlier steps, where the bottom action is hidden while the clip plays. If an always-visible button is preferred instead, the reveal gate in Task 3 is the only thing to change.
3. The button label is the existing `continue` string ("CONTINUE"), placed above the button in the same `.ivp-choice-label` structure as `ViewAndContinueButtons`.
4. The overlay copy is a **new** key `video_continue_create`, confirmed as "Continue to create and share your video" (plus proposed es/pt/fr/hi/bn). The exact wording does not affect any AC except the string assertion in Task 2 — if the `en` value changes, update that one assertion together.

**Test harness details (Playwright):**

- Prevent the success clip from autoplaying/ending on its own so the pre-reveal state is deterministic: `page.addInitScript` overrides `HTMLMediaElement.prototype.play` to reject only when `this.src` starts with `data:video/mp4`, then the test dispatches `new Event('ended')` on `.ivp-video`. React 19 attaches media listeners directly to the element, so the native dispatch invokes `onEnded`.
- Use a `data:video/mp4;base64,AAAA` sentinel as `currentVideo.url` (set via `setCurrentVideo`) so there is no network request and no codec dependency; wait for `.ivp-main-wrapper` to become visible (the 3 s FOUC fallback) before asserting.
- Stub the processor in the click test with `page.route('**/video-processor.js*', ...)` returning `export async function processVideo(){ return { blob: null }; }` plus no-op `shareVideo`/`exportSegmentsToR2`, so no real canvas/MediaRecorder work runs and no `alert` fires.
- Set `isLoggedIn: true` and `userData: { native_language: 'en', auth_method: 'supabase', $id: 'test-user' }` before `setSuccessScreen` so the guest `SaveClipsModal` does not open (it would make the page inert and block the button click) and the overlay/label copy is pinned to English.

**Known implementation risks (fallbacks if the primary harness proves flaky):**

1. If dispatching a native `ended` event does not invoke React's `onEnded` in the runner, trigger the handler through the element's React props (test-only): read the `__reactProps$...` key off the `<video>` node and call its `onEnded()`. The app code and the phase transition are unchanged either way.
2. If `page.route('**/video-processor.js*')` fails to intercept the Vite-transformed module URL, assert only the synchronous state change (`successVideoButton.state === 'processing'` immediately after click) and add `[Success] Video generation failed` to the expected-noise list, since real canvas/MediaRecorder work cannot succeed headlessly.
3. If the invalid `data:video/mp4` sentinel produces a console error, add the sentinel (`data:video/mp4`) to the expected-noise list — it is intentional and unrelated to the feature.

**Manual verification:**

1. `npm run dev`, open `/course/model/lesson/g`, reach the success step (or drive `window.appStore` as the spec does).
2. While the `success` clip plays: no bottom button, no overlay.
3. When it ends: the blue water overlay appears reading "Continue to create and share your video", and the film button is a large white glowing circle with a "CONTINUE" label above it, matching earlier steps.
4. Press it: the `Generating...` state and the recap generation proceed exactly as before; the Share/Repeat/Continue buttons are unchanged.

**Review checklist:**

- `#processBtn` keeps its id (the guest-modal comments and any external tooling reference it) and its `onClick={handleProcess}`.
- The view-and-continue overlay text and buttons are unchanged.
- No new CSS was added — the label and glow come from the existing `.ivp-choice-col` / `.call-btn` rules.
- Existing comments and `console.log` statements are preserved; the new success log is added (`agents.md` §2).
- No `document`/`window` API added to app code (`agents.md` §1).
