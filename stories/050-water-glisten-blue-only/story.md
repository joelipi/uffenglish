# Confine the water shimmer to visible water surfaces

## Context

The app's "water" visual is the reusable `.water-surface` class in `src/assets/css/app.css`: a blue gradient background (`:906-915`) plus a `.water-surface::before` pseudo-element that paints an animated white diagonal sheen, `waterShimmer` (`:916-931`, keyframes at `:1201-1204`). The app shell carries it globally: `<div id="root" class="video-frame water-surface position-relative shadow-lg">` (`index.html:194`).

`.water-surface::before` is `position: absolute; inset: 0` with `z-index: auto`. An absolutely-positioned pseudo-element paints **above** non-positioned (static) in-flow content, but below later positioned siblings.

- Lesson pages are fine: their content is positioned (`#media-viewport` is `position: absolute` — `LessonContainer.jsx:254`; `.ivp-overlay` is `position: absolute; z-index: 20` — `app.css:888-899`; `.bottom-overlay` is `position-absolute` — `LessonContainer.jsx:170`), so those layers paint above the sheen and the sheen is visible only where the blue background shows through (e.g. the bottom water band).
- Non-lesson pages are not: `/`, `/home`, `/profile`, `/:shareCode` each render a single **opaque, static** container (`background-color: #0b1a2a`, `height: 100dvh`) directly inside `#root` — `HomeLanding.jsx:22-29`, `HomeScreen.jsx:67-75`, `UserProfile.jsx:266-273`, `PublicProfile.jsx:13-20`, `AuthLayout.jsx:6-7`. That opaque container hides the blue gradient, but the sheen still paints on top of it, so the *entire* page shimmers.

Confirmed with the real stylesheet in a real browser (Playwright + the running app): overriding `.water-surface::before` to solid magenta paints `rgb(255,0,255)` over every sampled point of a static opaque page container, including the real `/` route; the opaque container underneath is `rgb(11,26,42)` / `rgb(26,58,90)`.

Desired: keep the glistening water effect, but only where the blue water colour is actually visible. On non-lesson pages the opaque container covers the water, so the sheen must not paint over it.

## Out of Scope

- Changing the water gradient colours, the `waterShimmer` duration/keyframes, or the `riseThroughWater` / `waterDrift` animations.
- The blue backgrounds of non-water surfaces (`.top-overlay`, brand-gradient top bars/buttons, chat header, auth card).
- `prefers-reduced-motion` handling for the shimmer (no such rule exists today and none is added).
- Any change to routing, lesson logic, or which components use the water visual.
- Adding or removing the `.water-surface` class anywhere; the fix is layering only.

## Implementation approach

Root cause is CSS paint order, so the fix is pure CSS in `src/assets/css/app.css`.

1. `.water-surface` (`:906`) — add `isolation: isolate;`. Keep `position: relative;` and the existing blue `linear-gradient(...)` background unchanged.
2. `.water-surface::before` (`:916`) — add `z-index: -1;`. Keep `content`, `position: absolute;`, `inset: 0;`, the sheen `linear-gradient`, `background-size: 300% 100%;`, `animation: waterShimmer ...;`, and `pointer-events: none;` unchanged.

With `isolation: isolate` the `.water-surface` element is a stacking context, so its negative-`z-index` `::before` paints **above its own background but below all its content**. Consequences, verified in a real browser:

- `#root` on lesson pages: the positioned media viewport / overlays / bottom overlay still cover the sheen, so it remains visible only over the blue water band — unchanged.
- `#root` on non-lesson pages: the opaque static container now covers the sheen, so it no longer paints over the page.
- `.ivp-overlay.water-surface` and `#state-lesson-success.success-actions.water-surface`: both are already stacking contexts, the sheen stays above their blue and below their text/buttons.
- An empty `.water-surface` with visible blue still shows the sheen (the effect is kept).

`isolation: isolate` is a no-op for `#root` (it already forms a stacking context via `container-type: inline-size`, `app.css:349`) but is required so the rule is correct for any `.water-surface` that is not otherwise a stacking context — a bare `z-index: -1` on such an element would drop the sheen behind an ancestor's background.

