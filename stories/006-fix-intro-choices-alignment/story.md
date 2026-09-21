# Fix intro-choices alignment: three mode icons in one row

## Context

The voice-first mode chooser (`src/components/widgets/IntroChoices.jsx`) renders three circular buttons: phone (`#audioOnlyButton`), camera (`#continueButton`), and keyboard (`#textOnlyButton`). They must sit in a single horizontal row, as they did before the voice-first refactor (`74694c0`, pre-regression blob `eff7f37`: all three were direct children of one `<div className="d-flex gap-3 align-items-center">`).

Commit `8583cc0` restored the always-visible keyboard icon (product decision: text mode never depends on the speech engine) but inserted it as a sibling of a nested voice-button row under an outer `d-flex flex-column` container. Result: the keyboard icon wraps onto a second line. Measured in-browser on the ready state:

- `#audioOnlyButton` / `#continueButton`: parent `d-flex gap-3 align-items-center`, `offsetTop = 24`
- `#textOnlyButton`: parent `d-flex flex-column gap-2 align-items-center` (`#state-intro-choices`), `offsetTop = 92`

This is the second keyboard-icon regression in this component; this story restores the single-row layout and locks it with an automated geometry test so a third re-introduction is prevented.

## Out of Scope

- No change to which modes exist, their click handlers, PostHog tracking (`text_mode_fallback_selected`, `speech_engine_retry`), or the always-visible-keyboard product rule (`agents.md` §6).
- No change to the engine-failed recovery panel layout (`#speechEngineFailedText` + `#retryEngineButton` + `#textOnlyButton`). It has no three-icon chooser, so it stays stacked as-is.
- No change to strings, `speech-ui-state.js`, `getSpeechUiState`, or the Whisper engine lifecycle.
- No change to `app.css` sizing/glow (`.call-btn`, `.call-icon`, `#state-intro-choices #continueButton`) and no changes to other widgets that use `call-btn`/`call-icon` (`DecisionButtons`, `ViewAndContinueButtons`, `MicrophoneToggle.web.jsx`, `LessonContainer`, `TutorialModal`).
- No new dependencies.

## Implementation approach

Single file: `src/components/widgets/IntroChoices.jsx`. No CSS changes — the existing `.call-btn` / `.call-icon` rules already produce the 60×60 circles and the center glow selector `#state-intro-choices #continueButton` (`app.css:975`) matches regardless of how many wrappers are around the row.

1. Change `voiceButtons` to return a fragment so its two buttons become direct children of whatever row they are placed in (instead of a wrapping `<div>`):

```jsx
const voiceButtons = (disabled) => (
    <>
        <button className="btn call-icon" id="audioOnlyButton" aria-label="Audio Only" onClick={handleAudioClick} disabled={disabled}>
            <i className="bi bi-telephone-fill text-white"></i>
        </button>
        <button className="btn call-btn" id="continueButton" aria-label="Video Call" onClick={handleVideoClick} disabled={disabled}>
            <i className="bi bi-camera-video-fill"></i>
        </button>
    </>
);
```

2. Ready state — restore the exact pre-regression markup, with all three buttons as direct children of one row carrying `#state-intro-choices`:

```jsx
return (
    <div className="d-flex gap-3 align-items-center" id="state-intro-choices">
        {voiceButtons(false)}
        {textOnlyBtn}
    </div>
);
```

3. Loading / slow state — keep the outer `flex-column` (it holds the spinner + status text below the row), but wrap the three icons in their own row:

```jsx
<div className="d-flex flex-column gap-2 align-items-center" id="state-intro-choices">
    <div className="d-flex gap-3 align-items-center">
        {voiceButtons(true)}
        {textOnlyBtn}
    </div>
    <div className="text-center small text-white-50" id="speechEngineStatusText" ...>...</div>
    ...
</div>
```

4. Failed state — unchanged.

Rules and decisions:

- Button order is preserved from the pre-regression markup: phone → camera → keyboard, i.e. `audioOnlyButton` < `continueButton` < `textOnlyButton` left-to-right.
- `gap-3` (1rem) is the row gap between all three; this restores the even spacing the single-row markup had. Do not achieve the row with a CSS-only override on the outer `flex-column` (that would leave the video↔keyboard gap at `gap-2`, uneven with audio↔video).
- The keyboard button stays enabled in every state (including loading) per `8583cc0`.

