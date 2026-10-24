# Randomised celebration on every friend closed-response step advance

## Context

The success step celebrates with a confetti burst (`src/components/widgets/SuccessEffects.jsx`,
`canvas-confetti`, only when the lesson average is ≥ 90 via `shouldShowConfetti`). Nothing
celebrates the individual step, even though a friend-challenge lesson is a long run of
`friendClosedResponse` steps — the learner listens to a clip, repeats it, and the app
auto-advances with no feedback at all (`answer-pipeline.js`: "friendClosedResponse: on a
correct answer, auto-advance to the next step without the feedback step"). Those are the
moments the learner is doing the actual work, and they are silent.

The ask: a short celebratory burst at the end of each `friendClosedResponse` step —
i.e. while the app transitions to the next step — with **slightly randomised** effects
rather than the same fireworks/confetti every time. The existing success-step effect stays
exactly as it is, reserved for the success step.

Feasibility is confirmed against the installed library. `canvas-confetti@1.6.0` (already a
dependency, no version change) exposes: `particleCount`, `angle`, `spread`,
`startVelocity`, `decay`, `gravity`, `drift`, `ticks`, `x`/`y`/`origin`, `scalar`,
`zIndex`, `colors`, `disableForReducedMotion`, and `shapes` limited to
`'square' | 'circle' | 'star'`. That is enough for five visually distinct effects
(side cannons, star shower, fountain, double pop, drifting sparkles) with per-fire colour
palette and origin/spread/velocity jitter. Rich shapes (emoji text, custom paths) are
**not** in 1.6.0 — `shapeFromText`/`shapeFromPath` and `flat` arrived in 1.7+ — so they are
deliberately out of scope; see Notes for the upgrade path.

## Out of Scope

- Changing the success-step effect in any way (`SuccessEffects.jsx`,
  `shouldShowConfetti`, its 120-particle burst and its `lesson-complete-sound`).
- Sound effects for the step celebration: the burst fires at the instant the next step's
  clip may autoplay, and a sound there fights the Android capture-release / audio-route
  rules (`AGENTS.md`: "No media may start while a camera/microphone capture is open").
  The success effect keeps its sound; the step effect is silent.
- Celebrating `branching`, `viewAndContinue`, `lessonIntro`, `success`, `closedResponse` or
  `openResponse` steps, and celebrating a failed/retried attempt (only an advance counts).
- Throttling or a per-lesson budget: the request is one burst per `friendClosedResponse`
  step, and a lesson has many (up to ~40). The effects are deliberately short to suit that.
- Upgrading `canvas-confetti` to 1.9.x for richer shapes.
- A React Native counterpart (no `.native.jsx` file; the repo treats unwired native files
  as reference).
- Any user-visible copy, so no strings-table or translation work.

## Implementation approach

Three new source files and three new test files, plus small edits to five existing files
(`store.js`, `lesson-progression.js`, `LessonContainer.jsx`, `store.test.js`,
`lesson-progression.test.js`). Logic stays in pure modules; the component only subscribes
and delegates, per the repo's "logic lives in modules, never in components" rule.

### 1. Pure rules — `src/modules/lesson/step-celebration-logic.js`

No React, no DOM, no store; randomness is injected (defaulting to `Math.random`, evaluated
per call) so every rule is unit-testable:

- `CELEBRATION_PALETTES` — `{ ocean, sunset, classic, mint }`, each an array of 4–7 CSS
  colour strings (`classic` is the library's own default list so a fire can look like the
  familiar confetti).
- `CELEBRATION_VARIANTS` — an array of `{ id, bursts: [{ options, delayMs }] }`:

  | id | bursts (`options`, all get `origin`) |
  | --- | --- |
  | `side-cannons` | 1: `particleCount 40, angle 58, spread 55, startVelocity 52, decay 0.9, gravity 1, ticks 130, scalar 0.9, origin {x:0.06,y:0.78}`, `delayMs 0`; 2: same with `angle 122, origin {x:0.94,y:0.78}`, `delayMs 90` |
  | `star-shower` | 1: `particleCount 45, shapes ['star'], spread 360, startVelocity 26, decay 0.91, gravity 0.9, ticks 160, scalar 1.1, origin {x:0.5,y:0.4}`, `delayMs 0` |
  | `fountain` | 1: `particleCount 70, angle 90, spread 65, startVelocity 55, decay 0.89, gravity 1.2, ticks 150, scalar 1, origin {x:0.5,y:0.97}`, `delayMs 0` |
  | `double-pop` | 1: `particleCount 35, spread 360, startVelocity 32, decay 0.92, gravity 1, ticks 120, scalar 0.9, origin {x:0.42,y:0.45}`, `delayMs 0`; 2: same with `origin {x:0.58,y:0.55}`, `delayMs 130` |
  | `sparkle-drift` | 1: `particleCount 60, shapes ['circle'], spread 140, startVelocity 22, decay 0.9, gravity 0.55, drift 0.5, ticks 180, scalar 0.7, origin {x:0.5,y:0.55}`, `delayMs 0` |

- `pickCelebrationVariant(previousIndex, random = Math.random)` → `{ index, variant }`.
  Exactly **one** `random()` call. `valid = Number.isInteger(previousIndex) && previousIndex >= 0 && previousIndex < CELEBRATION_VARIANTS.length`;
  `index = valid ? (previousIndex + 1 + Math.floor(roll * (count - 1))) % count : Math.floor(roll * count)`.
  So the same variant is never picked twice in a row (while `count > 1`), and the first pick
  is uniform.
- `buildCelebrationPlan(variantIndex, random = Math.random)` → `[{ options, delayMs }]`.
  Never mutates `CELEBRATION_VARIANTS` (each burst gets a fresh `options`/`origin` object).
  Randomisation order is fixed so tests are deterministic: (1) palette index
  `Math.floor(random() * paletteKeys.length)`; (2) for each burst in order — `origin.x`
  jitter, `origin.y` jitter, `spread` jitter, `startVelocity` jitter. Jitters are
  `(random() * 2 - 1) * max` with `max` = 0.04 (origin, then clamped to `[0.03, 0.97]`),
  6 (spread, clamped to `[10, 360]`), 4 (`startVelocity`, clamped to `[10, 80]`). Every
  burst's options gain `colors: <palette>`, `zIndex: 100` (the library default the success
  effect already uses, so both draw on the same body-level canvas), and
  `disableForReducedMotion: true`.
