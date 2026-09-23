# Drop italic from video overlay text (fixes recap subtitle centring; language-agnostic)

## Context

The end-of-lesson recap video is not a DOM overlay: `drawTextOverlay()` in
`src/modules/video/video-processor.web.js` (line 807) paints every recap string onto the canvas that
MediaRecorder captures, so each character is positioned by Canvas 2D text metrics. The translated subtitle
line is drawn in `italic` (`video-processor.web.js:945, 965, 1011`).

`textAlign = 'center'` centres the text's ADVANCE width, not its visible ink (MDN: with `'center'` the text's
left edge is placed at `x - measureText(text).width / 2`). When the resolved font has no true italic face the
browser applies synthetic oblique, which pushes the glyph ink right of the advance centre. Measured during
planning at 46px with the subtitle stack on a 1080-wide canvas:

| string | Chromium | Firefox | WebKit |
|---|---|---|---|
| Bengali `italic` | **+5.5 px** | **+4.5 px** | **+5.5 px** |
| Bengali normal | −0.5 px | −0.5 px | −0.5 px |
| Hindi `italic` | +2.5 px | +3.5 px | +3.5 px |
| Hindi normal | −1.5 px | −1.5 px | −1.5 px |
| Spanish `italic` (real italic face) | 0 px | +3 px | +2 px |

A metric-based correction (measure `actualBoundingBoxLeft/Right`, shift the anchor) was tested and **fails on
Safari/WebKit**: WebKit reports the *advance box* for synthetic-oblique complex text — for `italic` Bengali it
returned `actualBoundingBoxLeft = actualBoundingBoxRight = 158.3` (`left + right === width`) while the rendered
ink was +5.5 px off, so the computed offset is `0` and the text stays off-centre. The metric fix works only on
Chromium/Firefox and is therefore not a viable fix for a product that targets iPad/Safari.

**Decision (user-directed): drop the italic style from video overlay text.** The translation is already
visually distinct by being smaller and on its own line, so removing italic loses no meaning. Verified: with
italic removed, Bengali/Hindi/Spanish centre within 2 px in **all three** engines.

**Scope = text that appears as an overlay on a video.** That is:

1. The canvas recap overlay (`video-processor.web.js`) — the concatenated video.
2. The DOM overlay text on lesson videos — `ivp-overlay-text` in `SimpleVideoPlayer.web.jsx:367` and
   `InteractiveVideoPlayer.web.jsx:392`.
3. The intro-video overlay — `intro-call-subtitle` in `IncomingVideoWidget.jsx:309-311` and its CSS.

All three DOM cases are italicised today by a combination of an `<i>` element and the app-wide CSS rule
`[lang]:not([lang="en"]):not([lang="EN"]) { font-style: italic; }` (`src/assets/css/app.css:304-307`).

**Explicitly NOT in scope:** the global `[lang]` rule and non-video UI (chat bubbles, decision buttons,
hints, mic status, view-and-continue, etc.) keep their italic. The DOM overlays are de-italicised with a
video-overlay-scoped CSS override so the global rule is left untouched.

**Font loading is NOT the cause.** Loading `Noto Sans Bengali` does not change the synthetic-oblique shift
(italic Bengali still measured +11 px at 80px with the family loaded), and no Bengali family ships a true
italic face. No web font is needed. The app loads no web font today (`ensureFontsReady()` lines 99-110 names
`Orbitron`/`Plus Jakarta Sans`, never declared in the React app; only `public/landing.html` imports them).

**This is not a Bengali (or hi/bn) bug** — it is the rule for any font without a true italic face, and the app
will keep adding languages. Removing the italic request is language- and script-agnostic by construction: no
language parameter, no script detection, no "does this font have italics" test.

**Minor residual (out of scope):** even non-italic, a few strings have a small advance-vs-ink asymmetry (the
share-CTA deadline line measured −3.5 px in every engine because of its trailing colon). It is ~0.3 % of the
frame width and was not the reported defect; a metric-anchor follow-up is noted in Notes but not part of this
story.

## Out of Scope

- The global `[lang]` italic rule (`app.css:304-307`) and any non-video UI italic (chat bubbles, decision
  buttons, hints, mic status, view-and-continue, bilingual labels). They must remain unchanged.
- A metric-based ink-anchor correction. It was tested and is a no-op on WebKit for the reported case; it is
  superseded by removing the italic request. (Optional follow-up in Notes.)
