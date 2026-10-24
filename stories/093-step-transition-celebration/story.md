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
rather than the same fireworks/confetti every time, and **visibly different effects** (not
one burst re-coloured). The existing success-step effect stays exactly as it is, reserved
for the success step.

The installed `canvas-confetti@1.6.0` cannot produce varied enough effects: it has only
three built-in shapes (`square`, `circle`, `star`) and no way to add a custom one. The
capability exists in **1.9.4** (the current release), which adds `flat` (a no-tilt,
no-wobble particle), `confetti.shapeFromPath` (custom SVG-path shapes) and
`confetti.shapeFromText` (emoji/text). Upgrading is a two-file dependency change and every
option the existing success effect uses is unchanged in 1.9.4, so the upgrade is the first
step of this story and the success effect keeps working untouched.

With 1.9.4 the step celebration becomes seven visually distinct effects (side cannons,
star shower, fountain, heart drift, bolt pops, flat burst, sparkle drift) drawn from
built-in shapes plus five custom paths (star, diamond, heart, sparkle, lightning bolt),
each fire also randomising its palette and its origin/spread/velocity jitter. Emoji
(`shapeFromText`) is deliberately not used — see Notes.

## Out of Scope

- Changing the success-step effect in any way (`SuccessEffects.jsx`,
  `shouldShowConfetti`, its 120-particle burst, its `lesson-complete-sound`). The upgrade
  must leave its output identical; it is re-verified, not redesigned.
- Emoji/text confetti (`shapeFromText`): it rasterises a bitmap, depends on the device's
  emoji font, and `new OffscreenCanvas` throws on browsers without it — see Notes.
- Sound effects for the step celebration: the burst fires at the instant the next step's
  clip may autoplay, and a sound there fights the Android capture-release / audio-route
  rules (`AGENTS.md`: "No media may start while a camera/microphone capture is open").
- Celebrating `branching`, `viewAndContinue`, `lessonIntro`, `success`, `closedResponse` or
  `openResponse` steps, and celebrating a failed/retried attempt (only an advance counts).
- Throttling or a per-lesson budget: the request is one burst per `friendClosedResponse`
  step, and a lesson has many (up to ~40). The effects are deliberately short to suit that.
- A React Native counterpart (no `.native.*` file; the repo treats unwired native files as
  reference) and any user-visible copy (no strings-table or translation work).

## Implementation approach

Three new source files and three new test files, the dependency bump, plus small edits to
five existing files (`store.js`, `lesson-progression.js`, `LessonContainer.jsx`,
`store.test.js`, `lesson-progression.test.js`). Logic stays in pure modules; the component
only subscribes and delegates, per the repo's "logic lives in modules, never in components"
rule.

### 1. Upgrade `canvas-confetti` 1.6.0 → `^1.9.4`

`npm install canvas-confetti@1.9.4` (npm writes the caret range). Only two tracked files
change: `package.json` (`"canvas-confetti": "^1.6.0"` → `"^1.9.4"`) and
`package-lock.json` (the root dependency range plus the single `node_modules/canvas-confetti`
entry: version / resolved URL / integrity). **Review `git diff package-lock.json` before
committing** — no other entry may move.

Facts verified against the published 1.9.4 tarball (see Technical Context for how):

- Every option the success effect passes (`particleCount`, `spread`, `origin`, `colors`) is
  still read by `prop(options, …)` with the same defaults, so its burst is unchanged.
- The module build Vite resolves (`dist/confetti.module.mjs`) exports **only** `default` and
  `create`. `shapeFromPath`, `shapeFromText` and `reset` are properties of the **default
  export function**, so the runner must reach them as `api.shapeFromPath(...)` on
  `mod.default` — destructuring them from the module namespace yields `undefined`.
- `shapeFromPath({ path, matrix })` returns a plain `{ type: 'path', path, matrix }`, where
  `path` is a string, so it survives the library's default `useWorker: true` postMessage
  (the worker re-creates the `Path2D` when drawing). Passing an explicit `matrix` skips the
  helper's expensive per-path `isPointInPath` scan, which the README recommends caching
  anyway (the matrix is deterministic for a given path).