Do **not** simply remove `water-surface` from `#root`: it was added deliberately for FOUC (`78c5790`, "reducing fouc by hiding bottom overlay") so the blue frame is present before React mounts; removing it would regress FOUC and delete the sheen from lesson water bands. This change keeps both the blue and the effect and only fixes the layering.

### Verification mechanics

Two layers of coverage, no new dependency:

- **Static guard (vitest, `src/assets/css/app-water-surface.test.js`).** Read `src/assets/css/app.css` with `readFileSync`, slice the `.water-surface {` block and the `.water-surface::before {` block by `indexOf` + the next `}`, and assert the new declarations plus retention of the shimmer and gradient. (Same style as the existing `src/components/video-overlay-italic.test.js` app.css guards. This file does not mention the operator recorder page, so it is safe under `src/**` — `AGENTS.md`.)
- **Behavioural guard (Playwright, `tests/water-shimmer-scope.spec.js`).** Force the pseudo-element to an opaque, static marker colour so paint order is directly observable regardless of animation timing:
  ```css
  .water-surface::before { background: rgb(255,0,255) !important; animation: none !important; }
  ```
  Take `page.screenshot({ clip })` and decode it **in the page** (`createImageBitmap` + `OffscreenCanvas.getImageData`) — this avoids adding a PNG library to the repo.
  - Non-lesson page (`/`): `page.setViewportSize({ width: 420, height: 900 })` first. This matters: at ≥576px `.video-frame` is `width: auto; aspect-ratio: 9/16` (`app.css:354-363`) and `#root` is centred inside the black `.app-container`, so a fixed clip could land on the container instead of `#root`; at <576px `#root` fills the viewport. Wait for `[data-testid="share-code-input"]`, apply the marker, then assert a clip over the opaque page surface (e.g. `{ x: 4, y: 300, width: 12, height: 12 }`) contains **no** `rgb(255,0,255)` pixel. On the pre-fix stylesheet the same clip is entirely `rgb(255,0,255)`.
  - Retention: append a fixture `<div class="water-surface" style="position:fixed;left:0;top:0;width:200px;height:200px;z-index:99999">` (visible blue, nothing covering it), apply the marker, assert marker pixels **are** present. The real lesson water band is environment-dependent (its `<video>` needs R2), so a fixture pins the retained-effect contract deterministically.

## Tasks

### Task 1 - Paint the water sheen behind content

- `src/assets/css/app.css` source inspected + `.water-surface` block parsed
  - → block contains `isolation: isolate`
  - → block still contains `position: relative` and a `linear-gradient(` background
- `src/assets/css/app.css` source inspected + `.water-surface::before` block parsed
  - → block contains `z-index: -1`
  - → block still contains `content:`, `position: absolute`, `inset: 0`, `animation: waterShimmer`, `background-size: 300% 100%`, and `pointer-events: none`
- `npm run lint` and `npm test` run
  - → both exit 0

### Task 2 - Behavioural regression coverage

- `/` loaded at a mobile viewport (<576px, so `#root` fills the viewport) with the marker stylesheet applied + a screenshot clip taken over the opaque page surface
  - → the clip contains no `rgb(255,0,255)` pixel
- `/` loaded with the marker stylesheet applied + a `.water-surface` fixture with visible blue appended
  - → the fixture clip contains `rgb(255,0,255)` pixels (shimmer retained)

## Notes

- The marker colour `rgb(255,0,255)` is used only because it cannot appear in the app; it is asserted on raw screenshot pixels, not on any app token.
- Prove both guards can fail before trusting them (`AGENTS.md`, "Source-guard tests must be able to fail"): remove `z-index: -1` and confirm the Vitest assertion and the Playwright non-lesson assertion both go red.
- Do not strip comments or slice to EOF when parsing `app.css`; scope each assertion to the specific selector block.
- `#root`'s `container-type: inline-size` already makes it a stacking context, so the guard must assert `isolation: isolate` is *declared* rather than relying on `#root`-specific behaviour.
- No new routes or components are added, so `PUBLIC_ROUTES` / guest-modal routing is untouched.
- No new package is introduced; `createImageBitmap` and `OffscreenCanvas` are used inside the page, and Vitest uses `node:fs`.