- `shouldCelebrateStepEnd(step)` → `step?.responseType === 'friendClosedResponse'`.

### 2. The browser runner — `src/modules/lesson/step-celebration.web.js`

Side-effect module (explicitly `.web.js`, like the other DOM-touching modules), dependency
injected so jsdom tests never touch a real canvas:

```
runStepCelebration({ trigger, loadConfetti = () => import('canvas-confetti'),
                     random = Math.random,
                     schedule = (fn, ms) => setTimeout(fn, ms) })
```

- returns `null` when `trigger` is not a positive finite number, or equals the last handled
  trigger (the **StrictMode / duplicate-effect guard**; `src/main.jsx` wraps the app in
  `React.StrictMode`, so every mount effect runs twice);
- otherwise remembers the trigger, picks a variant with
  `pickCelebrationVariant(_lastVariantIndex, random)` (module-level `_lastVariantIndex`,
  starts at `-1`), builds the plan, awaits the loader, and `schedule`s one call per burst
  with the library's default export (`mod.default || mod`), each wrapped in its own
  `try/catch` that warns `[StepCelebration] burst failed: <message>` — a throw inside a
  `setTimeout` callback is otherwise an uncaught error, and the remaining bursts must
  still run;
- logs the success path (`[StepCelebration] variant=<id> bursts=<n>`), lets a loader
  rejection propagate to the caller (the component logs it);