- `shapeFromPath` throws (`path confetti are not supported in this browser`) when
  `Path2D`/`DOMMatrix` are missing, so every resolve is guarded with a built-in-shape
  fallback.

The worktree's `node_modules` is a symlink to the main checkout's, so the install updates
the shared tree — expected; it must still leave this worktree's lockfile as the only
tracked change.

### 2. Custom shape registry — inside the pure module

`CELEBRATION_PATHS` maps a key to `{ path, matrix }` for five shapes, all authored inside a
0–10 design box so **every** matrix is the same `[1, 0, 0, 1, -5, -5]` (the value the helper
would compute for a 10×10 path: `scale = 1`, translate `-width/2`, `-height/2`):

| key | `path` |
| --- | --- |
| `star` | `M5 0 L6.18 3.55 L10 3.55 L6.9 5.9 L8.09 9.51 L5 7.2 L1.91 9.51 L3.1 5.9 L0 3.55 L3.82 3.55 Z` |
| `diamond` | `M5 0 L10 5 L5 10 L0 5 Z` |
| `heart` | `M5 10 L0.9 5.6 C-0.6 3.7 0.6 0.6 3 0.6 C4.1 0.6 4.8 1.3 5 1.9 C5.2 1.3 5.9 0.6 7 0.6 C9.4 0.6 10.6 3.7 9.1 5.6 Z` |
| `sparkle` | `M5 0 L6 4 L10 5 L6 6 L5 10 L4 6 L0 5 L4 4 Z` |
| `bolt` | `M6 0 L1 6 L4.5 6 L3 10 L9 3.5 L5.5 3.5 Z` |

These are **data only** — no `Path2D`, no DOM, no library call — so the pure module stays
importable under jsdom (which has neither `Path2D` nor `DOMMatrix`).

### 3. Pure rules — `src/modules/lesson/step-celebration-logic.js`

No React, no DOM, no store; randomness is injected (defaulting to `Math.random`, evaluated
per call) so every rule is unit-testable:

- `CELEBRATION_PALETTES` — `{ ocean, sunset, classic, mint }`, each an array of 4–7 CSS
  colour strings (`classic` is the library's own default list so a fire can look like the
  familiar confetti).
- `CELEBRATION_VARIANTS` — an array of `{ id, bursts: [{ options, customShapes, delayMs }] }`,
  where `options.shapes` holds built-in shape strings and `customShapes` holds
  `CELEBRATION_PATHS` keys (the runner merges the two into one `shapes` array):

  | id | bursts |
  | --- | --- |
  | `side-cannons` | 1: `{particleCount 40, angle 58, spread 55, startVelocity 52, decay 0.9, gravity 1, ticks 130, scalar 0.9, origin {x:0.06,y:0.78}, shapes ['square','circle']}`, `customShapes ['diamond']`, `delayMs 0`; 2: same with `angle 122, origin {x:0.94,y:0.78}`, `delayMs 90` |
  | `star-shower` | 1: `{particleCount 40, spread 360, startVelocity 26, decay 0.91, gravity 0.9, ticks 160, scalar 1.15, origin {x:0.5,y:0.4}, shapes []}`, `customShapes ['star']`, `delayMs 0` |
  | `fountain` | 1: `{particleCount 70, angle 90, spread 65, startVelocity 55, decay 0.89, gravity 1.2, ticks 150, scalar 1, flat true, origin {x:0.5,y:0.97}, shapes ['circle','square']}`, `customShapes []`, `delayMs 0` |
  | `heart-drift` | 1: `{particleCount 32, spread 120, startVelocity 24, decay 0.93, gravity 0.6, drift 0.55, ticks 200, scalar 1.1, flat true, origin {x:0.5,y:0.85}, shapes []}`, `customShapes ['heart']`, `delayMs 0` |
  | `bolt-pops` | 1: `{particleCount 30, spread 360, startVelocity 30, decay 0.92, gravity 1, ticks 120, scalar 1, origin {x:0.4,y:0.45}, shapes []}`, `customShapes ['bolt','sparkle']`, `delayMs 0`; 2: same with `origin {x:0.6,y:0.55}`, `delayMs 110` |
  | `flat-burst` | 1: `{particleCount 55, spread 360, startVelocity 34, decay 0.91, gravity 1, ticks 140, scalar 1.2, flat true, origin {x:0.5,y:0.5}, shapes ['square','circle']}`, `customShapes []`, `delayMs 0` |
  | `sparkle-drift` | 1: `{particleCount 60, spread 140, startVelocity 22, decay 0.9, gravity 0.55, drift 0.5, ticks 180, scalar 0.8, origin {x:0.5,y:0.55}, shapes ['circle']}`, `customShapes ['sparkle']`, `delayMs 0` |

