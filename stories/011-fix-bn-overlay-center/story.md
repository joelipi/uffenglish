# Fix recap subtitle centering: drop synthetic italic, anchor on ink (language-agnostic)

## Context

The end-of-lesson recap video is not a DOM overlay: `drawTextOverlay()` in
`src/modules/video/video-processor.web.js` (line 807) paints every recap string onto the canvas that
MediaRecorder captures, so each character is positioned by Canvas 2D text metrics. Two of its three text
blocks set `context.textAlign = 'center'` (share CTA at line 887, subtitles at line 930).

`textAlign = 'center'` centres the text's ADVANCE width, not its visible ink: per the HTML spec / MDN, with
`'center'` the text's left edge is placed at `x - measureText(text).width / 2`. When the glyph ink is not
symmetric about the advance midpoint the rendered glyphs sit visibly off-centre.

**Verified root cause (reproduced during planning across Chromium, Firefox and WebKit):** the subtitle
translation line is drawn in `italic` (`video-processor.web.js:945, 965, 1011`). When the resolved font has no
true italic face, the browser applies synthetic oblique, which pushes the glyph ink right of the advance centre.
Measured at 46px with the subtitle stack on a 1080-wide canvas:

| string | Chromium | Firefox | WebKit |
|---|---|---|---|
| Bengali `italic` | **+5.5 px** | **+4.5 px** | **+5.5 px** |
| Bengali **normal** | −0.5 px | −0.5 px | −0.5 px |
| Hindi `italic` | +2.5 px | +3.5 px | +3.5 px |
| Hindi **normal** | −1.5 px | −1.5 px | −1.5 px |
| Spanish `italic` (real italic face) | 0 px | +3 px | +2 px |

**The naive fix does not work on Safari/WebKit.** An anchor correction computed from
`actualBoundingBoxLeft/Right` works on Chromium and Firefox, but WebKit reports the *advance box* for
synthetic-oblique complex text: for `italic` Bengali it returned `actualBoundingBoxLeft = actualBoundingBoxRight
= 158.3` (`left + right === width`), while the rendered ink was +5.5 px off. The computed offset is therefore
`0` and the text stays off-centre. (Chromium and Firefox return the true ink box, so a metric-only fix works
there.) A metric-only fix is thus engine-dependent and unacceptable for a product that targets iPad/Safari.

**Therefore the fix is to stop applying synthetic italic** to the translation line: draw it `normal` (it is
already visually distinct by being smaller and on its own line). Verified: with `italic` removed, the offset is
≤2 px in **all three** engines for Bengali, Hindi and Spanish. In addition, centre every overlay line on its
measured ink bounding box to remove the residual advance-vs-ink asymmetry where the engine reports true ink
(this also fixes the non-italic CTA deadline line, which measures −3.5 px in every engine).

**Font loading is NOT the cause.** Loading `Noto Sans Bengali` does not change the synthetic-oblique shift
(italic Bengali still measured +11 px at 80px with the family loaded), and no Bengali family ships a true italic
face. The app loads no web font at all today (`ensureFontsReady()` lines 99-110 names
`Orbitron`/`Plus Jakarta Sans`, never declared in the React app; only `public/landing.html` imports them).

**This is not a Bengali (or hi/bn) bug** — it is the rule for any font without a true italic face, and the app
will keep adding languages whose fallback fonts may or may not have one. The fix must therefore be language-
and script-agnostic: no per-language branching, no script detection, no "does this font have italics" test.

Existing code defects: the non-italic share-CTA path (`drawFittedLine`, lines 782-805) measures
`actualBoundingBoxLeft/Right` only to shrink the font (`inkWidth`, lines 789-798) and still draws at the raw
`centerX` (lines 802-803); the subtitle block draws at `centerX` (lines 1013, 1020) and sizes its background
box from `measureText(line).width` (advance; lines 959-969, 996-1001). History: commit `8074a42` added the
`inkWidth` fit and the Bengali CTA font stack to stop Bengali overflow, but did not change the anchor or the
italic style.

## Out of Scope

- Any language- or script-specific logic: no language parameter, no script detection, no per-language font
  list, no "does this font have italics" feature test. Future languages are covered by construction.