- exports `resetStepCelebrationState()` (test seam only).
- Must import the library **dynamically** (`import('canvas-confetti')`) so the chunk stays
  lazy exactly as it is today.
- Must **not** call `confetti.reset()`: the singleton canvas is shared with the success
  effect, and resetting would kill a success burst in flight.

### 3. Store trigger — `src/modules/store/store.js`

- state: `stepCelebrationTrigger: 0` (next to `pointLossTrigger`), plus the action
  `triggerStepCelebration: () => set((state) => ({ stepCelebrationTrigger: state.stepCelebrationTrigger + 1 }))`.
- **`stepCelebrationTrigger` must NOT be reset** by `resetForNextStep`, `resetForNewLesson`
  or `resetStepState`. It is a monotonically increasing id the runner dedupes on; resetting
  it to 0 would make every step's trigger `1` and the guard would swallow every burst after
  the first. `resetForNextStep` runs at the top of `loadNextStep`, so the dispatch also
  happens after it.

### 4. Fire on the advance — `src/modules/lesson/lesson-progression.js`

`loadNextStep(currentStep, …)` is the single seam every step advance goes through (the
`friendClosedResponse` auto-advance in `answer-pipeline.js` and the fallback Continue widget
both call it), and it already imports the store. At the **end** of `loadNextStep` (after the
`if (nextStep) { … }` block, before the closing brace), add:

```
if (shouldCelebrateStepEnd(currentStep)) {
    appStore.getState().triggerStepCelebration();
}
```

which fires after the new step has been loaded, so the burst overlays the transition into
the next step. The last `friendClosedResponse` step of a lesson advances into the success
step, whose own effect fires later (after the success clip plays) — the two are separate
moments and both stay; no suppression rule.

### 5. The effect component — `src/components/widgets/StepCelebration.jsx`

Render-only side-effect component (same shape as `SuccessEffects.jsx`/`PointLossOverlay.jsx`)
that subscribes to `stepCelebrationTrigger`, calls `runStepCelebration({ trigger })` in an
effect keyed on the trigger, and returns `null`. Mounted once in
`src/components/LessonContainer.jsx` next to `<PointLossOverlay />`.

- **No cleanup function.** A cleanup would cancel the pending burst timers on StrictMode's
  test-unmount, and the second effect run is swallowed by the dedupe guard — so the
  celebration would never fire in dev. The timers must be left to run.
- No `Math.random`, no confetti options and no branching in the component: the runner and
  the pure module own all of it.

### 6. Bookkeeping

Add every touched path to `src/modules/video/recorder-page.test.js`'s per-story `allowlist`
(its guard runs `git diff --name-only HEAD` and also fails on any untracked file), and
`git add` new files before running the suite so the tracked/untracked assertions see them.
No new file under `public/`. No test file under `src/**` may contain the literal
`/recorder` or `recorder.html`.

## Tasks

### Task 1 - Pure celebration rules

- `CELEBRATION_VARIANTS` + `pickCelebrationVariant(-1, () => 0)` → returns `{ index: 0 }`; with `() => 0.999` → the last index (uniform first pick).
- `pickCelebrationVariant(previousIndex, random)` for every `previousIndex` in the list and rolls `0`, `0.5`, `0.999` → `index !== previousIndex`; out-of-range/`undefined`/`null`/`NaN` previous → falls back to a uniform pick in `[0, count)`.
- `CELEBRATION_VARIANTS.length >= 4` and every variant id is unique → asserted, so "different effects" cannot silently collapse to one.
- `buildCelebrationPlan(index, () => 0.5)` → jitters are exactly 0, so `origin.x/origin.y/spread/startVelocity` equal the variant's own numbers; with `() => 0` and `() => 0.999` → each jitter is at its `-max`/`+max` and every value stays inside its clamp range.
- Every planned burst → has `delayMs >= 0`, `colors` equal to one of `CELEBRATION_PALETTES`, `zIndex === 100`, `disableForReducedMotion === true`, `shapes` (when present) drawn only from `['square','circle','star']`.
- `buildCelebrationPlan` called twice with different randoms → the two plans differ, and `CELEBRATION_VARIANTS` is deep-equal to a snapshot taken before the calls (no mutation of the exported constants).
- `shouldCelebrateStepEnd` → `true` for `{ responseType: 'friendClosedResponse' }` (with and without `simpleVideoUrl`), `false` for `closedResponse`, `openResponse`, `branching`, `viewAndContinue`, `lessonIntro`, `success`, `null`, `undefined`.

