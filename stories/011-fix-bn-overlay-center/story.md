# Fix Bengali recap overlay horizontal centering (canvas ink vs. advance)

## Context

The end-of-lesson recap video is not a DOM overlay: `drawTextOverlay()` in
`src/modules/video/video-processor.web.js` (line 807) paints every recap string onto the canvas that
MediaRecorder captures, so each character is positioned by Canvas 2D text metrics. Two of its three text
blocks set `context.textAlign = 'center'` (share CTA at line 887, subtitles at line 930).

`textAlign = 'center'` centres the text's ADVANCE width, not its visible ink: per the HTML spec / MDN, with
`'center'` the text's left edge is placed at `x - measureText(text).width / 2`. When the glyph ink is not
symmetric about the advance midpoint the rendered glyphs sit visibly off-centre even though the anchor is
mathematically centred.

**Verified trigger (reproduced during planning, Chromium):** the subtitle translation line is drawn in
`italic` (`video-processor.web.js:945, 965, 1011`). Bengali has no true italic face in the fallback font
(and `Noto Sans Bengali` has none either), so the browser applies synthetic oblique. That shear pushes the
glyph ink to the right of the advance centre:

| text (80px, subtitle stack) | actualBoundingBoxLeft | actualBoundingBoxRight | rendered ink centre − canvas centre |
|---|---|---|---|
| `italic` `বাংলা` | 55.0 | 76.0 | **+10.0 px** |
| `italic` `আমার সাথে ফ্রি` | 177.2 | 198.2 | **+10.0 px** |
| `italic` long Bengali CTA copy | 470.1 | 492.1 | **+10.5 px** |
| `italic` `Hello` (Latin) | 89.2 | 88.7 | −0.5 px (real italic face → symmetric) |