- `pickCelebrationVariant(previousIndex, random = Math.random)` → `{ index, variant }`.
  Exactly **one** `random()` call. `valid = Number.isInteger(previousIndex) && previousIndex >= 0 && previousIndex < CELEBRATION_VARIANTS.length`;
  `index = valid ? (previousIndex + 1 + Math.floor(roll * (count - 1))) % count : Math.floor(roll * count)`.
  So the same variant is never picked twice in a row (while `count > 1`), and the first pick
  is uniform.
- `buildCelebrationPlan(variantIndex, random = Math.random)` → `[{ options, customShapes, delayMs }]`.
  Never mutates `CELEBRATION_VARIANTS` (each burst gets a fresh `options`/`origin` object and
  a fresh `shapes` array). Randomisation order is fixed so tests are deterministic:
  (1) palette index `Math.floor(random() * paletteKeys.length)`; (2) for each burst in order
  — `origin.x` jitter, `origin.y` jitter, `spread` jitter, `startVelocity` jitter. Jitters
  are `(random() * 2 - 1) * max` with `max` = 0.04 (origin, then clamped to `[0.03, 0.97]`),
  6 (spread, clamped to `[10, 360]`), 4 (`startVelocity`, clamped to `[10, 80]`). Every
  burst's options gain `colors: <palette>`, `zIndex: 100` (the library default the success
  effect already uses, so both draw on the same body-level canvas), and
  `disableForReducedMotion: true`; `customShapes` passes through unchanged.
- `shouldCelebrateStepEnd(step)` → `step?.responseType === 'friendClosedResponse'`.

### 4. The browser runner — `src/modules/lesson/step-celebration.web.js`

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
  starts at `-1`), builds the plan, awaits the loader, and `schedule`s one burst per plan
  entry, each wrapped in its own `try/catch` that warns
  `[StepCelebration] burst failed: <message>` — a throw inside a `setTimeout` callback is
  otherwise an uncaught error, and the remaining bursts must still run;
- resolves the API as `const api = mod.default || mod` and fires with `api(options)`;
  `customShapes` are resolved **through that object** (`api.shapeFromPath(CELEBRATION_PATHS[key])`)
  and merged after `options.shapes`. Two guards, both non-fatal: when
  `typeof api.shapeFromPath !== 'function'` or a resolve throws, log once
  (`[StepCelebration] custom shapes unavailable: <message>`) and fire with the built-in
  shapes only;
- caches the resolved shape objects in module scope (`_shapeCache`, cleared by
  `resetStepCelebrationState()`), so `Path2D`/temp-canvas allocation happens once per page
  load rather than once per step;
- logs the success path (`[StepCelebration] variant=<id> bursts=<n>`), lets a loader
  rejection propagate to the caller (the component logs it);
- exports `resetStepCelebrationState()` (test seam: clears the handled trigger, the last
  variant index and the shape cache).
- Must import the library **dynamically** (`import('canvas-confetti')`) so the chunk stays
  lazy exactly as it is today.
- Must **not** call `api.reset()`: the singleton canvas is shared with the success effect,
  and resetting would kill a success burst in flight.