## Tasks

### Task 1 — Restore the single-row mode chooser

- mode chooser rendered with the engine ready (`isWhisperReady = true`) + page loaded
  - → `#audioOnlyButton`, `#continueButton`, `#textOnlyButton` all exist and are visible
  - → all three share the same immediate parent element
  - → that parent's computed `display === 'flex'` and `flex-direction === 'row'`
  - → all three have the same `offsetTop`
  - → `offsetLeft` is strictly increasing in the order audio < continue < text
  - → each button's `offsetWidth === 60` and `offsetHeight === 60`
- mode chooser rendered while the engine is loading or slow (voice buttons disabled)
  - → the same single-row assertions hold for all three buttons
  - → `#audioOnlyButton` and `#continueButton` are disabled
  - → `#textOnlyButton` is enabled
  - → `#speechEngineStatusText` is visible and its `offsetTop` is greater than each button's `offsetTop` (status text renders below the icon row)
- mode chooser rendered with the engine failed
  - → `#speechEngineFailedText` and `#retryEngineButton` remain visible
  - → `#textOnlyButton` remains visible (recovery panel unchanged; no single-row assertion)

### Task 2 — Automated layout regression coverage

Add layout tests to `tests/whisper-engine-fallback.spec.js` (it already defines `dismissGuestModal` and `advanceToChooser` and reaches the chooser deterministically).

- Playwright spec reads each button's layout geometry via `page.evaluate`
  - → a ready-state test asserts the Task 1 ready-state single-row properties
  - → a loading-state test asserts the Task 1 loading-state properties (row + disabled voice buttons + status text below)
  - → `expect(new Set(offsetTops).size).toBe(1)` and `offsetLefts[0] < offsetLefts[1] < offsetLefts[2]` are used (not `getBoundingClientRect`) because `#continueButton` runs the `floatBob` transform animation
  - → running the updated spec against the fixed component passes
  - → the existing chooser visibility tests in the same file still pass

## Technical Context

- No new dependencies; no new packages to version.
- Verification gate is `npm test -- --run` (learnings: eslint/knip are not runnable in this repo). Playwright is a separate gate: `npx playwright test tests/whisper-engine-fallback.spec.js`. Playwright config (`playwright.config.js`) uses `baseURL: http://localhost:5173`, `webServer: npx vite --port 5173`, `workers: 1`, single `chromium` project.
- Reaching the chooser is already solved in `whisper-engine-fallback.spec.js`: hang `**r2.ultrafastfluency.com/whisper/onnx-community/**`, wait for `window.appStore?.getState()?.configData`, `dismissGuestModal`, click `#intro-call-widget`, wait for `bottomState === 'introChoices'`. Mark ready with `window.appStore.getState().setWhisperReady(true)` + `setWhisperEngineFailed(false)`; leave the model request hanging to keep the loading state.
- Use `offsetTop` / `offsetLeft` for row assertions: CSS transforms do not affect offset metrics, so the `floatBob` animation (`app.css:1018`, ±3px on `#continueButton`) cannot make the test flaky. `getBoundingClientRect()` includes the transform and is not safe here.
- In both states the three buttons share an offsetParent (the `.call-*` classes set `position: relative`; no row/column wrapper is positioned), so direct `offsetTop` comparison between the three and the status text is valid.
- The center-glow selector `#state-intro-choices #continueButton` (`app.css:975-990`) and PurgeCSS will keep matching: the ready row carries `id="state-intro-choices"`, and the loading row is nested inside `#state-intro-choices`.
- Regression provenance: `8583cc0` (restored keyboard icon, introduced the nested wrapper); pre-regression markup is at `74694c0^` / blob `eff7f37`.

## Notes

- Manual check: `npm run dev`, open `http://localhost:3000/course/model/lesson/w`, dismiss the guest modal, click `#intro-call-widget` → phone, camera, keyboard render on one line, centered, with the camera glow; while the engine loads, the same three icons are on one line with the spinner/status text underneath.
- The existing test title at `tests/whisper-engine-fallback.spec.js:50` still says "no text fallback" although it asserts `#textOnlyButton` is visible. Correct the title while editing the file (cosmetic, no behavior change).
- `docs/product.md` needs no change: this restores existing chooser behavior and adds no product capability.
- Keep the keyboard icon enabled and inside the row in every chooser state; do not re-disable or hide it while the engine loads.
