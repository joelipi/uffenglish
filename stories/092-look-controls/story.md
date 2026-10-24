# Friend-closed-response preview screen: look controls and per-step overlays

## Context

The friend-closed-response step is the moment a learner records the clip a friend will watch. It currently jumps straight from the step's call-to-action into a 3-2-1 countdown and starts recording, leaving no time to check how they look.

This story gives that step a proper **preview screen**: the step's call-to-action becomes **Continue**, which opens the full-screen camera preview. There the learner sees themselves with the phrase to repeat and the usual warning still on screen, picks a **filter** and up to three **overlays** (Face / Above face / Lower), drags them where they want them, and only then taps the microphone to start recording. The 3-2-1 countdown is removed **for this step only**, because the preview screen already gives them all the time they need.

A step can also ship default overlays from the lesson config (`overlays.face` / `.upper` / `.lower`), which is how a themed step gets its witch hat and cauldron without the learner choosing anything.

Nothing here tracks a face. "Face" and "Above face" are fixed anchor zones on the canvas; the learner frames their own head behind them, exactly like the stationary props shipped in the parent story (091).

## Out of Scope

- Face tracking of any kind. The parked tracker (090) stays parked and must not be imported.
- Every response type other than `friendClosedResponse` — their flow and their 3-2-1 countdown are unchanged.
- Real artwork. Placeholder PNGs under `public/overlays/face/` and `public/overlays/props/` are shipped deliberately; they are replaced by filename later.
- Instagram's literal filter names (trademarks) — descriptive names only.
- Persisting looks across lessons or to the server. A look lives in memory for the current lesson session.

## Implementation approach

- **Pure module** `src/modules/looks/recording-looks-logic.js` owns every rule: the filter preset table, the overlay library (slug → slot + file), the three slot ids, the anchor defaults, the selection sanitiser, the step-config reader, and the merge that applies a step's config once without carrying it forward.
- **Filter presets** are Canvas2D blend-mode recipes (`saturation` for mono, `screen`/`multiply` tints for warm/cool/vintage, an `overlay` pass for vivid) plus the beauty levers from 091, so there is no GL context and no `ctx.filter` (which is a no-op on iOS). Preset ids: `none`, `natural`, `warm`, `cool`, `soft`, `mono`, `vintage`, `vivid`; default `none`, so a learner who picks nothing gets an untouched camera frame and the picker shows **None** selected. Filters are a radio group with an explicit off: one at a time, and tapping the applied filter clears it back to `none` (`toggleFilterId`).
- **The picker must show which filter is applied, and only that one**: the applied chip gets the green ring, a tint and a check badge (`aria-pressed="true"`), while an unapplied chip stays flat. On the rail, **white = this drawer is open, green = something is applied**, so a folded-out drawer never reads as "a filter is selected".
- **Lens effects are a third kind of control**, next to the colour filter and the prop slots: a whole-frame optical treatment (soft focus, chiaroscuro) rather than a prop placed in the frame. They get their **own rail box** (`Lens`) and their own selection key, so a filter and a lens effect can be applied together (Vintage + Chiaroscuro) and both coexist with the three prop slots. The category is named for the standard term: a camera *lens effect* (Snapchat/Samsung camera call this strip "Lens"; cinema calls soft focus a diffusion filter and chiaroscuro lighting — the umbrella is the lens/camera effect).
  - `LENS_PRESETS`: `none`, `softfocus`, `chiaroscuro`; default `none`, same radio-with-off rule as filters (`toggleLensId`).
  - No face tracking: each is one canvas-wide pass centred on the assumed face zone (`SLOT_ANCHORS.face`, 50% / 42%), which is exact enough because the composite canvas is always the same 9:16 frame.
  - The two effects reuse the 091 painters through the injected `paintBeauty` callback (`BEAUTY_PRESETS.lensSoftFocus` = strong downscale bloom + fill light; `lensChiaroscuro` = lit centre + 0.78 vignette), so there is no `ctx.filter` and no new blur technique. They are painted **after the colour grade and under the props** (`paintLooks` step 3).