### 5. Store trigger — `src/modules/store/store.js`

- state: `stepCelebrationTrigger: 0` (next to `pointLossTrigger`), plus the action
  `triggerStepCelebration: () => set((state) => ({ stepCelebrationTrigger: state.stepCelebrationTrigger + 1 }))`.
- **`stepCelebrationTrigger` must NOT be reset** by `resetForNextStep`, `resetForNewLesson`
  or `resetStepState`. It is a monotonically increasing id the runner dedupes on; resetting
  it to 0 would make every step's trigger `1` and the guard would swallow every burst after
  the first. `resetForNextStep` runs at the top of `loadNextStep`, so the dispatch also
  happens after it.

### 6. Fire on the advance — `src/modules/lesson/lesson-progression.js`

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

### 7. The effect component — `src/components/widgets/StepCelebration.jsx`

Render-only side-effect component (same shape as `SuccessEffects.jsx`/`PointLossOverlay.jsx`)
that subscribes to `stepCelebrationTrigger`, calls `runStepCelebration({ trigger })` in an
effect keyed on the trigger, and returns `null`. Mounted once in
`src/components/LessonContainer.jsx` next to `<PointLossOverlay />`.

- **No cleanup function.** A cleanup would cancel the pending burst timers on StrictMode's
  test-unmount, and the second effect run is swallowed by the dedupe guard — so the
  celebration would never fire in dev. The timers must be left to run.
- No `Math.random`, no confetti options and no branching in the component: the runner and
  the pure module own all of it.

### 8. Guards and bookkeeping

- `src/modules/lesson/confetti-api-guard.test.js` — the upgrade-safety guard. It resolves the
  installed package (`node_modules/canvas-confetti/package.json` and `src/confetti.js`) and
  asserts: the installed version is `1.9.4` or later, `package.json` declares `^1.9.4`, and
  every option key used by the app is really read by the library. The option key set is
  **discovered** by building a plan for every `CELEBRATION_VARIANTS` entry (so plan-added
  keys are included and a new option in a variant automatically extends the guard) plus the
  three keys the success effect passes; each must appear as `prop(options, '<key>'` or
  inside the library's `defaults` block. It also asserts `module.exports.shapeFromPath =`
  exists, and pins the module-build fact that only `default`/`create` are named exports — so
  the runner's `mod.default` path stays correct.
- Every touched path goes into `src/modules/video/recorder-page.test.js`'s per-story
  `allowlist` (its guard runs `git diff --name-only HEAD` and also fails on any untracked
  file), and new files are `git add`ed before the suite runs. No new file under `public/`.
  No test file under `src/**` may contain the literal `/recorder` or `recorder.html`.

## Tasks

### Task 1 - Upgrade canvas-confetti and guard the new API

- `package.json` declares `"canvas-confetti": "^1.9.4"` → asserted; `package-lock.json`'s `node_modules/canvas-confetti` block resolves version `1.9.4` and carries an `integrity` hash → asserted by reading both files as JSON.
- The installed package (`createRequire(import.meta.url).resolve('canvas-confetti/package.json')`) reports a `version` that parses to `>= 1.9.4` → asserted, so a cleared `node_modules` cannot leave the suite testing 1.6.0.
- `npm ls canvas-confetti --json` (as a subprocess) reports exactly one resolved version, `1.9.4` → asserted, so no second copy is hoisted for another consumer.
- `confetti-api-guard.test.js`: build the option-key set by calling `buildCelebrationPlan` for every variant (so plan-added `colors`/`zIndex`/`disableForReducedMotion` are included) and unioning the three keys `SuccessEffects.jsx` passes (`particleCount`, `spread`, `origin`) → every key is really read by the installed `src/confetti.js` (`prop(options, '<key>'` or the `defaults` block) — proving the upgrade supports the new `flat` and shape options, and extending automatically when a variant gains an option.
- Same guard: `src/confetti.js` contains `module.exports.shapeFromPath = shapeFromPath` → custom path shapes are available in the installed version.
- Same guard: `dist/confetti.module.mjs` exports only `default` and `create` (no `export var shapeFromPath`) → asserted, and `step-celebration.web.js` reaches the helper through `mod.default` (source guard: contains `mod.default`, and does **not** contain `{ shapeFromPath }` destructuring or `import { shapeFromPath }`).
- Same guard is proven failable: temporarily rename one option key in a variant (e.g. `scalar` → `scale`) and confirm the guard goes red on that key, then restore with `git checkout -- <path>` after `git add`.

