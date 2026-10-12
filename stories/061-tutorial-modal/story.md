# Per-step-type tutorial modal with portrait videos

## Context

Three decision rows each mount a tutorial button that opens a placeholder `TutorialModal` (`src/components/widgets/TutorialModal.jsx:3`): `ViewAndContinueButtons.jsx:50` (`#tutorialBtn`), `ResponseDecisionButtons.jsx:74` (`#responseTutorialBtn`), `BranchChoiceButtons.jsx:56` (`#branchTutorialBtn`). The modal today renders only "Tutorial video coming soon" (`TutorialModal.jsx:31-34`), takes no `stepType` prop, and has no video, no scrollable takeover, no corner X, and no localized Continue. The existing Playwright contract (`tests/simple-response-overlay.spec.js:172-183`) locks backdrop-click dismiss of `.tutorial-modal-overlay`. This story wires the button as requested: a full-screen scrollable modal with a corner X styled like the app's existing close X, a localized Continue under a portrait tutorial video unique to the step type, plus the spoken scripts and a placeholder-mp4 generator that uses only dependencies already in the repo.

## Out of Scope

- Recording, uploading, or editing the final narrated tutorial videos. This story ships text-on-screen placeholders to R2; the polished voiceover render is a later story.
- `lessonIntro` and `success` step types. They have no tutorial button and get no tutorial video.
- Tutorial posters. Posters are R2-only siblings of lesson media (`src/modules/video/video-url.js:30-34`); the tutorial modal uses `preload="metadata"` with no poster, so no `.jpg` is generated or uploaded.
- Autoplay of the tutorial video. Per the request it is tap-to-play with controls.
- Any change to the lesson video pipeline, config generator, sheet columns, captions, recap, or publish flows.

## Implementation approach

New pure module `src/modules/video/tutorial-logic.js` owns every decision: the supported set (`viewAndContinue`, `closedResponse`, `openResponse`, `friendClosedResponse`, `branching`), the slug rule `` `tutorial-${stepType}` `` (bare slugs avoided per the `tutorial` prefix decision; no lesson slug collides because lesson slugs are content names such as `do_you_have_rolls_too` while tutorial slugs carry the prefix), URL resolution delegated to the existing `getVideoUrl(slug)` (`src/modules/video/video-url.js:12-28`, dev `/assets/videos/<slug>.mp4` via the Vite proxy at `vite.config.js:73-77`, prod `https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4`), the five spoken scripts (verbatim in Task 4), portrait constants `720x1280` (9:16, matching the app frame `aspect-ratio: 9/16` and the recap `1080x1920` composite at half scale for fast R2 load), and the `Escape`/backdrop/pause policy helpers that return values rather than touching the DOM. The store side-effect (pausing the lesson underneath) lives in the existing effect home `src/modules/lesson/lesson-progression.js` as `pauseLessonVideoForTutorial()` following the same `createProgression` + module-level passthrough pattern as `replaySimpleVideo()` (`lesson-progression.js:115-116` defined inside, `234` re-exported; `ResponseDecisionButtons.jsx:6` already imports from there): inside it calls `getCurrentVideoPlayer()?.pause()` (already imported at `lesson-progression.js:8` from `../store/store.js`) plus `triggerPauseAllVideos()` (store action at `store.js:399`, which `PlaybackVideo.jsx:110-118` already subscribes to). `TutorialModal.jsx` becomes render-only: it receives `{ stepType, onClose }`, resolves everything through `tutorial-logic.js` plus the existing `useNativeLanguage()` hook (`src/hooks/use-native-language.js`) and `getBilingual('continue', lang)` (`src/data/strings.js:2083-2090`), and renders markup/CSS with no inline gates, mapping, URL building, or text selection. Each caller passes a context-determined type with no fallback guessing: `ViewAndContinueButtons` passes the literal `'viewAndContinue'` (it only renders in the view-and-continue decision phase), `BranchChoiceButtons` passes the literal `'branching'` (it only renders for `bottomState === 'branchChoices'` at `LessonContainer.jsx:269-278`), and `ResponseDecisionButtons` passes `currentVideo?.responseType` (already subscribed at `ResponseDecisionButtons.jsx:15`; `currentVideo` carries `responseType` per the `setCurrentVideo` contract in `store.js:369-371`). The placeholder generator `scripts/generate-tutorial-placeholders.mjs` uses only existing dev/dependencies (`@playwright/test` to drive real Chrome with H.264 per the repo rule, native `MediaRecorder` + `canvas.captureStream` for encoding, `wrangler` for upload) and writes outside the repo (gitignored `public/assets/videos/*.mp4` at `.gitignore:25-26` forbids committing mp4s), because Node has no `VideoEncoder` (`typeof VideoEncoder === 'undefined'`) and `ffmpeg` is not installed here, while Chromium MediaRecorder produces real H.264 mp4s in the browser where the encoder exists.