### Task 2 - Browser runner

- `runStepCelebration({ trigger: 0 | -1 | undefined | NaN, loadConfetti: stub })` → returns `null` and the stub is never called.
- `runStepCelebration({ trigger: 3, loadConfetti: stub, schedule: fakeSchedule })` → the loader stub is called exactly once, and `fakeSchedule` received exactly one task per burst of the picked variant, in plan order, with the planned `delayMs`; running the scheduled callbacks calls the fired function with each burst's `options` object.
- Same trigger twice (StrictMode double effect) → the second call returns `null` and the fired function is called only once per burst (proven by count, with `resetStepCelebrationState()` in `beforeEach`).
- Two different triggers in a row → two celebrations, and the second variant id differs from the first (`pickCelebrationVariant` no-repeat rule observed end to end).
- A loader that rejects → `runStepCelebration` rejects (the caller logs it) and a later trigger still produces a celebration.
- A fired function that throws on the first burst → `runStepCelebration` still resolves, the later bursts of that plan are still scheduled and run, and exactly one `console.warn` containing `[StepCelebration] burst failed` is logged (spy on `console.warn`).
- The real `canvas-confetti` is never imported by the test: the runner is always called with an injected loader (jsdom has no canvas).
- Source guard in `step-celebration-wiring.test.js`: `step-celebration.web.js` contains `import('canvas-confetti')` and has **no static** `import … from 'canvas-confetti'` (assert on raw source with a line-anchored pattern `/^import[^\n]*canvas-confetti/m`), and does not call `.reset()`.

### Task 3 - Store trigger and reset immunity

- `appStore.setState({ stepCelebrationTrigger: 0 })` then `triggerStepCelebration()` twice → the value is `1`, then `2`.
- `appStore.setState({ stepCelebrationTrigger: 7 })` + `resetForNextStep()` → still `7`; the same for `resetForNewLesson()` and `resetStepState()`.

### Task 4 - Fire on the friend closed-response advance

- `loadNextStep({ responseType: 'friendClosedResponse' }, null, deps)` → `stepCelebrationTrigger` increases by exactly 1 (read the value before and assert the delta; the shared appStore is not reset between tests in `lesson-progression.test.js`).
- `loadNextStep({ responseType: 'closedResponse' | 'openResponse' | 'viewAndContinue' | 'branching' | 'success' }, null, deps)` → the trigger is unchanged.
- `loadNextStep` with `nextStep` pointing past the last step (lesson end, on a `makeLesson` fixture with no `nextLessonId`) → the trigger still increases by exactly 1 for the `friendClosedResponse` step.
- Source guard in `step-celebration-wiring.test.js`, on the `loadNextStep` slice only (from `indexOf('function loadNextStep')` to `indexOf('// Branching navigation')`): it imports `shouldCelebrateStepEnd` from `./step-celebration-logic.js`, and `region.indexOf('resetForNextStep()') < region.indexOf('shouldCelebrateStepEnd(') < region.indexOf('triggerStepCelebration(')` — proving the dispatch is inside the advance path and after the reset.

### Task 5 - Render the effect once, keep the success effect untouched