The same Bengali strings without `italic` are centred (−0.5 px). Latin has a real italic face, which is why
Spanish looks centred while Bengali does not — exactly the report. The offset scales with font size
(≈12–13 % of the font size; ~6 px at the subtitle's ~46 px on a 1080-wide canvas), so short Bengali
translations are visibly off-centre inside their (centred) background box.

**Font loading is NOT the cause.** Loading `Noto Sans Bengali` and re-measuring `italic` Bengali at 80px
still yields `L=338, R=361` and a **+11 px** ink offset — synthetic oblique is applied regardless of which
Bengali family wins, and the app loads no web font at all today (`ensureFontsReady()` lines 99-110 names
`Orbitron`/`Plus Jakarta Sans`, which are never declared anywhere in the React app; only `public/landing.html`
imports them). So the fix must be in the anchor, not the font.

The non-italic share-CTA path (`drawFittedLine`, lines 782-805) currently measures
`actualBoundingBoxLeft/Right` only to shrink the font (`inkWidth`, lines 789-798) and still draws at the raw
`centerX` (lines 802-803); the subtitle block draws at `centerX` (lines 1013, 1020) and sizes its background
box from `measureText(line).width` (advance; lines 959-969, 996-1001). Both share the same advance-centring
assumption and must be corrected.

History: commit `8074a42` ("fix(video): iPad recap audio + Bengali CTA text") added the `inkWidth` fit and the
Bengali CTA font stack to stop Bengali overflow, but did not change the drawing anchor.

## Out of Scope

- Loading a Bengali web font (e.g. `Noto Sans Bengali`) or wiring fonts into `ensureFontsReady()` /
  `index.html`. Decision and rationale in "Font decision". Verified not to affect the reported shift.
- Removing or changing the `italic` translation style. It is a deliberate design distinction between the
  English cue and its translation; the fix keeps it and centres the skewed ink.
- The native renderer `src/modules/video/video-processor.native.jsx`: its recap text is React Native
  `<Text textAlign: 'center'>` (lines 388, 395, 464), which the platform centres on ink, and it has no
  importer / RN dependency. Not the reported path.
- Vertical centering, line-height, and ascent math. The report is horizontal.
- The fluency score card (`CALCULATING FLUENCY` / `FLUENCY SCORE`, lines 818-875): Orbitron with Latin
  digits/labels, near-symmetric, not reported.
- Making `wrapText()` (lines 759-775) ink-aware. It wraps on advance width; the reported defect is
  centering, not wrapping. The subtitle box is sized from ink (Task 3), so wrapped lines remain covered.
- Changing any share-CTA copy, the `example.com` placeholder, the 48h deadline, or `buildShareUrl` /
  `buildShareDeadline` / `resolveOverlayElements`.

## Implementation approach

### 1. Root-cause math (Canvas 2D)

`TextMetrics.actualBoundingBoxLeft/Right` are distances from the alignment point (`textAlign`) to the left/right
edge of the ink, positive meaning that direction (MDN). With `textAlign = 'center'` the alignment point is the
advance midpoint, so relative to the draw anchor `x`:

- ink spans `[x - actualBoundingBoxLeft, x + actualBoundingBoxRight]`
- ink width `W = actualBoundingBoxLeft + actualBoundingBoxRight`
- ink centre `= x + (actualBoundingBoxRight - actualBoundingBoxLeft) / 2`

To put the ink centre on `centerX`, draw at `x = centerX - (actualBoundingBoxRight - actualBoundingBoxLeft) / 2`.
When the ink is symmetric (`left === right`) this is exactly `centerX`, so Latin output is unchanged.
Verified: applying this to `italic` Bengali moves the measured ink offset from +10 px to −0.5 px.

### 2. Pure helpers in `src/modules/video/video-processor-logic.js`

Add these exports. The file must stay platform-agnostic (no `window`/`document`/`navigator`, no URL scheme —
enforced by the existing guard at `video-processor-logic.test.js:281-302`). They operate on a plain metrics
object / measure callback, so they are unit-testable in jsdom without a canvas.

```js
// Ink metrics for canvas text, relative to the alignment point set by
// context.textAlign. With textAlign='center' that point is the advance-width
// midpoint; actualBoundingBoxLeft/Right describe where the glyph ink actually
// is (positive = that direction). Falls back to advance-only when a browser
// omits the ink fields.
export function inkBounds(metrics) {
    const left = Number.isFinite(metrics?.actualBoundingBoxLeft) ? metrics.actualBoundingBoxLeft : 0;
    const right = Number.isFinite(metrics?.actualBoundingBoxRight) ? metrics.actualBoundingBoxRight : 0;
    const advance = Number.isFinite(metrics?.width) ? metrics.width : 0;
    return { left, right, advance, inkWidth: Math.max(advance, left + right) };
}

// Signed shift to apply to the draw anchor so the ink (not the advance box)
// is centred on centerX. Zero for symmetric ink.
export function inkCenterOffset(metrics) {
    const { left, right } = inkBounds(metrics);
    return (right - left) / 2;
}

// Anchor x that centres the text's ink on centerX.
export function centeredInkX(centerX, metrics) {
    return centerX - inkCenterOffset(metrics);
}

// Fit one line: shrink from baseSize until the ink fits maxWidth, then return
// the ink-centred anchor and the final size.
export function fitAndCenterLine(measureAtSize, text, centerX, { baseSize, minSize = 18, maxWidth }) {
    let size = baseSize;
    let metrics = measureAtSize(size, text);
    while (size > minSize && inkBounds(metrics).inkWidth > maxWidth) {
        size -= 1;
        metrics = measureAtSize(size, text);
    }
    return { size, x: centeredInkX(centerX, metrics) };
}

// Layout a block of centred lines: one ink-centred anchor per line, plus a
// background box symmetric about centerX and wide enough for every line's ink.
// `entries` is [{ text, measure }] where measure(text) returns TextMetrics with
// that line's font active.
export function layoutCenteredInkBlock(entries, centerX, padding = 0) {
    let halfWidth = 0;
    const anchors = entries.map(({ text, measure }) => {
        const metrics = measure(text);
        halfWidth = Math.max(halfWidth, inkBounds(metrics).inkWidth / 2);
        return centeredInkX(centerX, metrics);
    });
    return {
        anchors,
        halfWidth,
        boxX: centerX - halfWidth - padding,
        boxWidth: halfWidth * 2 + padding * 2,
    };
}
```

### 3. Shared font families

Export the family strings so the CTA and subtitle paths share one definition and the Bengali families are
asserted by a test:

```js
// Bengali-capable families, matching the CTA stack added in 8074a42. These are
// OS families (not web-loaded); ink centering above makes positioning
// independent of which family wins.
export const BENGALI_FONT_FAMILIES = '"Noto Sans Bengali", "Bangla Sangam MN", "Nirmala UI"';
export const CTA_FONT_FAMILY = `"Plus Jakarta Sans", ${BENGALI_FONT_FAMILIES}, sans-serif`;
export const SUBTITLE_FONT_FAMILY = `"Plus Jakarta Sans", ${BENGALI_FONT_FAMILIES}, sans-serif`;
```

### 4. Font decision — do NOT load a web font

Decision: this story does not add `Noto Sans Bengali` (or any font) to `ensureFontsReady()` or `index.html`.
Rationale, in priority order:

1. Verified: loading `Noto Sans Bengali` does not change the synthetic-oblique shift — `italic` Bengali still
   measured a +11 px ink offset with the family loaded. No Bengali family ships a true italic face, so the
   browser synthesises the shear either way. Font loading cannot fix the report.
2. The fix measures the actual ink at draw time, so it centres correctly on any family; no font load is needed.
3. No web font is declared anywhere in the React app today, so `ensureFontsReady()` is effectively a no-op and
   every overlay already renders in an OS font. Adding one is a new external runtime dependency for a bug fix,
   and (because `"Plus Jakarta Sans"` is not loaded) `"Noto Sans Bengali"` would also capture Latin glyphs and
   change the already-correct Latin/Spanish rendering.
4. Bengali OS fallbacks exist on the target platforms and are already named by the CTA stack; the subtitle
   stack is brought to parity in Task 3.

Assumption (explicit): if deterministic cross-OS glyph shapes or avoiding synthetic oblique are later wanted,
self-hosting a Bengali-only `@font-face` (or removing the italic style) is a separate rendering-quality story.

### 5. Web wiring — `src/modules/video/video-processor.web.js`

Add `fitAndCenterLine`, `layoutCenteredInkBlock`, `CTA_FONT_FAMILY`, `SUBTITLE_FONT_FAMILY` to the existing
`./video-processor-logic.js` import (line 9).

CTA (`drawFittedLine`, lines 782-805): replace the inline `inkWidth` closure and the raw-`centerX` draw with the
pure helper. `textAlign` stays `'center'` (set by the caller at line 887); the anchor is shifted by the ink
offset.

```js
function drawFittedLine(context, text, centerX, y, { fontFamily, maxWidth, baseSize, minSize = 18, color = 'white' }) {
    const measureAtSize = (size) => {
        context.font = `700 ${size}px ${fontFamily}`;
        return context.measureText(text);
    };
    const { size, x } = fitAndCenterLine(measureAtSize, text, centerX, { baseSize, minSize, maxWidth });
    context.font = `700 ${size}px ${fontFamily}`;
    context.fillStyle = color;
    context.strokeStyle = 'rgba(0,0,0,0.8)';
    context.lineWidth = Math.max(6, Math.round(size * 0.18));
    context.strokeText(text, x, y);
    context.fillText(text, x, y);
    return size;
}
```

CTA font stack (line 885): replace the inline string with `const fontFamily = CTA_FONT_FAMILY;`.

Subtitles (lines 929-1023): use `SUBTITLE_FONT_FAMILY` at all six font assignments and compute the box plus
per-line anchors from `layoutCenteredInkBlock`:

```js
const measureWith = (font) => (text) => {
    context.font = font;
    return context.measureText(text);
};
const enEntries = enLines.map(text => ({ text, measure: measureWith(`bold ${enFontSize}px ${SUBTITLE_FONT_FAMILY}`) }));
const trEntries = trLines.map(text => ({ text, measure: measureWith(`italic ${trFontSize}px ${SUBTITLE_FONT_FAMILY}`) }));
const { anchors, boxX, boxWidth } = layoutCenteredInkBlock([...enEntries, ...trEntries], centerX, boxPadding);
const enAnchors = anchors.slice(0, enLines.length);
const trAnchors = anchors.slice(enLines.length);
```

- Delete the now-unused `longestLineWidth` measurement block (lines 959-969); its only consumer was the box.
- Box: `context.fillRect(boxX, blockBottomY - totalTextHeight - boxPadding, boxWidth, totalTextHeight + boxPadding * 2)`.
- Drawing: keep `context.textAlign = 'center'`; draw translation lines with
  `context.fillText(trLines[i], trAnchors[i], lineY)` and English lines with
  `context.fillText(enLines[i], enAnchors[i], lineY)` (bottom-up order and y stepping unchanged).

### 6. Edge cases

- Metrics missing / NaN ink fields (older engines): `inkBounds` falls back to advance width and zero offset →
  identical to today's behaviour.
- Symmetric ink (Latin/Spanish, real italic face): `inkCenterOffset === 0` → draws at `centerX`, no visual
  change.
- Synthetic oblique on a complex script (the reported case): asymmetric `left`/`right` shift the anchor left to
  centre the ink.
- Ink narrower than advance (normal): `inkWidth` stays the advance, so fitting is not loosened.
- Ink wider than advance (italic overhang / complex script): `inkWidth = left + right`; fit shrinks until the
  ink fits and the anchor centres it.
- Overhang (negative `actualBoundingBoxLeft`): the signed sum yields the true ink width (the old `Math.abs`
  version could over-shrink).
- Empty subtitle / no translation: `layoutCenteredInkBlock` is only called when `enText.trim() !== ''`; empty
  entries return `anchors: []` and a padding-only box.
- `baseSize <= minSize`: `fitAndCenterLine` still measures once and centres; the loop guard is `size > minSize`
  exactly as today.
- Mixed en + bn lines in one subtitle block: the box half-width is the max across all lines' ink; each line is
  centred on its own ink.

## Tasks

### Task 1 - Ink-centering helpers + font constants (`video-processor-logic.js`, `video-processor-logic.test.js`)

- `inkBounds` called with `{ width: 100, actualBoundingBoxLeft: 48, actualBoundingBoxRight: 48 }`
  - → `{ left: 48, right: 48, advance: 100, inkWidth: 100 }`
- `inkBounds` called with `{ width: 100, actualBoundingBoxLeft: 70, actualBoundingBoxRight: 40 }`
  - → `inkWidth === 110` (ink exceeds advance)
- `inkBounds` called with `{ width: 50 }`, `{}`, `null`
  - → ink fields default to `0`; `inkWidth === 50` / `0` / `0` respectively
- `inkBounds` called with `{ actualBoundingBoxLeft: NaN, actualBoundingBoxRight: 10, width: 0 }`
  - → `left === 0`, `inkWidth === 10`
- `inkBounds` called with `{ width: 100, actualBoundingBoxLeft: -5, actualBoundingBoxRight: 20 }`
  - → `inkWidth === 100` (signed sum `15` < advance; no over-shrink)
- `inkCenterOffset` called with symmetric ink (`left === right`)
  - → `0`
- `inkCenterOffset` called with the measured `italic` Bengali metrics `{ actualBoundingBoxLeft: 177.2, actualBoundingBoxRight: 198.2 }`
  - → `10.5` (the reported offset; the anchor must shift 10.5 px left)
- `inkCenterOffset` called with `{ actualBoundingBoxLeft: 80, actualBoundingBoxRight: 40 }`
  - → `-20`
- `inkCenterOffset` called with `{}` / `null`
  - → `0`
- `centeredInkX(500, { actualBoundingBoxLeft: 177.2, actualBoundingBoxRight: 198.2 })`
  - → `489.5`
- `centeredInkX(500, { actualBoundingBoxLeft: 50, actualBoundingBoxRight: 50 })`
  - → `500`
- `fitAndCenterLine` called with a `measureAtSize(size)` returning
  `{ width: size*10, actualBoundingBoxLeft: size*6, actualBoundingBoxRight: size*4 }`, `baseSize: 100`,
  `maxWidth: 500`, `minSize: 18`
  - → `size === 50`
  - → `x === centerX + 50` (ink-centred, not `centerX`)
- `fitAndCenterLine` called with `maxWidth: 1`, `baseSize: 100`, `minSize: 18`
  - → `size === 18` (never shrinks below `minSize`)
- `fitAndCenterLine` called with symmetric metrics that already fit
  - → `x === centerX` (no shift)
- `layoutCenteredInkBlock` called with entries
  `[{ measure: () => ({ width: 100, actualBoundingBoxLeft: 50, actualBoundingBoxRight: 50 }) }, { measure: () => ({ width: 100, actualBoundingBoxLeft: 80, actualBoundingBoxRight: 40 }) }]`,
  `centerX: 500`, `padding: 10`
  - → `anchors` equals `[500, 520]`
  - → `boxX === 430` and `boxWidth === 140` (symmetric about 500, spans all ink)
- `layoutCenteredInkBlock` called with `[]`, `centerX: 500`, `padding: 10`
  - → `{ anchors: [], halfWidth: 0, boxX: 490, boxWidth: 20 }`
- `BENGALI_FONT_FAMILIES` inspected
  - → contains `"Noto Sans Bengali"`, `"Bangla Sangam MN"`, `"Nirmala UI"`
- `CTA_FONT_FAMILY` and `SUBTITLE_FONT_FAMILY` inspected
  - → each contains `"Plus Jakarta Sans"` and all three `BENGALI_FONT_FAMILIES`
  - → each ends with `sans-serif`
- `video-processor-logic.js` read as source text
  - → still references no `window` / `document` / `navigator` and no URL scheme (existing guard passes)

### Task 2 - Ink-centre the CTA fitted lines (`video-processor.web.js`, `video-processor-web-guard.test.js`)

- `video-processor.web.js` read as source text
  - → imports `fitAndCenterLine` and `CTA_FONT_FAMILY` from `./video-processor-logic.js`
  - → `drawFittedLine` no longer calls `strokeText(text, centerX` or `fillText(text, centerX`
  - → `drawFittedLine` draws at the anchor returned by `fitAndCenterLine` (source references `fitAndCenterLine`)
  - → the CTA block no longer hardcodes the font-family string (uses `CTA_FONT_FAMILY`)
- `fitAndCenterLine` unit cases in Task 1
  - → CTA headline / deadline / URL anchors are ink-centred (behaviour covered there)

### Task 3 - Ink-centre subtitles + ink-sized box + Bengali stack (`video-processor.web.js`, `video-processor-web-guard.test.js`)

- `video-processor.web.js` read as source text
  - → imports `layoutCenteredInkBlock` and `SUBTITLE_FONT_FAMILY` from `./video-processor-logic.js`
  - → the subtitle block calls `layoutCenteredInkBlock(`
  - → subtitle translation lines are drawn with `fillText(trLines[i], trAnchors[i], ...)` and English lines with
    `fillText(enLines[i], enAnchors[i], ...)` (no `fillText(..., centerX` in the subtitle block)
  - → the subtitle background box is drawn from `boxX` / `boxWidth` (no `longestLineWidth` remains)
  - → no hardcoded `"Plus Jakarta Sans", sans-serif` remains anywhere in the file
  - → every subtitle font assignment uses `SUBTITLE_FONT_FAMILY`
  - → the translation font assignment still contains `italic` (the design distinction is preserved)
- `layoutCenteredInkBlock` unit cases in Task 1
  - → the subtitle box is symmetric about `centerX` and covers every line's ink (behaviour covered there)

## Technical Context

- No new npm dependencies. Unit tests use the existing vitest 4.1.6 + jsdom 29.1.1 setup
  (`vitest.config.js`; `*.test.js` colocated, `tests/**` and `*.spec.js` are Playwright). Verified baseline:
  `npx vitest run src/modules/video/` → 7 files / 87 tests pass.
- No node-canvas / `canvas` package is installed, so `HTMLCanvasElement.getContext('2d')` returns `null` in
  jsdom and the real draw calls cannot be exercised. Test strategy: (a) unit-test the pure math/layout helpers
  with synthetic `TextMetrics` objects (`video-processor-logic.test.js`), and (b) source-guard the web wiring by
  reading `video-processor.web.js` as text (`video-processor-web-guard.test.js`) — the established pattern in
  this repo.
- `video-processor.web.js` must not be imported by a unit test: it pulls in Supabase / PostHog / storage modules
  and browser-only globals at module scope, and `vitest.config.js` does not register the `.web.js` resolve
  extension. The existing guard test deliberately reads it as text rather than importing it.
- Root cause reproduced during planning with Playwright Chromium (the only browser that can run the canvas
  pixel check here). `italic` Bengali at 80px: `actualBoundingBoxLeft=177.2`, `actualBoundingBoxRight=198.2`
  (asymmetric) vs. non-italic `187.2/187.2`; the drawn ink centre sat +10 px right of the canvas centre. With
  `Noto Sans Bengali` loaded, `italic` Bengali measured `338/361` → still +11 px, proving font loading is not
  the cause. Applying `centeredInkX` moved the offset to −0.5 px. WebKit 26.4 (Playwright 1.60) was also
  checked: non-italic Bengali is centred there.
- Canvas semantics confirmed from MDN: `TextMetrics.actualBoundingBoxLeft/Right` are measured from the
  `textAlign` alignment point (positive = that direction), and `textAlign = 'center'` places the text's left edge
  at `x - measureText(text).width / 2` (advance width, not ink).
- `video-processor-logic.js` is shared with the (unused) native renderer and is kept platform-agnostic; the new
  helpers take plain objects / callbacks only.
- CI (`.github/workflows/deploy.yml`, `playwright.yml`) runs `npm test -- --run` (vitest). There is no lint
  script in `package.json`; `.eslintrc.json` only targets a legacy `js/**` path.

## Notes

**Manual verification (canvas pixels cannot be asserted in jsdom; Tasks 1-3 cover the math and wiring):**

1. `npm run dev`, open `/course/model/lesson/wf` (or any `shareCta` lesson), complete the steps, and choose a
   Bengali native language before generating the recap.
2. In the generated final video, the Bengali subtitle translation (drawn in italic under the English cue) should
   sit visually centred inside its background box — not shifted right as today.
3. Repeat in Spanish (`Practica inglés conmigo gratis`) and confirm it looks unchanged (offset is `0` for a real
   italic face).
4. Confirm the subtitle background box still fully covers the Bengali translation text.

**Non-automatable / structural checks:**

- The offset is exactly `0` when `actualBoundingBoxLeft === actualBoundingBoxRight`, so Latin/Spanish output must
  be visually identical to before.
- Preserve the `italic` translation style; do not "fix" the skew by removing it.
- Preserve existing comments and `console.log` statements per `agents.md`; update the `drawFittedLine` comment to
  describe the new anchor behaviour (the old "Take the larger of advance and bounding box" note moves to
  `inkBounds`).
- Do not touch `ensureFontsReady()`, `index.html`, or the native renderer in this story.
