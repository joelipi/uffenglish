# Warn mobile learners to rotate to portrait before recording

## Context

On a phone/tablet held in landscape, the camera stream is landscape, so the
recorded clips — and therefore the concatenated recap and the R2-published
friend prompts — come out in 16:9 landscape instead of the intended 9:16
portrait framing. iOS Safari will not deliver a true 9:16 stream while the
device is landscape, and forcing it via camera constraints fights WebKit's
rotation/rendering quirks. The pragmatic fix is to detect this case and tell the
learner to rotate the device before they record.

The camera constraint is landscape on every non-Windows platform
(`src/modules/speech/speech.web.js:26-32`: `aspectRatio: { ideal: 16 / 9 }`,
portrait `9/16` only when `isWindows`). Mobile detection already exists ad hoc
in several components (`IncomingVideoWidget.jsx:9-10`, `SimpleVideoPlayer.web.jsx:11-12`,
`InteractiveVideoPlayer.web.jsx:19-20`) but there is no shared helper and no
orientation handling anywhere in `src/`.

Scope: warn on iOS/Android when the viewport is landscape during a lesson.
Actually forcing the recording to portrait (constraints or canvas compositing)
is explicitly out of scope for this story.

## Out of Scope

- Changing camera constraints or compositing the recording into a portrait
  canvas — this story only warns; it does not change what is recorded.
- Desktop/laptop browsers: they are never warned (no OS rotation; a landscape
  webcam is expected there).
- Blocking the lesson or recording — the warning is dismissible; the learner may
  keep going in landscape after dismissing it.
- Native (`*.native.jsx`) rendering beyond a no-op stub.

## Implementation approach

### Decision rule (pure, shared)

Add `src/modules/utils/orientation.js` (no React, no DOM APIs — plain
predicates, unit-testable):

```js
export function isLandscape(width, height) {
    return Number.isFinite(width) && Number.isFinite(height) && width > height;
}

export function isMobileUserAgent({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
    const ua = String(userAgent || '');
    const ios = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
    const android = /Android/.test(ua);
    return ios || android;
}

export function shouldWarnLandscape({ isMobile, landscape } = {}) {
    return !!isMobile && !!landscape;
}
```

Rules:
- **Mobile** = iOS (`iPad|iPhone|iPod` UA, or `MacIntel` + `maxTouchPoints > 1`
  for iPadOS) **or** Android UA. Everything else (desktop Mac/Windows/Linux,
  even with touch) is not mobile.
- **Landscape** = `width > height`. Equal/unknown dimensions are not landscape.
- **Warn** = mobile **and** landscape. Mobile portrait → no warning. Desktop
  landscape → no warning.

### Component

Add `src/components/widgets/LandscapeWarning.web.jsx` (+ a
`LandscapeWarning.native.jsx` no-op returning `null`, resolved by the existing
platform-extension convention — see `InteractiveVideoPlayer`). It:

- reads `window.innerWidth` / `window.innerHeight` through `isLandscape`
  (synchronous initial value, so there is no first-paint flash),
- reads `navigator.userAgent` / `navigator.platform` / `navigator.maxTouchPoints`
  through `isMobileUserAgent`,
- subscribes to `resize` and `orientationchange` on `window`, updating React
  state (no direct DOM manipulation; `agents.md` §1),
- keeps a `dismissed` React state. Clicking the dismiss control sets it `true`.
  When the viewport returns to portrait, `dismissed` resets to `false`, so a
  later re-entry into landscape warns again,
- renders, only when `shouldWarnLandscape(...) && !dismissed`:

```jsx
<div id="landscape-warning" role="alert" className="landscape-warning">
    <i className="bi bi-exclamation-triangle-fill landscape-warning-icon" aria-hidden="true"></i>
    <p className="landscape-warning-text">
        {Strings.get('rotate_device_portrait', userData?.native_language || 'en')}
    </p>
    <button
        id="landscape-warning-dismiss"
        type="button"
        className="landscape-warning-dismiss"
        aria-label={Strings.get('dismiss', userData?.native_language || 'en')}
        onClick={() => setDismissed(true)}
    >
        <i className="bi bi-x-lg" aria-hidden="true"></i>
    </button>
</div>
```

