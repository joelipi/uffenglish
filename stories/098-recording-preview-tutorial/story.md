# Recording-preview tutorial (its own guide for the friend-response camera screen)

## Context

A `friendClosedResponse` step has two screens that look nothing like each other:

1. the **decision screen** (Replay / Answer / Tutorial) after the friend's clip ends, and
2. the **recording-preview screen** opened by that screen's Continue — a full-screen camera takeover with the look-control rail (Filter, Lens, Screen, Top, Face, Bottom, Emoji) and the phrase to repeat, where the learner positions their overlays and then taps the microphone.

Today the tutorial button exists only on the decision screen. Its video (`tutorial-friendClosedResponse`) explains the repeat-exactly rule, not the camera screen, so a learner who reaches the rail has no guide for the filters, overlays, dragging, sizing, or the two-tap microphone flow. The preview screen is the same step type, but it is a different screen and it needs its own tutorial.

This adds a dedicated tutorial topic for the preview screen, its own script/subtitles, its own guide button on that screen, and its own placeholder video on R2. The decision screen keeps its existing tutorial unchanged.

## Out of Scope

- Changing the five existing step-type tutorials, their scripts, or their videos.
- Localizing the look-rail labels themselves (they remain English in this story; the guide names the labels as they appear on screen).
- Playwright coverage. The preview screen needs a live camera stream and the take path, and story 092 deliberately covers that screen on real devices; this story's coverage is unit + static-guard tests.
- A narrated (voiceover) video. The placeholder generator burns the script on screen, exactly as the five existing tutorials do.
- Any change to the recording flow, the look controls, the mic flow, the config, or the trim/publish pipeline.

## Implementation approach

- **The tutorial key is a topic, not a step type.** `src/modules/video/tutorial-logic.js` currently exports `TUTORIAL_STEP_TYPES` and a `stepType` prop because every guide mapped 1:1 to a step type. The preview screen breaks that assumption, so the vocabulary becomes `TUTORIAL_TOPICS` / `isTutorialTopic` / `topic`:
  - `TUTORIAL_TOPICS` = the five step types (`viewAndContinue`, `closedResponse`, `openResponse`, `friendClosedResponse`, `branching`) plus `FRIEND_RECORDING_PREVIEW_TOPIC` (`'friendRecordingPreview'`).
  - `getTutorialSlug(topic)` stays `` `tutorial-${topic}` ``, so the new video is `tutorial-friendRecordingPreview`.
  - `TUTORIAL_SCRIPTS` gains a `friendRecordingPreview` entry with en/es/pt/fr. A `hi`/`bn` session falls back to English via the existing `getTutorialSubtitleText` rule.
  - The script names the controls exactly as the rail shows them (English label words) in every language, so the guide matches the screen.
