# Recording looks: beauty pass + stationary prop overlays

## Context

Learners are self-conscious on camera — not about being identified, but about looking tired, shiny, blotchy, or badly lit. The recording canvas is the one frame every clip is cut from, so whatever is painted there is baked into the take with no pipeline change.

The earlier spike (stories/090, parked) proved canvas-baked effects survive the pipeline on iPad and Android, and that a Jeeliz face tracker is viable but is the single heaviest thing in the recording path (250 KB model, a second WebGL context, per-frame inference, plus blink/teardown failure modes). This story therefore treats face tracking as OPTIONAL and ships the value nobody needs tracking for:

- a **beauty pass** (soft-focus + fill light + warm tone + vignette) that flattens harsh light and softens micro-contrast, so wrinkles and blemishes read less,
- **stationary prop overlays** (a hat pinned to the top, a desk across the bottom, a frame), where the learner positions their face to fit — so the prop never has to move and cannot drift.

Both are pure Canvas2D on the existing composite: no model, no WebGL context, no inference, no new failure modes on low-memory Android.

## Out of Scope

- Any face tracking. The tracker stays on the parked 090 branch; this story must not import it. Confining the beauty pass to a detected face is a later quality tier.
- True blemish/spot removal, which needs skin segmentation (a second per-frame neural net — out of the device budget).
- A picker UI or persistence: modes are chosen by URL while the effect set is being validated.
- Playwright specs. The owner tests on real devices.
- Changes to the trim/concat/publish pipeline, configs, or localStorage.

## Implementation approach

- Two independent URL flags, so they can be combined (beauty + a hat is the real product):
  - `?beauty=none|soft|glow|warm` (default `none`)
  - `?overlay=none|hat|desk|frame` (default `none`)
  - Parsed by pure `resolveBeautyModeFromSearch` / `resolveOverlayModeFromSearch`; unknown or absent → `none`.
- Paint order inside the recording composite (fixed): camera frame → **beauty pass** → **prop overlay**. The prop is drawn last so it is never softened or lit by the beauty pass.
- Beauty pass = preset parameters in a table (`BEAUTY_PRESETS`), applied in a fixed order, each step a no-op at 0:
  1. soft focus: downscale the frame into a scratch canvas, draw it back over the sharp frame with `globalAlpha` — this is the blemish-softening step, and it is the same downscale/upscale technique already used for the blur filter;
  2. fill light: radial gradient composited with `screen`, centred above frame centre, which removes the under-eye/nose shadows that read as "tired";
  3. warm tone: a low-alpha warm `screen` lift plus a gentle vignette `multiply`.
- Prop overlays are preloaded PNGs drawn only once `complete && naturalWidth > 0`, so a missing/failed asset is a silent no-op (never a black frame). Placement is a resolve rule, not hard-coded pixels: `top` anchors the art to the canvas top at full width, `bottom` to the canvas bottom, `full` cover-fits the canvas — all preserving aspect ratio, all integer rects.
- All effect rules live in `src/modules/speech/portrait-capture-logic.js` (no React, no DOM, no browser globals); `speech.web.js` stays a thin adapter that reads the URL, loads the asset, and calls the painter.
- Test art is procedurally generated placeholder PNGs under `public/overlays/` (committed PNG only — the repo forbids committed jpg/jpeg/mp4 under `public/`), original shapes, no third-party art and no licence questions.

## Tasks

### Task 1 - Beauty + overlay decision rules (pure module)

- `resolveBeautyModeFromSearch('')`, `'?beauty=unknown'` + called in unit test
  - → returns `'none'`
- `resolveBeautyModeFromSearch('?beauty=soft')`, `'?beauty=glow'`, `'?beauty=warm'` + called in unit test
  - → returns the matching mode
- `resolveOverlayModeFromSearch('?overlay=hat')`, `'?overlay=desk'`, `'?overlay=frame'` + called in unit test
  - → returns the matching overlay
- `resolveOverlayModeFromSearch('')`, `'?overlay=nope'` + called in unit test
  - → returns `'none'`
- `resolveOverlayDestRect` with a `top` placement + called in unit test
  - → rect starts at y=0, spans the full canvas width, keeps the image aspect ratio
- `resolveOverlayDestRect` with a `bottom` placement + called in unit test
  - → rect ends at the canvas bottom (`dy + dh === canvasHeight`) and spans the full width
- `resolveOverlayDestRect` with a `full` placement + called in unit test
  - → cover-fits the canvas (never smaller than the canvas on either axis, aspect preserved)
- `resolveOverlayDestRect` with zero/absent image dimensions + called in unit test
  - → returns `null` (caller draws nothing)

## Notes

- Spike 090 stays parked (unmerged) as the record of the trap: Jeeliz coordinates are relative to the CAMERA frame, which the composite centre-crops, so a box mapped straight onto the canvas lands off the face on a landscape camera. Do not merge 090 to resurrect it without that fix.
- The preview IS the framing guide for a stationary prop, so preview and recording must share the same canvas — they do.
- The end-of-lesson recap burns the language banner across the top and the share-CTA across the bottom, so a hat pinned to the very top or a desk pinned to the very bottom will fight that chrome. Check one real recap and leave a safe band.
- Keep every parameter in the preset table so the owner can retune from the URL without a rebuild.
- Any new `public/**` asset must be `git add`ed and listed in `src/modules/video/recorder-page.test.js`'s allowlist, and it must not be precached (add the directory to `WORKBOX_IGNORES` in `vite.config.js`) — the art is optional, so it must not cost every learner a download.