- Loading a web font or adding language-specific font families to the subtitle stack.
- The native renderer `src/modules/video/video-processor.native.jsx:394` (`subtitleTranslationText:
  fontStyle: 'italic'`). It is dead code (no importer / RN dependency) and does not ship.
- The R2 per-segment export (`renderStepToBlob`, `{ silent: true }`): it renders no overlay, so it has no
  italic text.
- Vertical centering, line-height, ascent math, `wrapText` wrapping, the fluency score card, or any share-CTA
  copy / URL / deadline behaviour.
- Per-language or script-specific logic of any kind.

## Implementation approach

### 1. Canvas recap overlay — `src/modules/video/video-processor.web.js`

Remove `italic` from the three translated-subtitle font assignments, leaving the normal face (size, line
heights, and the background box are unchanged, so the translation stays visually distinct):

- `:945` — translation `wrapText` font → `${trFontSize}px "Plus Jakarta Sans", sans-serif`.
- `:965` — translation measurement font (used for the box width) → same normal face.
- `:1011` — translation draw font → same normal face.

The English cue keeps `bold`. No language check is involved.

### 2. DOM video overlays — React + CSS

Remove the `<i>` element from the localized span in each video overlay (the `lang` attribute stays for
font/a11y semantics):

- `src/components/SimpleVideoPlayer.web.jsx:367` →
  `<span lang={overlayBilingual.lang}>{overlayBilingual.localized}</span>`
- `src/components/InteractiveVideoPlayer.web.jsx:392` → same change.
- `src/components/IncomingVideoWidget.jsx:309-311` →
  `<span lang={subtitle.lang}>{subtitle.localized}</span>`

`<i>` alone is not enough: the app-wide `[lang]` rule still italicises these spans. Add a video-overlay-scoped
override in `src/assets/css/app.css`, immediately after the global rule, and remove the standalone italic from
`.intro-call-subtitle`:

```css
/* Video overlay text stays upright: synthetic oblique (used when a font has no
   true italic face) shifts complex-script glyphs and breaks centring in the
   canvas recap export. Scoped to video overlays; the global [lang] italic rule
   for the rest of the app is unchanged. */
.ivp-overlay-text [lang],
.intro-call-subtitle [lang] {
    font-style: normal !important;
}
```

The `!important` is required because the global rule `[lang]:not([lang="en"]):not([lang="EN"])` has
specificity (0,3,0) while `.ivp-overlay-text [lang]` is (0,2,0); this file already uses `!important` for
similar overrides (e.g. `.ivp-subtitles`).

Also remove `font-style: italic;` from the `.intro-call-subtitle` block (`app.css:1303-1306`) — it is an
overlay-specific style, and the `<span lang>` override above covers the localized text.

### 3. Font decision — no font changes

No web font is added and no language-specific families are added. Removing the synthetic italic makes the text
centre in every engine without any font dependency, and the existing `"Plus Jakarta Sans", sans-serif` stack
already lets the browser fall back to a script-capable font for any language.

### 4. Why this is language-agnostic

The change removes a `font-style` request and an `<i>` element; it contains no language/script identifier and no
font list. A future language whose fallback font lacks an italic face is handled automatically because synthetic
oblique is never requested anywhere in the video overlay.

## Tasks

### Task 1 - Drop italic from the canvas recap overlay (`video-processor.web.js`, `video-processor-web-guard.test.js`)

- `video-processor.web.js` read as source text
  - → contains no `italic` token (all three translated-subtitle font assignments use the normal face)
  - → the English subtitle font still uses `bold`
  - → `${trFontSize}` is still used for the translation wrap, measurement and draw fonts (size unchanged)
- Manual cross-browser check (Notes)
  - → Bengali/Hindi/Spanish subtitle lines centre within 2 px in Chromium, Firefox and WebKit

### Task 2 - Drop italic from DOM video overlays (`SimpleVideoPlayer.web.jsx`, `InteractiveVideoPlayer.web.jsx`, `IncomingVideoWidget.jsx`, `app.css`, `video-overlay-italic.test.js`)

- `SimpleVideoPlayer.web.jsx` and `InteractiveVideoPlayer.web.jsx` read as source text
  - → the `ivp-overlay-text` localized span is `<span lang={overlayBilingual.lang}>{overlayBilingual.localized}</span>`
    (no `<i>` child)
  - → the `lang` attribute is retained
- `IncomingVideoWidget.jsx` read as source text
  - → the `intro-call-subtitle` localized span has no `<i>` child and retains `lang`