Mount it once in `LessonContainer` next to `<SystemMessageOverlay />`
(`src/components/LessonContainer.jsx:124`), importing
`./widgets/LandscapeWarning` (extensionless, so web resolves `.web.jsx` and
native resolves `.native.jsx`).

### Styles

Add a prominent, dismissible warning banner to `src/assets/css/app.css`, above
the lesson overlays (`top-overlay` z 35, `bottom-overlay` z 1050):

```css
.landscape-warning {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2000;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    background: #b3261e;
    color: #fff;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}
.landscape-warning-icon {
    font-size: 1.5rem;
    flex-shrink: 0;
}
.landscape-warning-text {
    flex: 1;
    margin: 0;
    font-weight: 600;
}
.landscape-warning-dismiss {
    flex-shrink: 0;
    background: transparent;
    border: 0;
    color: inherit;
    font-size: 1.25rem;
    padding: 4px;
    line-height: 1;
}
```

### String

Add two keys to the table in `src/data/strings.js`. Every key must carry
Devanagari `hi` and Bengali `bn` copy (`src/data/strings.test.js:16-31`).

`rotate_device_portrait` — deliberate, explicit that the recording will be
spoiled:

| Lang | Value |
| --- | --- |
| en | Recording in landscape will mess up your video. Rotate your device to portrait before you record. |
| es | Grabar en horizontal arruinará tu video. Gira tu dispositivo a vertical antes de grabar. |
| pt | Gravar na horizontal vai estragar seu vídeo. Gire o dispositivo para vertical antes de gravar. |
| fr | Enregistrer en paysage gâchera votre vidéo. Tournez votre appareil en mode portrait avant d'enregistrer. |
| hi | लैंडस्केप में रिकॉर्ड करने से आपका वीडियो खराब हो जाएगा। रिकॉर्ड करने से पहले अपने डिवाइस को पोर्ट्रेट में घुमाएँ। |
| bn | ল্যান্ডস্কেপে রেকর্ড করলে আপনার ভিডিও নষ্ট হয়ে যাবে। রেকর্ড করার আগে আপনার ডিভাইসটি পোর্ট্রেটে ঘোরান। |

`dismiss` — the dismiss button's accessible name:

| Lang | Value |
| --- | --- |
| en | Dismiss |
| es | Descartar |
| pt | Dispensar |
| fr | Ignorer |
| hi | खारिज करें |
| bn | খারিজ করুন |

## Tasks

### Task 1 - Pure orientation predicates and unit tests

- `isLandscape(844, 390)` called
  - → `true`
- `isLandscape(390, 844)` called
  - → `false`
- `isLandscape(844, 844)` called (square)
  - → `false`
- `isLandscape(undefined, 390)` / `isLandscape(844, NaN)` called
  - → `false` (non-finite inputs are not landscape)
- `isMobileUserAgent({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })` called
  - → `true`
- `isMobileUserAgent({ userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7)' })` called
  - → `true`
- `isMobileUserAgent({ userAgent: '', platform: 'MacIntel', maxTouchPoints: 5 })` called (iPadOS)
  - → `true`
- `isMobileUserAgent({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })` called
  - → `false`
- `isMobileUserAgent({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })` called
  - → `false`
- `isMobileUserAgent()` and `isMobileUserAgent({})` called
  - → `false` (no throw on empty input)
- `shouldWarnLandscape({ isMobile: true, landscape: true })` called
  - → `true`
- `shouldWarnLandscape({ isMobile: true, landscape: false })` called
  - → `false`
- `shouldWarnLandscape({ isMobile: false, landscape: true })` called
  - → `false`
- `shouldWarnLandscape()` called
  - → `false`

### Task 2 - Component, style, string, and mount