### Task 2 - Pure celebration rules

- `CELEBRATION_VARIANTS.length >= 6` and every variant id is unique → asserted, so "different effects" cannot silently collapse to one.
- Every `customShapes` key referenced by any burst exists in `CELEBRATION_PATHS`, every path starts with `M` and ends with `Z`, and every matrix is `[1, 0, 0, 1, -5, -5]` → asserted (a typo'd path key would otherwise silently drop that shape at runtime).
- `CELEBRATION_PATHS` + `buildCelebrationPlan` produce plans with no `Path2D`/`DOMMatrix`/`document` access — the suite runs under jsdom where those are absent and must not throw.
- `pickCelebrationVariant(-1, () => 0)` → `{ index: 0 }`; with `() => 0.999` → the last index (uniform first pick).
- `pickCelebrationVariant(previousIndex, random)` for every `previousIndex` in the list and rolls `0`, `0.5`, `0.999` → `index !== previousIndex`; out-of-range/`undefined`/`null`/`NaN` previous → a uniform pick in `[0, count)`.
- `buildCelebrationPlan(index, () => 0.5)` → jitters are exactly 0, so `origin.x/origin.y/spread/startVelocity` equal the variant's own numbers; with `() => 0` and `() => 0.999` → each jitter is at its `-max`/`+max` and every value stays inside its clamp range.
- Every planned burst → `delayMs >= 0`, `colors` equal to one of `CELEBRATION_PALETTES`, `zIndex === 100`, `disableForReducedMotion === true`, `options.shapes` built only from `['square','circle','star']`, and `customShapes` deep-equal to the variant's own list.
- `buildCelebrationPlan` called twice with different randoms → the two plans differ, and `CELEBRATION_VARIANTS` is deep-equal to a snapshot taken before the calls (no mutation of the exported constants, including the `shapes` arrays).
- `shouldCelebrateStepEnd` → `true` for `{ responseType: 'friendClosedResponse' }` (with and without `simpleVideoUrl`), `false` for `closedResponse`, `openResponse`, `branching`, `viewAndContinue`, `lessonIntro`, `success`, `null`, `undefined`.

### Task 3 - Browser runner

- `runStepCelebration({ trigger: 0 | -1 | undefined | NaN, loadConfetti: stub })` → returns `null` and the loader is never called.
- `runStepCelebration({ trigger: 3, loadConfetti: stub, schedule: fakeSchedule })` → the loader is called exactly once, and `fakeSchedule` received exactly one task per burst of the picked variant, in plan order, with the planned `delayMs`; running the scheduled callbacks calls the fired function with each burst's `options`, whose `shapes` array is the built-in shapes **plus** the resolved custom shapes.
- Custom shapes → the stub's `shapeFromPath` is called once per distinct `CELEBRATION_PATHS` key across two celebrations (the module-scope cache), always with the registry's `{ path, matrix }` object.
- `shapeFromPath` missing or throwing (`shapeFromPath: () => { throw new Error('nope') }`) → the burst still fires with the built-in `options.shapes` only, exactly one `console.warn` matching `/custom shapes unavailable/`, and the next trigger still celebrates.
- Same trigger twice (StrictMode double effect) → the second call returns `null` and the fired function is called only once per burst (with `resetStepCelebrationState()` in `beforeEach`).
- Two different triggers in a row → two celebrations, and the second variant id differs from the first (the no-repeat rule observed end to end).
- A loader that rejects → `runStepCelebration` rejects (the caller logs it) and a later trigger still produces a celebration.
- A fired function that throws on the first burst → `runStepCelebration` still resolves, the later bursts of that plan are still scheduled and run, and exactly one `console.warn` containing `[StepCelebration] burst failed` is logged (spy on `console.warn`).
- The real `canvas-confetti` is never imported by the test: the runner is always called with an injected loader (jsdom has no canvas, no `Path2D`).
- Source guard: `step-celebration.web.js` contains `import('canvas-confetti')`, has **no static** `import … from 'canvas-confetti'` (line-anchored `/^import[^\n]*canvas-confetti/m` on raw source), and does not call `.reset()`.

### Task 4 - Store trigger and reset immunity

- `appStore.setState({ stepCelebrationTrigger: 0 })` then `triggerStepCelebration()` twice → the value is `1`, then `2`.
- `appStore.setState({ stepCelebrationTrigger: 7 })` + `resetForNextStep()` → still `7`; the same for `resetForNewLesson()` and `resetStepState()`.

### Task 5 - Fire on the friend closed-response advance

- `loadNextStep({ responseType: 'friendClosedResponse' }, null, deps)` → `stepCelebrationTrigger` increases by exactly 1 (read the value before and assert the delta; the shared appStore is not reset between tests in `lesson-progression.test.js`).
- `loadNextStep({ responseType: 'closedResponse' | 'openResponse' | 'viewAndContinue' | 'branching' | 'success' }, null, deps)` → the trigger is unchanged.
- `loadNextStep` with `nextStep` pointing past the last step (lesson end, on a `makeLesson` fixture with no `nextLessonId`) → the trigger still increases by exactly 1 for the `friendClosedResponse` step.
- Source guard in `step-celebration-wiring.test.js`, on the `loadNextStep` slice only (from `indexOf('function loadNextStep')` to `indexOf('// Branching navigation')`): it imports `shouldCelebrateStepEnd` from `./step-celebration-logic.js`, and `region.indexOf('resetForNextStep()') < region.indexOf('shouldCelebrateStepEnd(') < region.indexOf('triggerStepCelebration(')` — proving the dispatch is inside the advance path and after the reset.

### Task 6 - Render the effect once, keep the success effect untouched

- Source guard: `LessonContainer.jsx` imports `./widgets/StepCelebration.jsx` and renders `<StepCelebration />` exactly once (`match(/<StepCelebration \/>/g).length === 1`).
- Source guard: `StepCelebration.jsx` contains `stepCelebrationTrigger` and `runStepCelebration`, returns `null` (`toContain('return null')`), and contains no `Math.random`, no `canvas-confetti`, no `setTimeout` and no confetti option names such as `particleCount`.
- Source guard: `SuccessEffects.jsx` still imports `shouldShowConfetti`, still calls `import('canvas-confetti')`, and still fires `particleCount: 120`, `spread: 80`, `origin: { y: 0.6 }` — the success effect is unchanged by the upgrade and is not a second consumer of the new variants.

### Task 7 - Integration bookkeeping

- Every path the diff touches is present in `recorder-page.test.js`'s `allowlist` (including `package.json` and `package-lock.json`), and `git status --porcelain` reports no untracked file.
- `npx vitest run` is green, `npm run lint` is clean, and `npm run build` succeeds (the confetti chunk stays a separate lazy chunk; the build resolves the 1.9.4 module entry).

## Technical Context

- `canvas-confetti@1.9.4` — verified from `npm pack canvas-confetti@1.9.4` (tarball inspected):
  - option keys read by `fire`: `particleCount, angle, spread, startVelocity, decay, gravity, drift, colors, ticks, shapes, scalar, flat, origin (x/y), zIndex, disableForReducedMotion`;
  - `flat` (added in 1.7.0) turns off tilt/wobble in `updateFetti`;
  - `shapeFromPath({ path, matrix? })` (1.7.0) returns `{ type: 'path', path, matrix }` and throws when `Path2D`/`DOMMatrix` are missing; it accepts a string path directly or `{ path, matrix }`;
  - `shapeFromText({ text, scalar?, color?, fontFamily? })` (1.7.0) returns a rasterised `{ type: 'bitmap', bitmap, matrix }` created with `new OffscreenCanvas` (no guard, so it throws where OffscreenCanvas is missing) — the source itself notes bitmaps "probably need to be transferred for workers";
  - `dist/confetti.module.mjs` (the ESM entry Vite uses) exports `default` and `create` only; `shapeFromPath`/`shapeFromText`/`reset` hang off the default export function;
  - unpacked size 92,370 bytes (1.6.0: 66,321); `dist/confetti.module.mjs` 24,924 bytes (1.6.0: 17,479) — a lazy chunk, no eager bundle growth.
- `React 19.2.0` with `React.StrictMode` (`src/main.jsx`) — mount effects run twice in development, hence the trigger dedupe.
- `vitest@4` with `environment: 'jsdom'` (`vitest.config.js`) — jsdom has no canvas 2D context, no `Path2D` and no `DOMMatrix`, so the runner's loader is always injected in tests and the pure module must never build a shape.
- `zustand@5` — `appStore` is the single store; the transient trigger follows the existing `pointLossTrigger` / `mediaClearTrigger` pattern.
- The library appends one `position: fixed`, `pointer-events: none`, `z-index: 100` canvas to `document.body`, shared by every `fire()` call in the page — the same canvas the success effect already uses, so both effects can overlap without a second canvas, and the `pointer-events: none` canvas never steals a tap from the mic/answer controls.

## Notes

- **Why custom paths and not emoji.** `shapeFromText` is available in 1.9.4 but is wrong for this app: it rasterises the glyph from the *device's* emoji font (so a 🎉 renders differently on iOS, Android, Windows and Linux), it throws outright where `OffscreenCanvas` is missing, the rasterised bitmap does not rescale cleanly, and the source flags bitmap transfer to the worker as unfinished. `shapeFromPath` gives deterministic, brand-consistent shapes that are plain strings, so they also cross the worker boundary safely. If emoji confetti is ever wanted, it is one guarded call in the runner and its own story.
- **The matrices are hard-coded on purpose.** When `shapeFromPath` is called without a
  matrix it derives one by sampling ~250 000 `isPointInPath` hits per path — the README
  recommends computing it once and caching the value instead. Every path here lives in a
  0–10 box, so `[1, 0, 0, 1, -5, -5]` is exactly what the helper would derive (`scale` 1,
  translate `-width/2`, `-height/2`), and the registry guard pins the value so a path edited
  outside the box is caught.
- **Frequency is intentional and high**: a friend-challenge lesson has ~12–40 `friendClosedResponse` steps (lesson `b` of `wouldyourather` has 41), so the bursts are tuned short (120–200 ticks, 30–70 particles per burst) rather than the success effect's 120-particle / 200-tick burst. If it reads as too much in review, the knob is `CELEBRATION_VARIANTS`, not the trigger.
- **Reduced motion**: every burst sets `disableForReducedMotion: true`, so a `prefers-reduced-motion` learner gets no celebration at all (the library resolves the fire without drawing). The success effect intentionally keeps its current behaviour.
- **Whole-window canvas**: the burst is drawn over the viewport, not clipped to the 9:16 `.video-frame`, exactly like the success effect. On desktop it plays over the frame's black surround; the bottom overlay (`z-index: 1050`) paints above the canvas, which is wanted — the answer/mic controls stay readable under the burst.
- **Prove every new source guard can fail** before trusting it (repo standing rule): inject the forbidden text (or delete the asserted line) and confirm the *specific* guard goes red, then restore with `git checkout -- <path>` after `git add` — a `cp` backup can itself be captured mid-mutation.
- **No sound, no strings, no analytics**: the burst is decorative; nothing is localized and no PostHog event is added (the existing `step_completed` event already covers the transition).