- **A tapped option must not keep the native focus ring.** On iOS Safari a `<button>` keeps its focus ring (and its default button chrome) after a tap, so an option the learner had tapped and then abandoned still looked outlined — reported twice as "the white border stays on the previous option". Every picker button now carries `look-tap` (`.look-tap` in `app.css`: `appearance: none`, `-webkit-tap-highlight-color: transparent`, `:focus { outline: none }`, `:focus-visible` keeps a 2px green keyboard cue) and a pointer activation releases focus (`releaseFocusAfterPointerTap`, `event.detail > 0` only, so tab navigation keeps its focus).
- **Three overlay slots** — `face`, `upper`, `lower` — each holding at most one asset slug plus its own user tuning (`dx`, `dy` as fractions of the canvas, `scale`). Anchor defaults stay clear of the top header blur and bottom mic band: `face` centred at 42% height, `upper` centred at 22% height, `lower` centred at 74% height. Drawing order is face → upper → lower so a lower prop never covers a face cover.
- **Selection lives in the zustand store** (`lookSelection`, `lookTuning`, `lookActiveSlot`, `lookOpenDrawer`) and is read per frame by the recording composite, so a change repaints the live preview and is baked into the take because it is the same canvas.
- **Config** per step:
  ```json
  "overlays": { "face": { "asset": "smiley" }, "upper": { "asset": "witchhat" }, "lower": { "asset": "cauldron" } }
  ```
  Assets are slugs from the registry, never paths. A step's config overlays are applied when the step's preview first opens and are **not** re-applied on later steps; the learner's own later choices persist for the rest of the lesson.
- **Two-step flow**: on `friendClosedResponse` steps, the decision button in `ResponseDecisionButtons` / `DecisionButtons` shows the `continue` label and rightward chevron icon (`bi-chevron-right`). Tapping it acquires the camera stream, enters `recording/answering` with `awaitingRecordingStart: true` and `isMicActive: false`, and returns immediately so the bottom `#micBtn` (`MicrophoneToggle`) is ready. Tapping `#micBtn` clears `awaitingRecordingStart`, skips the 3-2-1 countdown, and starts recording immediately; tapping `#micBtn` again stops recording as usual.
- **Retry goes through the same gate**: an incorrect answer on a `friendClosedResponse` step replays the step's clip (`resolveRetryPhase` in `src/modules/lesson/retry-phase-logic.js`: `simpleVideo` for a simple clip, the interactive playback phase for an interactive one), so the clip's own end-of-playback transition raises the decision screen with Continue again on every attempt. The retry must never jump straight to the decision phase — that paints the gradient overlay over a clip that is still playing. Every other step keeps retrying on the recording screen.
- **The interactive decision phase is per response type**: `interactiveDecisionPhase(responseType)` in `src/modules/lesson/step-phase-logic.js` gives `friendClosedResponse` its own phase, which is what makes the interactive decision button read Continue; the overlay heading is derived from the step's response type (`getResponseOverlayTextKey`), so it still says "repeat exactly".
- **UI** (render-only components) `src/components/looks/LookControls.jsx` renders a compact vertical rail along the left edge (`top: 18%`, clear of the top blur, center face, subtitles, and bottom mic button) where each category (`Filter`, `Top`, `Face`, `Bottom`) folds out horizontally when tapped. Dragging on the mirrored `#webcam-preview` uses `computeDragOffset` (inverting horizontal `dx` for `scaleX(-1)`).

## Tasks

### Task 1 - Look rules (pure module)

- `resolveFilterId('')`, `resolveFilterId('neon')` + called in unit test
  - → returns the no-filter default `'none'`
- `resolveFilterId('mono')` + called in unit test
  - → returns `'mono'`
- `toggleFilterId(currentId, clickedId)` + called in unit test
  - → choosing another filter replaces it (one at a time); tapping the applied filter returns `'none'`; `'none'` always returns `'none'`
- `isLookActive(selection)` + called in unit test
  - → `false` for `none` (and for `none` + slots), `true` for any chosen filter
- `paintLooks(...)` with the `none` selection + called in unit test
  - → paints no beauty pass and no colour grade
- `isPreviewGateStep({ responseType: 'friendClosedResponse' })` and `({ responseType: 'openResponse' })` + called in unit test
  - → `true` and `false` respectively
- `sanitizeSelection` with an unknown filter id and unknown slugs + called in unit test
  - → falls back to `none` and `null` per slot, never throws
- `parseStepOverlays` with the three documented keys + called in unit test
  - → returns `{ face: 'smiley', upper: 'witchhat', lower: 'cauldron' }`
- `parseStepOverlays` with an unknown slug, a missing object, or a non-object + called in unit test
  - → drops the unknown slug, returns all-null for the others
- `applyStepOverlays(selection, stepOverlays)` + called in unit test
  - → fills only the slots the step declares and leaves the learner's other slots untouched