- `LandscapeWarning.web.jsx` read as source
  - → imports and calls `shouldWarnLandscape`, `isLandscape`, `isMobileUserAgent`
  - → reads `window.innerWidth` and `window.innerHeight`
  - → adds and removes both `resize` and `orientationchange` window listeners
  - → renders, gated on `shouldWarnLandscape(...) && !dismissed`, an element with `id="landscape-warning"` and `role="alert"`
  - → calls `Strings.get('rotate_device_portrait', ...)` for the message
  - → renders a dismiss button `id="landscape-warning-dismiss"` that calls `setDismissed(true)`
  - → resets `dismissed` to `false` when the viewport is no longer landscape
- `LandscapeWarning.native.jsx` read as source
  - → exports a component that returns `null`
- `LessonContainer.jsx` read as source
  - → imports `LandscapeWarning`
  - → renders `<LandscapeWarning />`
- `src/assets/css/app.css` read as source
  - → contains a `.landscape-warning` rule with `position: fixed` and a `z-index` greater than `1050`
  - → contains `.landscape-warning-text` and `.landscape-warning-dismiss` rules
- `src/data/strings.js` string coverage
  - → `get('rotate_device_portrait', 'en')` contains both "landscape" and "portrait" and warns the video is affected
  - → `get('rotate_device_portrait', 'hi')` matches Devanagari
  - → `get('rotate_device_portrait', 'bn')` matches Bengali
  - → `get('dismiss', 'hi')` matches Devanagari
  - → `get('dismiss', 'bn')` matches Bengali
  - → the existing `strings.test.js` suite passes with both new keys

### Task 3 - Browser behavior (Playwright)

Use explicit mobile context options rather than spreading the whole device
descriptor (avoids `defaultBrowserType` leaking into `test.use`): an iPhone UA
(`devices['iPhone 13'].userAgent`), `isMobile: true`, `hasTouch: true`, and a
landscape/portrait `viewport`. Test URL `/course/model/lesson/g`.

- iPhone UA + landscape viewport (`844x390`) + `/course/model/lesson/g` loaded
  - → `#landscape-warning` is visible and its text matches the localized `rotate_device_portrait` value
- iPhone UA + landscape, then `#landscape-warning-dismiss` clicked
  - → `#landscape-warning` is hidden
- iPhone UA + landscape, dismissed, then viewport resized to portrait (`390x844`) and back to landscape (`844x390`)
  - → `#landscape-warning` is visible again
- iPhone UA + portrait viewport (`390x844`) + `/course/model/lesson/g` loaded
  - → `#landscape-warning` is not attached/visible
- desktop UA (default) + landscape viewport (`1280x720`) + `/course/model/lesson/g` loaded
  - → `#landscape-warning` is not attached/visible

## Notes

- **Assumption (when it shows).** The warning is shown for the whole lesson on
  mobile while landscape, not only during the recording sub-phase. This matches
  "at the time of the lesson" and avoids coupling to store phase state; it can
  be narrowed to `mediaState === 'webcamOrAvatar'` later if it proves noisy.
- **Dismissible.** The learner can dismiss the banner and keep going in
  landscape; the copy must make the consequence unambiguous ("will mess up your
  video"). Dismissal lasts for that landscape session and resets when the device
  returns to portrait, so re-entering landscape warns again.
- **Not a fix by itself.** This warns; it does not make a landscape recording
  portrait. If a laptop/desktop learner records in landscape, the recap stays
  landscape — that is accepted here and is why the warning is mobile-only.
- No new dependencies. Uses existing React + Zustand patterns; `window` event
  listeners only (no direct DOM manipulation, `agents.md` §1).
- Preserve existing comments and `console.log`/`console.warn` statements
  (`agents.md` §2). Add a `console.log` when the warning is shown/hidden so the
  path is observable in the field.
- Test URL: `http://localhost:5173/course/model/lesson/g` (Playwright `baseURL`,
  `playwright.config.js`). The Playwright spec is the browser-real coverage;
  `devices` comes from `@playwright/test`.
- Updates `docs/product.md` Features with a Landscape-recording-warning bullet.