- Keeping the italic look via a one-time pixel-scan ink measurement (draw to an offscreen canvas, scan the ink
  box, cache per text). It would preserve italic and work in every engine, but it is significantly more complex
  and harder to unit-test than dropping synthetic italic. Flagged as the alternative if the italic style must
  stay.
- Adding Bengali families (or any language's families) to the subtitle font stack, or loading a web font in
  `ensureFontsReady()` / `index.html`. Verified not to affect the shift. (The pre-existing CTA stack at line 885
  still lists Bengali families; it is left untouched.)
- The native renderer `src/modules/video/video-processor.native.jsx`: its recap text is React Native
  `<Text textAlign: 'center'>` (lines 388, 395, 464), which the platform centres on ink, and it has no
  importer / RN dependency. Not the reported path.
- Vertical centering, line-height, and ascent math. The report is horizontal.
- The fluency score card (`CALCULATING FLUENCY` / `FLUENCY SCORE`, lines 818-875): Orbitron with Latin
  digits/labels, near-symmetric, not reported.
- Making `wrapText()` (lines 759-775) ink-aware. It wraps on advance width; the reported defect is centering,
  not wrapping. The subtitle box is sized from ink (Task 4), so wrapped lines remain covered.
- Changing any share-CTA copy, the `example.com` placeholder, the 48h deadline, or `buildShareUrl` /
  `buildShareDeadline` / `resolveOverlayElements`.

## Implementation approach

### 1. Drop synthetic italic from the translation (primary, cross-engine fix)

Draw the translated subtitle line `normal` instead of `italic`. Only the font-style changes; the size
(`trFontSize = round(enFontSize * 0.85)`), the line heights, and the background box are unchanged, so the
translation stays visually distinct from the English cue. Concretely, in `video-processor.web.js`:

- `:945` — the translation `wrapText` font becomes `${trFontSize}px "Plus Jakarta Sans", sans-serif`.
- `:1011` — the translation draw font becomes `${trFontSize}px "Plus Jakarta Sans", sans-serif`.
- `:965` — the translation measurement font (inside the box block that Task 4 replaces) drops `italic`.

No language check is involved: the change applies to every language equally, and any future language whose
font lacks an italic face is handled automatically because synthetic oblique is never requested.

### 2. Ink-anchor helpers in `src/modules/video/video-processor-logic.js`

Add these exports. The file must stay platform-agnostic (no `window`/`document`/`navigator`, no URL scheme —
enforced by the existing guard at `video-processor-logic.test.js:281-302`). They operate on a plain metrics
object / measure callback, so they are unit-testable in jsdom without a canvas.

```js
// Ink metrics for canvas text, relative to the alignment point set by
// context.textAlign. With textAlign='center' that point is the advance-width
// midpoint; actualBoundingBoxLeft/Right describe where the glyph ink actually
// is (positive = that direction). Falls back to advance-only when a browser
// omits the ink fields. Deliberately takes no language/script argument.
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

This is a best-effort residual correction: it fully centres on Chromium/Firefox (true ink metrics) and is a
no-op where an engine reports advance-box metrics (WebKit, synthetic-oblique complex text). The cross-engine
guarantee comes from Step 1, not from this step.

### 3. Font decision — no font changes

Decision: no web font is added, and no language-specific families are added to the subtitle stack. Rationale:

1. Verified: loading `Noto Sans Bengali` does not change the synthetic-oblique shift, and no Bengali family
   ships a true italic face. Font loading cannot fix the report.
2. Once synthetic italic is dropped, the text centres in every engine without any font dependency.
3. The existing `"Plus Jakarta Sans", sans-serif` stack already ends in a generic family, so the browser picks a
   script-capable font for any language the app adds later.
4. Adding a web font is a new external runtime dependency for a bug fix, and (because `"Plus Jakarta Sans"` is
   not loaded) `"Noto Sans Bengali"` would also capture Latin glyphs and change the already-correct
   Latin/Spanish rendering.

Assumption (explicit): if deterministic cross-OS glyph shapes or per-language font preferences are later
wanted, that is a separate rendering-quality story.

### 4. Web wiring — `src/modules/video/video-processor.web.js`

Add `fitAndCenterLine`, `layoutCenteredInkBlock` to the existing `./video-processor-logic.js` import (line 9).

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

Subtitles (lines 929-1023): use the normal (non-italic) translation font and compute the box plus per-line
anchors from `layoutCenteredInkBlock`:

```js
const measureWith = (font) => (text) => {
    context.font = font;
    return context.measureText(text);
};
const enEntries = enLines.map(text => ({ text, measure: measureWith(`bold ${enFontSize}px "Plus Jakarta Sans", sans-serif`) }));
const trEntries = trLines.map(text => ({ text, measure: measureWith(`${trFontSize}px "Plus Jakarta Sans", sans-serif`) }));
const { anchors, boxX, boxWidth } = layoutCenteredInkBlock([...enEntries, ...trEntries], centerX, boxPadding);
const enAnchors = anchors.slice(0, enLines.length);
const trAnchors = anchors.slice(enLines.length);
```

- Delete the now-unused `longestLineWidth` measurement block (lines 959-969); its only consumer was the box.
- Box: `context.fillRect(boxX, blockBottomY - totalTextHeight - boxPadding, boxWidth, totalTextHeight + boxPadding * 2)`.
- Drawing: keep `context.textAlign = 'center'`; draw translation lines with
  `context.fillText(trLines[i], trAnchors[i], lineY)` and English lines with
  `context.fillText(enLines[i], enAnchors[i], lineY)` (bottom-up order and y stepping unchanged). Set the
  translation draw font to `${trFontSize}px "Plus Jakarta Sans", sans-serif` (no `italic`).

### 5. Edge cases

- Metrics missing / NaN ink fields (older engines): `inkBounds` falls back to advance width and zero offset →
  identical to today's behaviour.
- Symmetric ink (Latin/Spanish, real italic face): `inkCenterOffset === 0` → draws at `centerX`, no visual
  change.
- Engine reports advance-box metrics for some text (WebKit synthetic oblique): offset is `0` → no shift, no
  regression; the Step 1 font-style change is what centres the text there.
- Ink narrower than advance (normal): `inkWidth` stays the advance, so fitting is not loosened.
- Ink wider than advance (overhang / complex script): `inkWidth = left + right`; fit shrinks until the ink fits
  and the anchor centres it.
- Overhang (negative `actualBoundingBoxLeft`): the signed sum yields the true ink width (the old `Math.abs`
  version could over-shrink).
- Empty subtitle / no translation: `layoutCenteredInkBlock` is only called when `enText.trim() !== ''`; empty
  entries return `anchors: []` and a padding-only box.
- `baseSize <= minSize`: `fitAndCenterLine` still measures once and centres; the loop guard is `size > minSize`
  exactly as today.
- Mixed English + translation lines in one subtitle block: the box half-width is the max across all lines' ink;
  each line is centred on its own ink.

## Tasks

### Task 1 - Drop synthetic italic from the translation (`video-processor.web.js`, `video-processor-web-guard.test.js`)

- `video-processor.web.js` read as source text
  - → no translation font assignment contains `italic` (the `wrapText` font, the draw font, and the measurement
    font all use `${trFontSize}px "Plus Jakarta Sans", sans-serif`)
  - → the English cue font still uses `bold`
- Cross-engine behaviour (manual, Notes): with `italic` removed, Bengali/Hindi/Spanish subtitle lines centre
  within 2 px in Chromium, Firefox and WebKit (measured during planning)

### Task 2 - Language-agnostic ink-centering helpers (`video-processor-logic.js`, `video-processor-logic.test.js`)

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
- `inkCenterOffset` called with the measured `italic` Bengali metrics `{ actualBoundingBoxLeft: 151.7, actualBoundingBoxRight: 164.7 }`
  - → `6.5`
- `inkCenterOffset` called with `{ actualBoundingBoxLeft: 80, actualBoundingBoxRight: 40 }`
  - → `-20`
- `inkCenterOffset` called with `{}` / `null`
  - → `0`
- `centeredInkX(500, { actualBoundingBoxLeft: 151.7, actualBoundingBoxRight: 164.7 })`
  - → `493.5`
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

### Task 3 - Ink-centre the CTA fitted lines (`video-processor.web.js`, `video-processor-web-guard.test.js`)

- `video-processor.web.js` read as source text
  - → imports `fitAndCenterLine` from `./video-processor-logic.js`
  - → `drawFittedLine` no longer calls `strokeText(text, centerX` or `fillText(text, centerX`
  - → `drawFittedLine` draws at the anchor returned by `fitAndCenterLine` (source references `fitAndCenterLine`)
- `fitAndCenterLine` unit cases in Task 2
  - → CTA headline / deadline / URL anchors are ink-centred where the engine reports true ink

### Task 4 - Ink-centre subtitles + ink-sized box (`video-processor.web.js`, `video-processor-web-guard.test.js`)

- `video-processor.web.js` read as source text
  - → imports `layoutCenteredInkBlock` from `./video-processor-logic.js`
  - → the subtitle block calls `layoutCenteredInkBlock(`
  - → subtitle translation lines are drawn with `fillText(trLines[i], trAnchors[i], ...)` and English lines with
    `fillText(enLines[i], enAnchors[i], ...)` (no `fillText(..., centerX` in the subtitle block)
  - → the subtitle background box is drawn from `boxX` / `boxWidth` (no `longestLineWidth` remains)
  - → no language/script identifier or per-language font list is introduced by this change
- `layoutCenteredInkBlock` unit cases in Task 2
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
- Cross-browser reproduction during planning (Playwright: Chromium, Firefox 150, WebKit 26.4). `italic` at 46px
  on a 1080-wide canvas, subtitle stack: Bengali +5.5 / +4.5 / +5.5 px, Hindi +2.5 / +3.5 / +3.5 px
  (Chromium/Firefox/WebKit); the same strings `normal` measured −0.5 to −1.5 px in every engine. WebKit returned
  `actualBoundingBoxLeft = actualBoundingBoxRight = 158.3` for `italic` Bengali (`left + right === width`), i.e.
  the advance box, so an ink-anchor correction computes `0` there and the rendered ink stays +5.5 px off. A
  pixel-extent check (offscreen canvas, scan for non-background pixels) was used to measure the rendered ink.
- Canvas semantics confirmed from MDN: `TextMetrics.actualBoundingBoxLeft/Right` are measured from the
  `textAlign` alignment point (positive = that direction), and `textAlign = 'center'` places the text's left edge
  at `x - measureText(text).width / 2` (advance width, not ink).
- `video-processor-logic.js` is shared with the (unused) native renderer and is kept platform-agnostic; the new
  helpers take plain objects / callbacks only.
- CI (`.github/workflows/deploy.yml`, `playwright.yml`) runs `npm test -- --run` (vitest). There is no lint
  script in `package.json`; `.eslintrc.json` only targets a legacy `js/**` path.

## Notes

**Manual verification (canvas pixels cannot be asserted in jsdom; Tasks 1-4 cover the wiring):**

1. `npm run dev`, open `/course/model/lesson/wf` (or any `shareCta` lesson), complete the steps, and choose a
   non-Latin native language (Bengali or Hindi).
2. In the generated final video, the translated subtitle should sit centred under the English cue — no longer
   shifted right — and the English cue should be unchanged.
3. Repeat with Spanish and confirm it looks unchanged.
4. Confirm the subtitle background box still fully covers the translated text.

**Confidence (from the planning-time cross-browser test):**

- High that dropping synthetic italic centres the translation in every engine (measured ≤2 px in Chromium,
  Firefox and WebKit).
- Low that a metric-only ink-anchor fix would have worked on its own — it is a no-op on WebKit for exactly the
  reported case.
- The residual ink-anchor (Tasks 2-4) is a best-effort extra for Chromium/Firefox; it is not relied upon for the
  cross-engine guarantee.

**Non-automatable / structural checks:**

- The offset is exactly `0` when `actualBoundingBoxLeft === actualBoundingBoxRight`, so Latin/Spanish output must
  be visually identical to before.
- The centering helpers must contain no language/script identifiers and no font list; they operate on measured
  metrics only. Adding a future language must require no change to them.
- Preserve existing comments and `console.log` statements per `agents.md`; update the `drawFittedLine` comment to
  describe the new anchor behaviour (the old "Take the larger of advance and bounding box" note moves to
  `inkBounds`).
- Do not touch `ensureFontsReady()`, `index.html`, the subtitle font stack, or the native renderer in this story.