- `resolveSlotAnchor('face'|'upper'|'lower', canvasWidth, canvasHeight)` + called in unit test
  - → returns the documented default centre for each slot
- `resolveSlotDrawRect` with an asset + tuning (`dx`, `dy`, `scale`) + called in unit test
  - → applies the tuning on top of the anchor, keeps the asset's aspect ratio, and stays inside the canvas
- `resolveSlotDrawRect` with no tuning + called in unit test
  - → equals the anchor default at scale 1

### Task 2 - Filter selection in the store

- `toggleLookFilter('warm')` on a fresh store, then `toggleLookFilter('mono')` + called in unit test
  - → `lookSelection.filterId` is `'warm'` then `'mono'` (one at a time, starting from `none`)
- `toggleLookFilter('warm')` twice + called in unit test
  - → the second tap returns the selection to `'none'` and leaves the overlay slots untouched

### Task 3 - Lens effects (their own category)

- `LENS_PRESETS` / `DEFAULT_LENS_ID` + called in unit test
  - → ids are `['none', 'softfocus', 'chiaroscuro']`, default is `'none'`, and `none` has no `beautyMode`
- `resolveLensId('neon')` and `sanitizeSelection({ lensId: 'neon' })` + called in unit test
  - → both fall back to `'none'`, while a valid `lensId` survives
- `toggleLensId(current, clicked)` + called in unit test
  - → one lens at a time, and tapping the applied lens clears it back to `'none'`
- `isLookActive({ filterId: 'none', lensId: 'softfocus' })` + called in unit test
  - → `true`, so a lens alone still switches the recording to the composite canvas
- `paintLooks` with a filter **and** a lens + called in unit test
  - → calls the beauty painter for the filter preset, then for the lens preset (`['soft', 'lensChiaroscuro']`), and returns `{ filter: 'vintage', lens: 'chiaroscuro', … }`
- `BEAUTY_PRESETS.lensSoftFocus` / `lensChiaroscuro` + called in unit test
  - → every lever is within 0…1, soft focus blurs harder than any filter preset, and chiaroscuro's vignette is heavier than any filter preset's
- `paintBeautyPass({ mode: 'lensSoftFocus' | 'lensChiaroscuro' })` + called in unit test
  - → paints at least one pass for each, and paints nothing for `none`
- `toggleLookLens('softfocus')` on the store, then `toggleLookFilter('vintage')` + called in unit test
  - → both selections hold at once; a second `toggleLookLens` clears only the lens

### Task 4 - The tester can tell which build is running (and a deploy reaches them)

- `resolveBuildId(import.meta.url)` / `formatBuildLog` in `src/modules/utils/build-id.js` + called in unit test
  - → returns the entry chunk's hashed file name (`main-abc.js`), `'dev'` on the Vite dev server, `'unknown'` for junk — never throws
  - → `main.jsx` logs `[Build] <entry chunk>` once at boot, so the running build is readable off the eruda console
- `vite.config.js` sets `workbox.skipWaiting: true` + inspected in the built `sw.js`
  - → a new deploy activates its worker on install, so the next navigation serves the new shell (a page is never claimed mid-recording, because `clientsClaim` stays off)

### Task 4b - No native focus ring left on a tapped option (iOS)

- `LookControls.jsx` source + called in unit test (`look-controls-focus.test.js`)
  - → every `<button>` in the picker carries `look-tap`, so a new control cannot silently keep iOS Safari's focus ring/button chrome
- `app.css` source + called in unit test
  - → `.look-tap` sets `-webkit-appearance: none`, `appearance: none` and `-webkit-tap-highlight-color: transparent`; `.look-tap:focus` sets `outline: none`; `.look-tap:focus-visible` still paints a 2px green keyboard cue
- `releaseFocusAfterPointerTap` source + called in unit test
  - → releases focus only when `event.detail > 0` (pointer), so tab navigation keeps its focus

## Notes

- Deliberately no Playwright specs: the owner validates the flow on real devices.
- The recorder starts on the mic tap for this step. With no countdown, the first ~200ms captures the reach for the button; the trim machinery already exists if that reads badly.
- Drag is pointer-based on the preview wrapper and writes normalised offsets, so the same numbers work for the 720×1280 phone canvas and the 1080×1920 desktop one.
- Controls are hidden/disabled once recording begins — a mid-take change would pop visibly in the blob.
- Art must be PNG only (the repo forbids committed jpg/jpeg/mp4 under `public/`), listed in `recorder-page.test.js`'s allowlist, and excluded from the service-worker precache via `WORKBOX_IGNORES`.
