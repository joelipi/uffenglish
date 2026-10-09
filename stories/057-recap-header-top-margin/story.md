# Recap header banner clears the top of the frame

## Context

The end-of-lesson recap draws the localized header banner (`video-header-<lang>.png`, 1600×300) flush at the top of the canvas: `resolveHeaderLayout` returns `y: 0` and `executeRenderLoop` draws it there (`src/modules/video/video-processor-logic.js:192`, `src/modules/video/video-processor.web.js:730`). Commit `bdf3d81` moved the share code into the banner's own corner and removed the opaque band that used to sit behind/below it, so the banner is now the topmost pixels of the exported video. When the recap is played back in a browser or a messenger, the viewer's chrome (address bar / status bar) covers that top strip and hides the banner. The banner needs a top margin above it so it lands below the chrome.

A code-side margin is used instead of re-exporting the four localized PNGs with blank gradient padding at the top. The margin is presentation and belongs in the already unit-tested layout helper; the alternative means editing and keeping four assets in sync, grows the bundle, and the same 18% band cap would shrink the art. The margin is filled by extending the banner's own top row, which the art guarantees is pure gradient (content begins at row 30 of 300), so the fill is seamless without touching the assets.

## Out of Scope

- Editing `src/assets/img/video-header-*.png` — the four localized banners stay byte-identical.
- The banner's localized selection (`resolveHeaderImage`) and its English fallback.
- The share-code corner overlay, the tailing CTA card, subtitles, and the fluency card.
- Changing `HEADER_BAND_RATIO` (0.18) as the banner's maximum height.
- Native rendering — `video-processor.native.jsx` is a dead reference implementation.

## Implementation approach

### 1. Top margin in the pure layout

`resolveHeaderLayout` (`src/modules/video/video-processor-logic.js:192`) gains a top margin:

- Add `HEADER_TOP_MARGIN_RATIO = 0.08` — the margin height as a fraction of the canvas height (the value chosen to clear browser chrome).
- `topMargin = Math.round(canvasHeight * HEADER_TOP_MARGIN_RATIO)`; the banner's top edge is `y = topMargin`.
- The banner keeps its current sizing rule: `scale = Math.min(canvasWidth / naturalWidth, band / naturalHeight)` with `band = Math.round(canvasHeight * HEADER_BAND_RATIO)` (0.18). It still bleeds full width on a portrait frame and stays within the band's height cap; only its top edge moves down.
- Remove the now-dead prompt sizing: the constants `HEADER_TEXT_SIZE_RATIO`, `HEADER_TEXT_LINE_RATIO`, `HEADER_GAP_RATIO` and the returned `textSize` / `textY`. The share-code prompt they sized was deleted in `9741c21`, no consumer reads those fields, and `video-processor.web.js` reads only `x`, `y`, `width`, `height` (`headerBottom` is used by tests only).
- Return `{ x, y, width, height, headerBottom }` with `headerBottom = y + height` (the renderer reads `y` as the top margin; `headerBottom` stays for the invariants).
- The null contract is unchanged: a non-positive `naturalWidth` / `naturalHeight` / `canvasWidth` / `canvasHeight` (or omitted args) returns `null`.

Because a source recording is portrait, the banner is width-limited there, so its drawn size is unchanged and no side gap is introduced; on the (discouraged) landscape frame, deleting the dead prompt reservation lets the banner use the full band, which is now the intended behaviour since no prompt is drawn.

### 2. Paint the margin with the banner's own gradient

In the render block (`video-processor.web.js` around line 738), before drawing the banner, fill the margin rect `(x, 0, width, y)` by stretching the banner's top 1-px source row:

```js
if (headerLayout) {
    if (headerLayout.y > 0) {
        // The banner sits below a top margin so browser chrome cannot cover it.
        // Fill that margin by extending the banner's own top edge: the art's top
        // row is pure gradient, so stretching it is seamless.
        ctx.drawImage(
            overlayImage,
            0, 0, overlayImage.naturalWidth, 1,
            headerLayout.x, 0, headerLayout.width, headerLayout.y
        );
    }
    ctx.drawImage(
        overlayImage,
        headerLayout.x, headerLayout.y,
        headerLayout.width, headerLayout.height
    );
}
```

The stretch paints the same horizontal gradient the banner's top edge is made of, so there is no seam and no re-introduced band (`createLinearGradient` stays removed).

## Tasks

### Task 1 - Top margin in `resolveHeaderLayout`

- `[source inspected]` `src/modules/video/video-processor-logic.js`
  - → exports `HEADER_TOP_MARGIN_RATIO` equal to `0.08`
  - → still exports `HEADER_BAND_RATIO` equal to `0.18`
  - → no longer exports `HEADER_TEXT_SIZE_RATIO`, `HEADER_TEXT_LINE_RATIO`, or `HEADER_GAP_RATIO`
- `[1600×300 banner, canvas 1080×1920]` `resolveHeaderLayout` called
  - → `y === 154` (`Math.round(1920 * 0.08)`)
  - → `y + height <= canvasHeight`
  - → `height <= Math.round(canvasHeight * HEADER_BAND_RATIO)`
  - → `width <= canvasWidth` and `x` is the horizontal centre within 1px
- `[each canvas in [720×1280, 1080×1920, 1920×1080, 608×1080, 3840×2160]]`
  - → `y === Math.round(canvasHeight * HEADER_TOP_MARGIN_RATIO)` and `y > 0`
  - → `y + height <= canvasHeight`
- `[the same canvas size resolved twice]`
  - → the two layout objects are deep-equal
- `[naturalWidth | naturalHeight | canvasWidth | canvasHeight not positive, or args omitted]`
  - → returns `null`
- `[returned layout]`
  - → has no `textY` and no `textSize` property

### Task 2 - The renderer paints the margin with the banner gradient

- `[source inspected]` header block in `src/modules/video/video-processor.web.js` (`const headerLayout =` … `if (displayCanvas)`)
  - → draws the banner's top 1-px row across the margin: `drawImage(overlayImage, 0, 0, overlayImage.naturalWidth, 1, headerLayout.x, 0, headerLayout.width, headerLayout.y)`
  - → that stretch appears before the banner draw at `headerLayout.x, headerLayout.y, headerLayout.width, headerLayout.height` (index order)
  - → contains no `createLinearGradient(`
  - → contains no `fillRect(0, 0, canvas.width, headerLayout.headerBottom)`
  - → `drawTextOverlay` is still passed `overlayVariant, shareCta, headerLayout`

## Notes

- The header block is shared by both renderers (the live recap and the per-segment re-export) because both run `executeRenderLoop`, so one edit covers both.
- No new dependency and no bootstrap steps.
- The fill relies on each banner art's top row (rows 0–29 of 1600×300) being pure gradient; all four localized banners satisfy this (content begins at row 30). A future banner with content at the very top would smear — record this in the banner asset convention when such an asset is added.
- On a landscape frame the banner is taller than before because the deleted prompt reservation no longer reserves height; source recordings are portrait and the app warns against landscape recording, so this is not expected in practice.
- `docs/product.md` gains a bullet describing the top margin.