## Tasks

### Task 1 - Pure tutorial-logic module with slug, URL, script, and policy rules

- Supported step type + `getTutorialSlug` called
  - → returns `tutorial-viewAndContinue`, `tutorial-closedResponse`, `tutorial-openResponse`, `tutorial-friendClosedResponse`, `tutorial-branching` respectively
  - → returns `null` for `lessonIntro`, `success`, unknown, empty, or non-string input
- Any value + `isTutorialStepType` called
  - → returns `true` only for the 5 supported types, `false` otherwise
- Supported step type + `getTutorialVideoUrl` called
  - → returns `getVideoUrl(getTutorialSlug(stepType))` (dev `/assets/videos/tutorial-<type>.mp4`, prod `https://r2.ultrafastfluency.com/assets/videos/tutorial-<type>.mp4`)
- Supported step type + `getTutorialScript` called
  - → returns the exact Task 4 script for that type, word-for-word
  - → every script is 25-75 words (10-30 s at ~150 wpm) and ends with the dismiss reminder sentence
- Modal policy helpers called
  - → `getTutorialModalIds()` returns `{ overlay: 'tutorial-modal-overlay', video: 'tutorialVideo', close: 'tutorialCloseBtn', continue: 'tutorialContinueBtn' }`
  - → `shouldCloseOnBackdropClick()` returns `true` and `shouldCloseOnEscape()` returns `true`
  - → `TUTORIAL_VIDEO_WIDTH` is `720` and `TUTORIAL_VIDEO_HEIGHT` is `1280`
- `src/modules/video/tutorial-logic.js` source inspected
  - → imports `getVideoUrl` from `./video-url.js` and imports nothing from `react`, `react-native`, `window`, or `document`
  - → contains no JSX

### Task 2 - Render-only TutorialModal takeover with X, portrait video, localized Continue

- Tutorial button pressed on any of the three decision rows
  - → `.tutorial-modal-overlay` becomes visible, covers the viewport (`position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.8)`), and the overlay scrolls (`overflow-y: auto`) with a scrollable content card (`max-height: 90vh; overflow-y: auto`)
  - → underlying lesson video is paused via `pauseLessonVideoForTutorial()` on modal mount
  - → `#tutorialVideo` `src` equals `getTutorialVideoUrl(stepType)` for the calling step type
  - → `#tutorialVideo` has `controls`, `playsInline`, `preload="metadata"`, has no `autoplay` attribute, and does not play before the user presses play
  - → `#tutorialVideo` renders portrait (`aspect-ratio: 9/16`, `width: 100%`)
  - → `#tutorialCloseBtn` is positioned in the upper-right corner, contains `<i class="bi bi-x-lg">`, and is styled like `#closePage` (`src/assets/css/app.css:438-442`: white, `1.5rem`)
  - → `#tutorialContinueBtn` sits under the video, has `type="button"`, and shows the `continue` string bilingual for the session language (English line plus localized span when the language is not English, same pattern as `ChoiceColumn.jsx`)
- `#tutorialCloseBtn` clicked, `#tutorialContinueBtn` clicked, backdrop clicked (overlay edge, content stops propagation), or `Escape` pressed
  - → `onClose` fires and `.tutorial-modal-overlay` is removed
- `src/components/widgets/TutorialModal.jsx` source inspected (raw source, no comment stripping)
  - → contains `from '../../modules/video/tutorial-logic.js'` (or the correct relative path to it) and calls `getTutorialSlug(` or `buildTutorialModalView(`
  - → contains no `tutorial-` string literal (slug construction lives in the logic module)
  - → contains no `appStore.getState()` (store reads live in the buttons/container)
  - → signature destructures `{ stepType, onClose }`

### Task 3 - Wire stepType through all three tutorial buttons and pause the lesson

- `viewAndContinue` decision phase + `#tutorialBtn` pressed
  - → modal opens with `#tutorialVideo` src ending `assets/videos/tutorial-viewAndContinue.mp4`
- `branchChoices` phase + `#branchTutorialBtn` pressed
  - → modal opens with `#tutorialVideo` src ending `assets/videos/tutorial-branching.mp4`