- **The guide becomes a component, not a copy of the decision row.** New render-only component `src/components/widgets/PreviewTutorialButton.jsx` owns only the modal's open/closed UI state. It imports `createTutorialOpener` and the topic constant from the pure module, renders `#previewTutorialBtn` (book icon, `aria-label` from the existing `watch_tutorial` string) and mounts `TutorialModal` with `topic={FRIEND_RECORDING_PREVIEW_TOPIC}` when open. Opening pauses the lesson underneath through `TutorialModal`'s existing single pause site.
- **Placement is on the preview screen only, and only before the take.** `WebcamPreview.jsx` already computes `lookControlsVisible = awaitingRecordingStart && isPreviewGateStep(currentStep)`. It renders `{lookControlsVisible && <PreviewTutorialButton />}`, so the guide is present exactly while the look rail and the preview are present and disappears the moment recording starts. The button is pinned bottom-left above the bottom overlay (`position: absolute` in `#pip-wrapper`, `z-index` above `.bottom-overlay`'s 1050, `bottom` matching the controls-section safe-area padding), clear of the left rail, the centered microphone and the phrase overlay.
- **The placeholder video is generated and uploaded like the others.** `scripts/generate-tutorial-placeholders.mjs` iterates the topic list, so adding the topic yields `tutorial-friendRecordingPreview.mp4` (720×1280, 10–30 s, no audio). It is uploaded to the R2 bucket with the generator's printed `wrangler r2 object put` command.
- **Naming compatibility:** every call site and guard that says `stepType` changes to `topic` in the same commit; there is no alias, so no dead name can drift.

## Tasks

### Task 1 - Tutorial module owns the preview topic and script

- `TUTORIAL_TOPICS` + called in unit test
  - → contains `friendRecordingPreview` and the five step-type keys, and nothing else
  - → `FRIEND_RECORDING_PREVIEW_TOPIC` equals `'friendRecordingPreview'`
- `getTutorialSlug('friendRecordingPreview')` + called in unit test
  - → returns `tutorial-friendRecordingPreview`
- `getTutorialVideoUrl('friendRecordingPreview')` + called in unit test
  - → ends with `assets/videos/tutorial-friendRecordingPreview.mp4`
- `getTutorialScript('friendRecordingPreview')` + called in unit test
  - → is 25–75 words and ends with the dismiss reminder `and get to work.`
- `TUTORIAL_SCRIPTS.friendRecordingPreview` + called in unit test
  - → has en, es, pt and fr, and the three translations differ from each other and from English
- `getTutorialSubtitleText('friendRecordingPreview', 'es'|'pt'|'fr')` + called in unit test
  - → returns the matching translation
- `getTutorialSubtitleText('friendRecordingPreview', 'hi'|'bn'|'xx')` + called in unit test
  - → falls back to the English script
- `buildTutorialModalView({ topic: 'friendRecordingPreview', lang: 'pt' })` + called in unit test
  - → isSupported true, `topic` is `friendRecordingPreview`, videoUrl ends with its slug, subtitleText is the pt script
- `isTutorialTopic('friendRecordingPreview')` + called in unit test
  - → true, while `lessonIntro`/`success` stay false

### Task 2 - The preview screen shows its own guide button and modal

- `PreviewTutorialButton` rendered + called in component test
  - → renders `#previewTutorialBtn` with the book icon and no tutorial overlay
- `#previewTutorialBtn` clicked + called in component test
  - → the tutorial overlay appears and `#tutorialVideo` src ends with `assets/videos/tutorial-friendRecordingPreview.mp4`
- the open tutorial's close X clicked + called in component test
  - → the overlay is removed
- `WebcamPreview.jsx` source + called in static guard test
  - → imports and renders `PreviewTutorialButton`
  - → the render is guarded by `lookControlsVisible`, so it is absent once `awaitingRecordingStart` is false (recording has begun)
  - → the guard reads `lookControlsVisible` that itself includes `awaitingStart` and `isPreviewGateStep(currentStep)`
- `PreviewTutorialButton.jsx` source + called in static guard test
  - → imports `createTutorialOpener` and `FRIEND_RECORDING_PREVIEW_TOPIC` from `tutorial-logic.js`
  - → passes `topic={FRIEND_RECORDING_PREVIEW_TOPIC}` to `TutorialModal` and never builds a slug, URL or store read itself

### Task 3 - The decision rows keep their step-type tutorials after the topic rename

- `ResponseDecisionButtons` / `ViewAndContinueButtons` / `BranchChoiceButtons` source + called in static guard test
  - → each passes `topic=` (`{currentVideo?.responseType}` for the response row, the literal step type otherwise)
  - → each still opens the video of the step it represents
- `ResponseDecisionButtons` rendered with `friendClosedResponse` + called in component test
  - → its tutorial still opens `tutorial-friendClosedResponse.mp4` (not the preview video)

### Task 4 - The preview guide has a video on R2 and the generator knows about it

- `TUTORIAL_TOPICS` iterated by `scripts/generate-tutorial-placeholders.mjs` + called in unit test
  - → help text and the run print one upload command per topic, including `tutorial-friendRecordingPreview.mp4`
  - → the new script sizes within the generator's 10–30 s window
- `tutorial-friendRecordingPreview.mp4` uploaded to `uff/assets/videos/` + verified by R2 HEAD/GET
  - → returns 200 `video/mp4`

## Notes

- The placeholder clip is generated with real Chrome (`channel: 'chrome'`, already installed here) and uploaded with `npx wrangler r2 object put uff/assets/videos/tutorial-friendRecordingPreview.mp4 --file <out> --content-type video/mp4`; the private `uff` bucket is the same one the existing tutorials live in.
- The preview tutorial button is icon-only (a book, like the decision row's) because the rail already fills the left edge and the phrase and microphone own the bottom centre. It is pinned bottom-left with the controls-section safe-area offset, so it cannot cover the rail, the phrase, or the mic.
- The guide is deliberately hidden during the take: controls are disabled once recording begins (stories/092), and a mid-take modal would interrupt the learner.
- `hi`/`bn` fall back to the English guide, matching the documented tutorial-script localization limit.
- The guide names the rail's English labels (Filter, Lens, Screen, Top, Face, Bottom, Emoji, Size) in every language, because those are the labels actually on screen.
