# Fix recap overlay centering when the font has no true italic face (language-agnostic)

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
`italic` (`video-processor.web.js:945, 965, 1011`). When the resolved font has no true italic face, the browser
applies synthetic oblique, and that shear pushes the glyph ink to the right of the advance centre:

| `italic` text (80px, subtitle stack) | actualBoundingBoxLeft | actualBoundingBoxRight | ink offset (old) | ink offset (fixed) |
|---|---|---|---|---|
| `Hello` (Latin) | 89.2 | 88.7 | −0.5 px | −0.5 px |
| `বাংলা` (Bengali) | 55.0 | 76.0 | **+10.0 px** | 0 px |
| `हिन्दी` (Hindi) | 64.0 | 84.0 | **+9.0 px** | −1.0 px |
| `日本語` (Japanese) | 111.0 | 129.0 | **+8.5 px** | −0.5 px |
| `தமிழ்` (Tamil) | 87.0 | 96.0 | **+3.5 px** | −0.5 px |

The same strings without `italic` are centred (±0.5 px). Latin ships a real italic face, which is why Spanish
looks centred while Bengali does not — exactly the report.

**This is not a Bengali (or hi/bn) bug — it is the general rule for any font without a true italic face**, and
the app will keep adding languages whose fallback fonts may or may not have one. The fix must therefore be
language- and script-agnostic: it must measure the actual rendered ink and anchor on that, with no per-language
branching, font list, or feature detection. That also rules out the tempting alternative of conditionally
applying `italic` based on script/font support.

**Font loading is NOT the cause.** Loading `Noto Sans Bengali` and re-measuring `italic` Bengali at 80px still
yields `L=338, R=361` and a **+11 px** ink offset — synthetic oblique is applied regardless of which family
wins, and the app loads no web font at all today (`ensureFontsReady()` lines 99-110 names `Orbitron`/`Plus
Jakarta Sans`, which are never declared anywhere in the React app; only `public/landing.html` imports them). So
the fix must be in the anchor, not the font.

The non-italic share-CTA path (`drawFittedLine`, lines 782-805) currently measures
`actualBoundingBoxLeft/Right` only to shrink the font (`inkWidth`, lines 789-798) and still draws at the raw
`centerX` (lines 802-803); the subtitle block draws at `centerX` (lines 1013, 1020) and sizes its background
box from `measureText(line).width` (advance; lines 959-969, 996-1001). Both share the same advance-centring
assumption and must be corrected.

History: commit `8074a42` ("fix(video): iPad recap audio + Bengali CTA text") added the `inkWidth` fit and the
Bengali CTA font stack to stop Bengali overflow, but did not change the drawing anchor.

## Out of Scope

- Any language- or script-specific logic in the fix: no language parameter, no script detection, no
  per-language font list, no "does this font have italics" feature test. Future languages are covered by
  construction.