- Simple-response decision phase for a `closedResponse` / `openResponse` / `friendClosedResponse` step + `#responseTutorialBtn` pressed
  - → modal opens with `#tutorialVideo` src ending `assets/videos/tutorial-<that-responseType>.mp4`
- Any tutorial button pressed while the lesson clip is playing
  - → lesson audio/video stops (the `getCurrentVideoPlayer().pause()` + `triggerPauseAllVideos()` effect ran)
- Tutorial button pressed when the resolved type is not in the supported set (e.g. stale `currentVideo` after a step change)
  - → modal does not open (`handleTutorial` checks `isTutorialStepType(resolved)` first and no-ops with a `console.warn` when unsupported, so `getTutorialSlug` returning `null` never reaches the video element)
- Wiring sources inspected (raw source)
  - → `ViewAndContinueButtons.jsx` contains the literal `'viewAndContinue'` in the `TutorialModal` invocation and contains `pauseLessonVideoForTutorial(`
  - → `BranchChoiceButtons.jsx` contains the literal `'branching'` in the `TutorialModal` invocation and contains `pauseLessonVideoForTutorial(`
  - → `ResponseDecisionButtons.jsx` passes `currentVideo?.responseType` to `TutorialModal` and contains `pauseLessonVideoForTutorial(`
  - → `lesson-progression.js` defines and exports `pauseLessonVideoForTutorial` calling both `getCurrentVideoPlayer` and `triggerPauseAllVideos`

### Task 4 - Five spoken scripts and the placeholder-mp4 generator script

- Each `TUTORIAL_SCRIPTS` entry rendered as on-screen text in its placeholder mp4
  - → viewer can read the full script below while the video plays; no audio track is required
- `tutorial-viewAndContinue` script (spoken verbatim):
  - → "You are watching a short scene that sets up what happens next. You do not need to speak on this step, so just watch and listen. When the video ends, press Continue to move on, Replay to watch again, or the book icon any time to rewatch this guide. Now press the X or Continue to close this window, and get to work."
- `tutorial-closedResponse` script (spoken verbatim):
  - → "Now it is your turn to speak. You will hear one line. Press the microphone and repeat that line exactly, word for word. The app checks every word you say. If a word is wrong, you will see a hint card, so tap the microphone and try again until it matches. Now press the X or Continue to close this window, and get to work."
- `tutorial-openResponse` script (spoken verbatim):
  - → "Now it is your turn to speak in your own words. You will hear a question or a line. Press the microphone and answer naturally. There is no single correct sentence, so any clear answer moves you forward. Speak for a few seconds, then stop. Now press the X or Continue to close this window, and get to work."
- `tutorial-friendClosedResponse` script (spoken verbatim):
  - → "Your friend recorded a question just for you, so you will watch their video first. Then press the microphone and repeat their line exactly, word for word. Get it right and you jump straight to the next question. Miss a word and you will see a hint, so just try again. Now press the X or Continue to close this window, and get to work."
- `tutorial-branching` script (spoken verbatim):
  - → "This step gives you a choice. Watch the video, then tap one of the text buttons to decide what happens next, because each button jumps to a different step. Replay plays the scene again, and the book icon replays this guide. Now press the X or Continue to close this window, and get to work."
- `scripts/generate-tutorial-placeholders.mjs` executed per its `--help` output
  - → writes exactly 5 mp4s (`tutorial-viewAndContinue.mp4`, `tutorial-closedResponse.mp4`, `tutorial-openResponse.mp4`, `tutorial-friendClosedResponse.mp4`, `tutorial-branching.mp4`) to a directory outside the repo (default OS temp dir)
  - → each mp4 probes as ISO-BMFF (`ftyp` at offset 4), decodes to `720x1280`, and has container duration 10-30 s
  - → each mp4 shows its script as white wrapped text on `#1a3a5a` for the full duration with no audio track
  - → script imports nothing not already in `package.json` (`@playwright/test`, `mediabunny` optional for probing only) and guards `main()` behind the `import.meta.url === pathToFileURL(process.argv[1]).href` check per the repo script convention
  - → `--help` prints the five `wrangler r2 object put uff/assets/videos/<slug>.mp4 --file <staged> --content-type video/mp4` upload commands
- Generator source inspected (raw source)
  - → contains `720`, `1280`, `tutorial-`, `captureStream`, `MediaRecorder`, and `channel: 'chrome'`
  - → contains no `import` of a package absent from `package.json` dependencies/devDependencies

### Task 5 - Automated coverage for modal, wiring, and generator

