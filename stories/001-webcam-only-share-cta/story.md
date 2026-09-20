# webcamOnly lesson recap with share CTA (lessons w/wf)

## Context

Lessons `w` and `wf` in `src/config/model.json` are the "friend challenge — Ask" half of a two-player loop: the user records themselves asking 3 questions, `exportSegmentsToR2` (`src/modules/video/video-processor.web.js:919`) publishes those clips to R2 under `videos/{shareCode}-{courseId}-{lessonId}-response-NN.mp4` (48h TTL, `README.md:98`), and a friend answers them in lesson `wa`/`wfa` after opening the app with a `?sharecode=` param (`src/App.jsx:21-35`). Today the asker's end-of-lesson recap interleaves the model prompt videos with their own recordings (`VideoRenderPlanner.generatePlan()`, `src/modules/video/video-processor-logic.js:18-72`), which makes it a poor sharing asset. The asker needs a short shareable "ad" recap containing ONLY their own webcam recordings, with an overlay telling friends where to go and by when — a 48-hour deadline that matches the R2 UGC lifecycle.

## Out of Scope

- Making text-mode answers publishable. Text-mode recordings are saved with `blob = null` (`src/modules/answer/answer-pipeline.js:669-681`) and are filtered out of the R2 export (`video-processor.web.js:943-945`), so a text-mode asker's friend gets a 404 lesson. The CTA still renders over their avatar-card recap. Documented, not fixed.
- Extending `hi`/`bn` localization beyond the two new strings keys — the rest of `src/data/strings.js` has no Hindi/Bengali; those users fall back to English elsewhere.
- React Native rendering of the CTA. `video-processor.native.jsx` is a placeholder — there is no RN app in this repo (no `react-native`/`expo` dependency, no importer, Vite does not resolve `.native.jsx`). It does not handle the `variant` field and still renders the fluency card; a header comment documents this. The shared CTA domain logic (`resolveOverlayElements`, `buildShareUrl`, `buildShareDeadline`, `SHARE_WINDOW_HOURS`) lives in `video-processor-logic.js` so a future port only needs the drawing.
- Replacing the `example.com` placeholder domain with the real URL-shortener domain.
- Changing the friend-facing per-segment R2 clips (they keep today's subtitle-only overlay) or lessons `wa`/`wfa` in any way.
- Changing the freeze-frame tailing background (`video-processor.web.js:335-350`, `:464-467`) or the 4s tailing duration.

## Implementation approach

### 1. Config flag (only config change)

Add `"webcamOnly": true` to lessons `w` and `wf` in `src/config/model.json`. No other config changes — all CTA text, URL, and deadline logic lives in app code. `w`/`wf` exist only in `model.json` (verified: `gt2.json`, `t.json`, `test-api.json` have no `w`/`wf` lessons).

### 2. Planner — `src/modules/video/video-processor-logic.js` (stays platform-agnostic)

- Constructor (`:11-16`) gains a 5th param: `constructor(recordings, configData, fluencyData, userLang = 'en', shareCode = null)` → `this.shareCode = shareCode || null`. Backward compatible: the native call site (`video-processor.native.jsx:42`) passes 4 args.
- Add a `_getLesson(rec)` helper mirroring the lookup in `_getRemoteTarget` (`:145-154`): `return this.configData.lessons?.find(l => l.lessonId === rec.originalLessonId) || null;`. Use it in `generatePlan` only; leave `_getRemoteTarget`/`_getStepCue` untouched.
- In `generatePlan()` (`:18-72`), resolve `const lesson = this._getLesson(rec);` per recording and gate the remote push (`:28-38`): `if (needsRemote && !lesson?.webcamOnly) { ... }`. The retry-dedupe (`needsRemote`) logic is unchanged. Result: `webcamOnly` recaps contain only `webcam` steps.
- Tailing step (`:64-69`) becomes:

  ```js
  // All recordings in a plan share one originalLessonId (storage filters by it,
  // storage.web.js:103), so the first recording identifies the lesson. Empty
  // recordings → no lesson resolvable → safe default 'fluency'.
  const lesson = this.recordings.length ? this._getLesson(this.recordings[0]) : null;
  plan.push({
      type: 'tailing',
      durationMs: 4000,                       // unchanged
      fluencyData: this.fluencyData,          // unchanged
      variant: lesson?.webcamOnly ? 'shareCta' : 'fluency',
      shareCode: this.shareCode               // raw value only — never a URL
  });
  ```

- The module must not reference `window` or build URLs (enforced by a source-guard unit test, Task 2).

### 3. Strings — `src/data/strings.js`

Append two keys to the `strings` object (before its closing `};` ~`:1035`). Exact copy (final, decided):

| key | en | es | pt | fr | hi | bn |
|---|---|---|---|---|---|---|
| `share_cta_headline` | Practice English with me free | Practica inglés conmigo gratis | Pratique inglês comigo de graça | Pratique l'anglais avec moi gratuitement | मेरे साथ मुफ़्त अंग्रेज़ी प्रैक्टिस करें | আমার সাথে ফ্রি ইংরেজি প্র্যাকটিস করুন |
| `share_cta_deadline` | Practice English with me free before | Practica inglés conmigo gratis antes del | Pratique inglês comigo de graça antes de | Pratique l'anglais avec moi gratuitement avant le | मेरे साथ मुफ़्त अंग्रेज़ी प्रैक्टिस करें — अंतिम तिथि: | আমার সাথে ফ্রি ইংরেজি প্র্যাকটিস করুন — শেষ তারিখ: |

`share_cta_deadline` is a prefix line; the formatted date follows on the next line (hence "antes del" / "avant le" trailing prepositions in es/fr). Consume via the default export: `Strings.get('share_cta_headline', userLang)` — `get` (`:1046-1073`) normalizes `lang.split('-')[0].toLowerCase()`, so `'HI'` (the stored format) and `'hi-IN'` both resolve `hi`; missing translations fall back to `en`.

### 4. Web processor — `src/modules/video/video-processor.web.js`

**Constants and pure helpers (exported for unit tests):**

```js
// Placeholder domain — will later become the URL-shortener domain.
// Deliberately no scheme: the displayed URL is a bare host/path, single line.
export const SHARE_URL_BASE = 'example.com';
// The share window matches the R2 UGC lifecycle: videos/ objects expire after
// 48h (README.md:98, Cloudflare dashboard R2 → uff → Lifecycle). The friend
// must answer before the clips vanish.
export const SHARE_WINDOW_HOURS = 48;

export function buildShareUrl(shareCode) { ... }        // → `${SHARE_URL_BASE}/${shareCode}`
export function buildShareDeadline(nowMs, nativeLanguage) { ... }
export function resolveOverlayElements({ webcamOnly, hasShareCta, isFirst, tailing }) { ... }
```

- `buildShareDeadline(nowMs, nativeLanguage)` = `new Date(nowMs + SHARE_WINDOW_HOURS * 60 * 60 * 1000).toLocaleString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })` — browser-local timezone, user's locale. Weekday is required (48h is short; people confuse the date otherwise).
- Locale mapping reuses the `LOCALE_MAP` pattern from `src/components/profile/UserProfile.jsx:113` (uppercase 2-letter code → locale) but covers this feature's six languages and adds the missing `BN`: `const CTA_LOCALE_MAP = { EN: 'en', ES: 'es', PT: 'pt', FR: 'fr', HI: 'hi', BN: 'bn' };`. Normalize input as `String(nativeLanguage || 'en').split('-')[0].toUpperCase()` (handles `'es'`, `'ES'`, `'es-ES'`); unknown codes fall back to `'en'` — consistent with the English CTA-text fallback for unsupported languages.
- `resolveOverlayElements` is the pure decision table that `drawTextOverlay` consumes (this is the "extracted pure text-array builder" that makes the rendering rules unit-testable):

  | webcamOnly | hasShareCta | isFirst | tailing | → fluencyCard | headlineBlock | tailingCard |
  |---|---|---|---|---|---|---|
  | false | – | true | false | true (CALCULATING) | false | false |
  | false | – | – | true | true (FLUENCY SCORE) | false | false |
  | true | true | true | false | false | true | false |
  | true | true | – | true | false | true | true |
  | true | false | any | any | false | false | false |

  I.e. fluency overlays render iff `!webcamOnly && (isFirst || tailing)`; the headline block renders iff `webcamOnly && hasShareCta`; the tailing card renders iff `webcamOnly && hasShareCta && tailing`. Missing shareCode on a `webcamOnly` lesson renders NOTHING — no headline, no tailing card, and no fluency fallback.

**Wiring in `process()` (`:110-232`):**

```js
const userLang = appStore.getState().userData?.native_language;          // existing :161
const shareCode = appStore.getState().userData?.shareCode || null;       // same store pattern as :925
const planner = new VideoRenderPlanner(recordings, configData, fluencyData, userLang, shareCode);
const plan = planner.generatePlan();
const tailingStep = plan.find(s => s.type === 'tailing');                // plan always has exactly one
const webcamOnly = tailingStep?.variant === 'shareCta';
const shareCta = (webcamOnly && shareCode)
    ? {
        headline: Strings.get('share_cta_headline', userLang),
        deadlinePrefix: Strings.get('share_cta_deadline', userLang),
        deadline: buildShareDeadline(Date.now(), userLang),              // baked at generation time
        url: buildShareUrl(shareCode),
      }
    : null;
```

Then pass `webcamOnly` and `shareCta` through `executeRenderLoop` (`:217-222` call, `:293` definition) via its existing options bag: `{ silent = false, webcamOnly = false, shareCta = null } = {}`. The `draw()` loop forwards both to `drawTextOverlay` (`:494-498` call, `:610` definition) as two new trailing params with the same defaults. `renderStepToBlob` (`:903-909`) keeps passing only `{ silent: true }` → defaults apply → friend-facing R2 clips render exactly as today (subtitles only, no headline/CTA). `exportSegmentsToR2` passes `shareCode` to the planner constructor (`:938`) for consistency; its publishable-segment filter (`:943-945`) is untouched.

**Rendering in `drawTextOverlay` (`:610-781`):**

- Replace the `if (isFirst || tailing)` condition (`:615`) with the `resolveOverlayElements` result: the existing fluency block (`:615-672`) runs only when `fluencyCard` is true. For `webcamOnly` lessons the "CALCULATING FLUENCY" overlay is gone entirely and the tailing fluency card never renders.
- Headline block (`headlineBlock` true — every frame of the recap, webcam steps AND tailing): two centered lines in the TOP 25% of the canvas (vertically centered in that band), line 1 = `shareCta.headline`, line 2 = `shareCta.url`. It intentionally repeats during the tailing step alongside the tailing card (the URL appearing twice — top and center — is by design; do not dedupe).
- Tailing card (`tailingCard` true — during the 4s freeze-frame): three centered, enlarged lines around the canvas vertical center, over the existing freeze-frame background: line 1 = `shareCta.deadlinePrefix`, line 2 = `shareCta.deadline`, line 3 = `shareCta.url`.
- The URL is rendered on a SINGLE LINE and NEVER passed through `wrapText` (`:592-608`, used at `:694` for subtitles). Draw it with direct `strokeText`/`fillText`, sizing the font down until `measureText(url).width <= canvasWidth * 0.9` (same measure-and-scale approach as the fluency card at `:638-645`, with a minimum-size floor like the existing `Math.max(18, …)`). Apply the same treatment to the deadline line (a wrapped date reads broken); headline/prefix lines may use the existing measure-scale sizing.
- Styling: bold `"Plus Jakarta Sans"` (already pre-loaded by `ensureFontsReady`, `:97-108`) with the fluency card's stroke + shadow legibility treatment (`:657-668`). Subtitle rendering (`:674-778`) is unchanged for all lessons.

### 5. Edge cases

- Missing `shareCode` (guests, logged-out): `shareCta` is null → no headline, no tailing card, and NO fluency fallback — the tailing step is a bare 4s freeze-frame.
- Empty recordings on a `webcamOnly` lesson: no lesson is resolvable → tailing `variant: 'fluency'` → the recap is the legacy fluency-card form. Consistent: with nothing recorded there is nothing published to share.
- Retry recordings (same `originalStepIndex`): existing dedupe unchanged; on `webcamOnly` lessons there are no remote steps to dedupe anyway.
- Non-`webcamOnly` lessons: `webcamOnly=false`, `shareCta=null` defaults reproduce today's behavior exactly (remote interleaving, CALCULATING FLUENCY, FLUENCY SCORE card).

## Tasks

### Task 1 - Add `webcamOnly` flag to model.json

- `src/config/model.json` loaded + lessons `w` and `wf` inspected
  - → `webcamOnly === true` on both lessons
- `src/config/model.json` loaded + every other lesson inspected (incl. `wa`, `wfa`)
  - → `webcamOnly` is `undefined` (flag absent) — no other lesson or config file changes

### Task 2 - Planner: skip remote segments, tag tailing step (`video-processor-logic.test.js`, new)

- `VideoRenderPlanner` built with a `webcamOnly: true` lesson config (steps carrying `interactiveVideoUrl`) + 3 recordings with `originalLessonId` matching + `generatePlan()` called
  - → zero steps with `type: 'remote'`
  - → 3 `webcam` steps in recording order, then exactly 1 `tailing` step
- Same plan + tailing step inspected
  - → `variant === 'shareCta'`, `durationMs === 4000`, `fluencyData` equals the constructor arg, `shareCode` equals the constructor's 5th arg
- Identical config with `webcamOnly` removed + `generatePlan()` called
  - → a `remote` step precedes each first-attempt webcam step (interleaving preserved)
  - → tailing `variant === 'fluency'`
- Two recordings sharing `originalStepIndex` (retry) + non-`webcamOnly` config
  - → exactly one `remote` step for the pair (existing dedupe locked)
- Same retry pair + `webcamOnly` config
  - → still zero `remote` steps
- Empty recordings array + `generatePlan()` called
  - → plan is exactly `[tailing]` with `variant === 'fluency'`
- Constructor called with 4 args (no `shareCode`)
  - → tailing step `shareCode` is `null` (native call site unaffected)
- `src/modules/video/video-processor-logic.js` read as source text
  - → contains no `window` reference and no `example.com` / URL construction (platform-agnostic guard)

### Task 3 - Web: strings, URL/deadline builders, overlay rules, render wiring (`video-processor.web.test.js`, new)

- `Strings.get('share_cta_headline', lang)` called for `en`, `es`, `pt`, `fr`, `hi`, `bn`
  - → returns the exact copy from the table in Implementation approach §3
- `Strings.get('share_cta_deadline', lang)` called for the same six langs
  - → returns the exact copy from the table
- `Strings.get` called with `'HI'` (stored uppercase format) and `'hi-IN'`
  - → both return the `hi` string (normalization); an unsupported lang (`'de'`) returns the `en` string
- `buildShareUrl('ab12')` called
  - → returns `'example.com/ab12'`
  - → output does not start with `http`/`https` (no scheme) and contains no whitespace or newline (single line)
- `buildShareDeadline(nowMs, nativeLanguage)` called for `EN`, `ES`, `PT`, `FR`, `HI`, `BN` with a fixed `nowMs`
  - → equals `new Date(nowMs + SHARE_WINDOW_HOURS * 60 * 60 * 1000).toLocaleString(mappedLocale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })` for each mapped locale (`en`, `es`, `pt`, `fr`, `hi`, `bn`)
  - → `SHARE_WINDOW_HOURS === 48`
  - → differs from `new Date(nowMs).toLocaleString(...)` of the unshifted timestamp (proves the +48h offset)
  - → non-`en` output differs from `en` output for the same `nowMs` (proves localization fires)
- `buildShareDeadline` called with `'es'`, `'ES'`, `'es-ES'`
  - → all three produce identical output (normalization); `''`/`'DE'` produce the `'en'`-locale output (fallback)
- `resolveOverlayElements` called with each row of the §4 truth table
  - → returns the matching `{ fluencyCard, headlineBlock, tailingCard }` combination, including: `webcamOnly && !hasShareCta` → all three false (no fluency fallback), and non-`webcamOnly` rows → `headlineBlock`/`tailingCard` always false

## Technical Context

- No new dependencies. Unit tests use the existing vitest 4.1.6 + jsdom 29.1.1 setup; test files are colocated `*.test.js` (vitest excludes `tests/**` and `*.spec.js`, which are Playwright).
- `video-processor.web.js` is importable under vitest/jsdom (verified empirically: module level has no DOM access; store/supabase/asset imports resolve) — so `video-processor.web.test.js` can import `buildShareUrl`, `buildShareDeadline`, `resolveOverlayElements`, and `Strings` directly.
- Node 20+ (repo requirement, `README.md` Setup) ships full ICU, so `toLocaleString` with the option set above is deterministic. Deadline tests compare against the same `Intl` call computed in the test (timezone-robust) plus inequality checks — never hard-coded date strings, which would be timezone-fragile.
- `native_language` is stored as an UPPERCASE 2-letter code (`'ES'`, `'HI'`) from the signup/guest pickers (`SignupForm.web.jsx:7`, `GuestLoginModal.web.jsx:22`); `Strings.get` lowercases for lookup, `CTA_LOCALE_MAP` uppercases — both directions are covered by tests.
- `shareCode` is a lowercase short id over `abcdefghijkmnpqrstuvwxyz23456789`, min 4 chars (`src/modules/utils/short-id.js`) — the URL is short, so the ≤90%-width single-line constraint is easily satisfiable.
- The 48h deadline aligns with the R2 TTL because `exportSegmentsToR2` fires seconds after generation in the same `runProcessing` flow (`SuccessButtons.jsx:67-84`): the deadline is `Date.now() + 48h` at generation time, and the TTL clock starts at publish time.
- knip only scans `js/**` and is not in CI (`knip.jsonc`, `README.md:92`) — test-only exports are safe.
- Fonts: `ensureFontsReady` (`video-processor.web.js:97-108`) pre-loads Orbitron and Plus Jakarta Sans. Devanagari/Bengali glyphs are not in those fonts; canvas falls back per-glyph to system fonts (fine on target devices, noted in Notes).

## Notes

**Manual verification (canvas pixels cannot be unit-tested — jsdom has no 2D-context `measureText`; the decision logic is covered by `resolveOverlayElements` tests):**

1. `npm run dev`, then `node scripts/generate-mock-videos.mjs` so lesson prompt videos exist locally.
2. Open `http://localhost:3000/course/model/lesson/w`, dismiss the guest modal, complete the 3 question steps (mic, or the text-mode fallback — avatar cards are acceptable for this check).
3. Before clicking Generate, set a share code and language in the console:
   `window.appStore.setState({ userData: { ...(window.appStore.getState().userData || {}), shareCode: 'ab12', native_language: 'ES' } })`
4. Click Generate and verify: NO "CALCULATING FLUENCY" overlay anywhere; no model prompt videos (webcam-only); the 2-line headline block (es headline + `example.com/ab12`) stays in the top 25% for the entire video; the final 4s freeze-frame shows the 3-line centered card (es prefix + localized deadline with weekday + URL); no fluency score card.
5. Repeat without step 3 (guest, no shareCode): no headline, no tailing card, no fluency card — bare freeze-frame tail.
6. Regression: `http://localhost:3000/course/model/lesson/g` — recap unchanged (remote prompts interleaved, CALCULATING FLUENCY on the first segment, FLUENCY SCORE tailing card).
7. Deadline sanity: the displayed deadline is ~48h after generation, in the browser's local timezone, with the weekday included.

**Review checklist (non-automatable structural rules):**

- The URL string is never passed through `wrapText` — direct `strokeText`/`fillText` only, in both the headline block and the tailing card.
- `renderStepToBlob` still passes only `{ silent: true }` to `executeRenderLoop` (friend-facing R2 clips stay CTA-free).
- `video-processor-logic.js` has no `window` reference and builds no URL (also enforced by the Task 2 source-guard test).
- Existing comments and `console.log` statements are preserved per `agents.md`.

**Known limitations (do NOT solve):**

- Text-mode askers (`blob = null`, `answer-pipeline.js:669-681`) cannot publish — `exportSegmentsToR2` filters them out (`video-processor.web.js:943-945`) — so their friend's lesson 404s even though the CTA renders over the avatar cards.
- `hi`/`bn` are partial localizations: only the two new keys exist; the rest of `strings.js` is en/es/fr (plus 12 pt keys), so those users see English elsewhere in the app.
- The headline block overlaps the decorative `header.png` banner (1600×300 at natural size, drawn every frame at `video-processor.web.js:489-492`); the stroke + shadow treatment (same as the fluency card) keeps it legible. On very short canvases the banner can exceed the top 25% — accepted.
- `example.com` is a placeholder; the comment on `SHARE_URL_BASE` must note the future URL-shortener domain swap.