- Adding Bengali families (or any language's families) to the subtitle font stack. The centering fix is
  font-agnostic, and the existing `"Plus Jakarta Sans", sans-serif` stack already lets the browser fall back to
  a script-capable font for any language. (The pre-existing CTA stack at line 885 still lists Bengali families;
  it is left untouched — it is not part of this fix.)
- Loading a Bengali web font (e.g. `Noto Sans Bengali`) or wiring fonts into `ensureFontsReady()` /
  `index.html`. Verified not to affect the reported shift.
- Removing or conditionally applying the `italic` translation style. It is a deliberate design distinction
  between the English cue and its translation; the fix keeps it and centres the skewed ink for every language.
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
When the ink is symmetric (`left === right`) this is exactly `centerX`, so Latin output is unchanged. Verified:
applying this to `italic` text moves the measured ink offset to ≈0 for Bengali, Hindi, Japanese and Tamil.

This is language-agnostic by construction: the helpers receive only `TextMetrics` values, so they cannot (and do
not) branch on language or script.

### 2. Pure helpers in `src/modules/video/video-processor-logic.js`

Add these exports. The file must stay platform-agnostic (no `window`/`document`/`navigator`, no URL scheme —
enforced by the existing guard at `video-processor-logic.test.js:281-302`). They operate on a plain metrics
object / measure callback, so they are unit-testable in jsdom without a canvas.

```js
// Ink metrics for canvas text, relative to the alignment point set by
// context.textAlign. With textAlign='center' that point is the advance-width
// midpoint; actualBoundingBoxLeft/Right describe where the glyph ink actually
// is (positive = that direction). Falls back to advance-only when a browser
// omits the ink fields. Deliberately takes no language/script argument: it
// works for every writing system, including fonts with no true italic face.
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

### 3. Font decision — no font changes

Decision: no web font is added to `ensureFontsReady()` / `index.html`, and no language-specific families are
added to the subtitle stack. Rationale:

1. Verified: loading `Noto Sans Bengali` does not change the synthetic-oblique shift — `italic` Bengali still
   measured a +11 px ink offset with the family loaded. No Bengali family ships a true italic face, so the
   browser synthesises the shear either way.
2. The fix measures the actual ink at draw time, so it centres correctly on any family, in any language. No
   font load and no per-language font list are needed.
3. The existing `"Plus Jakarta Sans", sans-serif` stack already ends in a generic family, so the browser picks a
   script-capable font for any language the app adds later.
4. Adding a web font is a new external runtime dependency for a bug fix, and (because `"Plus Jakarta Sans"` is
   not loaded) `"Noto Sans Bengali"` would also capture Latin glyphs and change the already-correct
   Latin/Spanish rendering.

Assumption (explicit): if deterministic cross-OS glyph shapes, avoiding synthetic oblique, or per-language font
preferences are later wanted, that is a separate rendering-quality story.

### 4. Web wiring — `src/modules/video/video-processor.web.js`

Add `fitAndCenterLine`, `layoutCenteredInkBlock` to the existing `./video-processor-logic.js` import (line 9).
No font strings change.

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

Subtitles (lines 929-1023): keep the existing font strings (`bold`/`italic` + `"Plus Jakarta Sans", sans-serif`)
and compute the box plus per-line anchors from `layoutCenteredInkBlock`:

```js
const measureWith = (font) => (text) => {
    context.font = font;
    return context.measureText(text);
};
const enEntries = enLines.map(text => ({ text, measure: measureWith(`bold ${enFontSize}px "Plus Jakarta Sans", sans-serif`) }));
const trEntries = trLines.map(text => ({ text, measure: measureWith(`italic ${trFontSize}px "Plus Jakarta Sans", sans-serif`) }));
const { anchors, boxX, boxWidth } = layoutCenteredInkBlock([...enEntries, ...trEntries], centerX, boxPadding);
const enAnchors = anchors.slice(0, enLines.length);
const trAnchors = anchors.slice(enLines.length);
```

- Delete the now-unused `longestLineWidth` measurement block (lines 959-969); its only consumer was the box.
- Box: `context.fillRect(boxX, blockBottomY - totalTextHeight - boxPadding, boxWidth, totalTextHeight + boxPadding * 2)`.
- Drawing: keep `context.textAlign = 'center'`; draw translation lines with
  `context.fillText(trLines[i], trAnchors[i], lineY)` and English lines with
  `context.fillText(enLines[i], enAnchors[i], lineY)` (bottom-up order and y stepping unchanged).

### 5. Edge cases

- Metrics missing / NaN ink fields (older engines): `inkBounds` falls back to advance width and zero offset →
  identical to today's behaviour.
- Symmetric ink (Latin/Spanish, real italic face): `inkCenterOffset === 0` → draws at `centerX`, no visual
  change.
- Synthetic oblique on any script (the reported case): asymmetric `left`/`right` shift the anchor left to centre
  the ink — no language check involved.
- Ink narrower than advance (normal): `inkWidth` stays the advance, so fitting is not loosened.
- Ink wider than advance (italic overhang / complex script): `inkWidth = left + right`; fit shrinks until the
  ink fits and the anchor centres it.
- Overhang (negative `actualBoundingBoxLeft`): the signed sum yields the true ink width (the old `Math.abs`
  version could over-shrink).
- Empty subtitle / no translation: `layoutCenteredInkBlock` is only called when `enText.trim() !== ''`; empty
  entries return `anchors: []` and a padding-only box.
- `baseSize <= minSize`: `fitAndCenterLine` still measures once and centres; the loop guard is `size > minSize`
  exactly as today.
- Mixed English + translation lines in one subtitle block: the box half-width is the max across all lines' ink;
  each line is centred on its own ink.

## Tasks

### Task 1 - Language-agnostic ink-centering helpers (`video-processor-logic.js`, `video-processor-logic.test.js`)

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
- `inkCenterOffset` called with the measured `italic` Hindi metrics `{ actualBoundingBoxLeft: 64, actualBoundingBoxRight: 84 }`
  - → `10`
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
- `video-processor-logic.js` read as source text
  - → the new helper signatures take only metrics / a measure callback / coordinates, with no language or script
    argument (regex on `inkBounds(metrics)`, `inkCenterOffset(metrics)`, `centeredInkX(centerX, metrics)`,
    `fitAndCenterLine(measureAtSize, text, centerX, {`, `layoutCenteredInkBlock(entries, centerX, padding = 0)`)
  - → still references no `window` / `document` / `navigator` and no URL scheme (existing guard passes)

### Task 2 - Ink-centre the CTA fitted lines (`video-processor.web.js`, `video-processor-web-guard.test.js`)

- `video-processor.web.js` read as source text
  - → imports `fitAndCenterLine` from `./video-processor-logic.js`
  - → `drawFittedLine` no longer calls `strokeText(text, centerX` or `fillText(text, centerX`
  - → `drawFittedLine` draws at the anchor returned by `fitAndCenterLine` (source references `fitAndCenterLine`)
- `fitAndCenterLine` unit cases in Task 1
  - → CTA headline / deadline / URL anchors are ink-centred (behaviour covered there)

### Task 3 - Ink-centre subtitles + ink-sized box (`video-processor.web.js`, `video-processor-web-guard.test.js`)

- `video-processor.web.js` read as source text
  - → imports `layoutCenteredInkBlock` from `./video-processor-logic.js`
  - → the subtitle block calls `layoutCenteredInkBlock(`
  - → subtitle translation lines are drawn with `fillText(trLines[i], trAnchors[i], ...)` and English lines with
    `fillText(enLines[i], enAnchors[i], ...)` (no `fillText(..., centerX` in the subtitle block)
  - → the subtitle background box is drawn from `boxX` / `boxWidth` (no `longestLineWidth` remains)
  - → the translation font assignment still contains `italic` (the design distinction is preserved)
  - → no language/script identifier or per-language font list is introduced by this change
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
- Root cause reproduced during planning with Playwright Chromium (the only browser that can run the canvas pixel
  check here). `italic` at 80px with the subtitle stack: Latin `Hello` `L=89.2, R=88.7` (offset 0), Bengali
  `বাংলা` `L=55, R=76` (+10), Hindi `हिन्दी` `L=64, R=84` (+9), Japanese `日本語` `L=111, R=129` (+8.5), Tamil
  `தமிழ்` `L=87, R=96` (+3.5). Applying `centeredInkX` moved every offset to ≤1 px. With `Noto Sans Bengali`
  loaded, `italic` Bengali measured `338/361` → still +11 px, proving font loading is not the cause. WebKit 26.4
  (Playwright 1.60) was also checked: non-italic complex text is centred there.
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
   native language whose font has no true italic face (Bengali or Hindi both reproduce).
2. In the generated final video, the translated subtitle (drawn in italic under the English cue) should sit
   visually centred inside its background box — not shifted right as today.
3. Repeat with Spanish (`Practica inglés conmigo gratis`) and confirm it looks unchanged (offset is `0` for a
   real italic face).
4. Confirm the subtitle background box still fully covers the translated text.

**Non-automatable / structural checks:**

- The offset is exactly `0` when `actualBoundingBoxLeft === actualBoundingBoxRight`, so Latin/Spanish output must
  be visually identical to before.
- The centering helpers must contain no language/script identifiers, no `italic` handling, and no font list;
  they operate on measured metrics only. Adding a future language must require no change to them.
- Preserve the `italic` translation style; do not "fix" the skew by removing it.
- Preserve existing comments and `console.log` statements per `agents.md`; update the `drawFittedLine` comment to
  describe the new anchor behaviour (the old "Take the larger of advance and bounding box" note moves to
  `inkBounds`).
- Do not touch `ensureFontsReady()`, `index.html`, the subtitle font stack, or the native renderer in this story.