- `npx vitest run src/modules/video/tutorial-logic.test.js src/components/widgets/TutorialModal.test.jsx` executed
  - → all tests pass, covering every Task 1 mapping/naming/word-count AC and every Task 2 render/dismiss/localization AC (including Spanish `CONTINUAR` Continue rendering and no-autoplay assertion)
- `npx vitest run` executed for the touched button suites
  - → `BranchChoiceButtons.test.jsx` passes with a case asserting the modal video src ends with `tutorial-branching.mp4`; equivalent cases cover `tutorial-viewAndContinue.mp4` and `tutorial-<responseType>.mp4`
- New or extended Playwright spec (`tests/tutorial-modal.spec.js`, or the existing `tests/simple-response-overlay.spec.js` tutorial block) executed on real Chrome (`npx playwright install chrome` prerequisite documented in the spec header)
  - → tutorial button opens the overlay, `#tutorialVideo` src ends with the step-type slug, X and Continue both dismiss, backdrop click dismisses, `Escape` dismisses
  - → no cited spec is in `playwright.config.js` `testIgnore` (the four ignored specs are never cited as passing ACs)
- Static guards added beside the feature (e.g. `src/modules/video/tutorial-wiring.test.js`)
  - → assert every Task 2/Task 3 "source inspected" AC on raw source (never comment-stripped), with per-form negative assertions anchored so each can fail independently (e.g. X-button assertion matches its own `#tutorialCloseBtn` block, not any `bi-x-lg` in the file)
  - → guard is proven to fail by temporarily injecting the forbidden token (e.g. a `tutorial-` literal in `TutorialModal.jsx`) before merging

## Technical Context

- React `19.2.0`, `react-dom` `19.2.0`, `zustand` `5.0.13` (store + `useStore`/`useNativeLanguage` pattern), `react-router-dom` `7.15.1` (existing `#closePage` link in `LessonContainer.jsx:174`).
- `mediabunny` `^1.50.8` (available for mp4 probing only; browser `VideoEncoder` is absent in Node so encoding runs in real Chrome via native `MediaRecorder`, no new encoder dependency).
- `@playwright/test` `^1.60.0` (placeholder harness driver; run with real Chrome per the H.264 rule — bundled Chromium cannot validate tutorial playback).
- `wrangler` `^3.114.17` (manual `r2 object put` upload of the five staged mp4s to the public `uff` bucket under `assets/videos/`; dev serves them through the existing `/assets/videos/` proxy).
- No new npm dependencies. `ffmpeg` is not installed and not required. `sharp` is present only transitively (not in `package.json`) and must not be imported.
- Tutorial slugs: `tutorial-viewAndContinue`, `tutorial-closedResponse`, `tutorial-openResponse`, `tutorial-friendClosedResponse`, `tutorial-branching` (R2 keys `assets/videos/<slug>.mp4`, resolved through the unchanged `getVideoUrl`/`getPosterUrl` rule; no poster `.jpg` is produced for tutorials).
- Existing strings reused: `continue` (`CONTINUE`/`CONTINUAR`/`CONTINUAR`/`CONTINUER`/plus hi/bn at `src/data/strings.js:2083-2090`) and `watch_tutorial` for the buttons (unchanged). No new UI-copy keys are required unless the implementer needs an accessible close label, in which case the existing bilingual pattern applies.

## Notes

- Manual R2 upload (operator step, not automated): after generating, run for each slug `npx wrangler r2 object put uff/assets/videos/<slug>.mp4 --file <staged-dir>/<slug>.mp4 --content-type video/mp4`, then verify with a ranged GET (`curl -H "Range: bytes=0-1023"` must return `206` with `Access-Control-Allow-Origin: *` per `docs/cloudflare-video-cors.md`) and a real-Chrome playback check. New slugs are cache-cold so the 4-hour CDN cache is not a concern.
- No posters are committed or uploaded for tutorials; the modal video element uses `preload="metadata"` and shows its first frame once data loads.
- UX: overlay `overflow-y: auto` with content `max-height: 90vh; overflow-y: auto` so the modal takes over the screen yet scrolls on small phones where backdrop taps are impractical; X and Continue are both always reachable (X pinned upper-right of the card, Continue pinned under the video); `Escape` handling follows the `HomeScreen.jsx:50-55` `window.addEventListener('keydown')` pattern with cleanup.
- Accessibility: `#tutorialCloseBtn` carries `aria-label="Close"`, `#tutorialVideo` carries `aria-label` naming the step type, Continue is a real `type="button"`.
- Console discipline per repo rules: modal mount/unmount and generator progress log success paths; R2 upload failures print the exact failing slug and command without failing the generation of the other four.