- Source guard: `LessonContainer.jsx` imports `./widgets/StepCelebration.jsx` and renders `<StepCelebration />` exactly once (`match(/<StepCelebration \/>/g).length === 1`).
- Source guard: `StepCelebration.jsx` contains `stepCelebrationTrigger` and `runStepCelebration`, returns `null` (`toContain('return null')`), and contains no `Math.random`, no `canvas-confetti` and no `setTimeout` (the runner owns scheduling) and no confetti option names such as `particleCount`.
- Source guard: `SuccessEffects.jsx` still imports `shouldShowConfetti`, still calls `import('canvas-confetti')`, and still fires `particleCount: 120`, `spread: 80`, `origin: { y: 0.6 }` — the success effect is unchanged, so it is not a second consumer of the new variants.

### Task 6 - Integration bookkeeping

- Every path the diff touches is present in `recorder-page.test.js`'s `allowlist`, and `git status --porcelain` reports no untracked file.
- `npx vitest run` is green, `npm run lint` is clean, and `npm run build` succeeds (the confetti chunk stays a separate lazy chunk).

## Technical Context

- `canvas-confetti@1.6.0` — already a dependency (`package.json`), **no version change**. Installed API verified in `node_modules/canvas-confetti/dist/confetti.module.mjs`: default `fire(options)`, `create(canvas, globalOpts)`, `reset()`; option keys are `particleCount, angle, spread, startVelocity, decay, gravity, drift, ticks, x, y, origin, shapes (square|circle|star), zIndex, colors, disableForReducedMotion, scalar`. `flat`, `shapeFromText` and `shapeFromPath` do **not** exist in 1.6.0.
- `React 19.2.0` with `React.StrictMode` (`src/main.jsx`) — mount effects run twice in development, hence the trigger dedupe.
- `vitest@4` with `environment: 'jsdom'` (`vitest.config.js`) — jsdom has no canvas 2D context, so the runner's loader must always be injected in tests.
- `zustand@5` — `appStore` is the single store; the transient trigger follows the existing `pointLossTrigger` / `mediaClearTrigger` pattern.
- The library appends one `position: fixed`, `pointer-events: none`, `z-index: 100` canvas to `document.body`, shared by every `fire()` call in the page — the same canvas the success effect already uses, so both effects can overlap without a second canvas, and the `pointer-events: none` canvas never steals a tap from the mic/answer controls.

## Notes

- **Frequency is intentional and high**: a friend-challenge lesson has ~12–40 `friendClosedResponse` steps (lesson `b` of `wouldyourather` has 41), so the bursts are tuned short (120–180 ticks, 35–80 particles per burst) rather than the success effect's 120-particle / 200-tick burst. If it reads as too much in review, the knob is `CELEBRATION_VARIANTS`, not the trigger.
- **Reduced motion**: every burst sets `disableForReducedMotion: true`, so a `prefers-reduced-motion` learner gets no celebration at all (the library resolves the fire without drawing). The success effect intentionally keeps its current behaviour.
- **Whole-window canvas**: the burst is drawn over the viewport, not clipped to the 9:16 `.video-frame`, exactly like the success effect. On desktop it plays over the frame's black surround; the bottom overlay (`z-index: 1050`) paints above the canvas, which is wanted — the answer/mic controls stay readable under the burst.
- **Prove every new source guard can fail** before trusting it (repo standing rule): inject the forbidden text (or delete the asserted line) and confirm the *specific* guard goes red, then restore with `git checkout -- <path>` after `git add` — a `cp` backup can itself be captured mid-mutation.
- **No sound, no strings, no analytics**: the burst is decorative; nothing is localized and no PostHog event is added (the existing `step_completed` event already covers the transition).
- If richer effects are wanted later (emoji/custom-path shapes, `flat` 3D discs), that requires `canvas-confetti@1.9.4` (`npm view canvas-confetti version` → `1.9.4`, ~92 KB unpacked); it is a drop-in option-level change to `step-celebration-logic.js` and a separate story.