- `app.css` read as source text
  - → the `.intro-call-subtitle` block no longer contains `font-style: italic`
  - → a rule exists that sets `font-style: normal` for `.ivp-overlay-text [lang]` and
    `.intro-call-subtitle [lang]`
- `src/components/video-overlay-italic.test.js` (new, vitest)
  - → asserts the three JSX files contain no `<i>` inside the video-overlay localized spans
  - → asserts the `.intro-call-subtitle` rule has no italic and the overlay `[lang]` override exists

### Task 3 - Scope guards: global rule and non-video UI unchanged (`app.css`, components, `video-overlay-italic.test.js`)

- `app.css` read as source text
  - → the global rule `[lang]:not([lang="en"]):not([lang="EN"]) { font-style: italic; }` is byte-for-byte
    unchanged
- Non-video UI components read as source text (chat bubbles, `DecisionButtons.jsx`, `Hints.jsx`,
  `MicStatusText.jsx`, `ViewAndContinueButtons.jsx`, `ContinueWidgetBubble.jsx`)
  - → their localized `<i>` / `lang` italic usage is unchanged (no accidental app-wide de-italicisation)
- `video-overlay-italic.test.js` asserts both of the above

## Technical Context

- No new npm dependencies. Unit tests use the existing vitest 4.1.6 + jsdom 29.1.1 setup
  (`vitest.config.js`; `*.test.js` colocated, `tests/**` and `*.spec.js` are Playwright). Verified baseline:
  `npx vitest run src/modules/video/` → 7 files / 87 tests pass.
- The canvas change is a font-style string change with no arithmetic, so no canvas/node-canvas is needed. Tests
  are source-guard assertions (the established pattern in `video-processor-web-guard.test.js`) plus a new
  component/CSS source-guard test; the real cross-engine behaviour is verified manually (Notes).
- Cross-browser reproduction during planning (Playwright: Chromium, Firefox 150, WebKit 26.4) with a
  pixel-extent check (draw to a canvas, scan for non-background pixels). `italic` at 46px on a 1080-wide canvas,
  subtitle stack: Bengali +5.5 / +4.5 / +5.5 px, Hindi +2.5 / +3.5 / +3.5 px (Chromium/Firefox/WebKit); the same
  strings normal measured −0.5 to −1.5 px in every engine. WebKit returned
  `actualBoundingBoxLeft = actualBoundingBoxRight = 158.3` for `italic` Bengali, i.e. the advance box, so a
  metric-anchor correction computes `0` there.
- `app.css:304-307` is the app-wide italic rule; the video-overlay override must sit after it and use
  `!important` (or equivalent specificity) to win.
- CI (`.github/workflows/deploy.yml`, `playwright.yml`) runs `npm test -- --run` (vitest). There is no lint
  script in `package.json`; `.eslintrc.json` only targets a legacy `js/**` path.

## Notes

**Manual verification (rendering cannot be asserted in jsdom):**

1. `npm run dev`, open `/course/model/lesson/wf` (or any `shareCta` lesson), complete the steps, and choose a
   non-Latin native language (Bengali or Hindi).
2. In the generated final video, the translated subtitle sits centred under the English cue and is upright (not
   slanted); the English cue is unchanged.
3. Repeat with Spanish and confirm it looks unchanged.
4. Play a lesson video (`/course/model/lesson/g`) and the intro video and confirm the `ivp-overlay-text` /
   `intro-call-subtitle` translations are upright and centred, while chat bubbles / decision buttons / hints
   still show italicized translations.

**Confidence (from the planning-time cross-browser test):**

- High that dropping the italic request centres the video overlay text in every engine (measured ≤2 px in
  Chromium, Firefox and WebKit).
- The metric-based anchor approach (previous plan) is abandoned: it is a no-op on WebKit for exactly the
  reported case.

**Optional follow-up (not part of this story):** the non-italic share-CTA deadline line still has a ~−3.5 px
ink asymmetry from its trailing colon. A metric-anchor correction (`centerX - (actualBoundingBoxRight -
actualBoundingBoxLeft)/2`) fixes it on Chromium/Firefox and is harmless elsewhere; it can be a separate story if
that residual matters.

**Non-automatable / structural checks:**

- The global `[lang]` italic rule and all non-video UI italic must be unchanged.
- No language/script identifier, script detection, or per-language font list is introduced.
- Preserve existing comments and `console.log` statements per `agents.md`.
- Do not touch `ensureFontsReady()`, `index.html`, the subtitle font stack, or the native renderer.
