# Add static intro-video step to the WF lesson

## Context

`wf` ("Would You Rather? — Ask") in `src/config/model.json` is the only lesson that jumps straight from `lessonIntro` to its first response step. Every lesson that uses the "watch a plain video, then respond" pattern — `t`, `x`, `wa`, and `wfa` — inserts a non-interactive `viewAndContinue` step with a `simpleVideoUrl` between the intro and the first response. In `wf`, the first `friendClosedResponse` is therefore also the first time the user sees/hears anything after the intro, and the intro's instructions are never shown again. Add the missing `viewAndContinue` step, replaying `testvideo01` (the same clip the `wf` intro uses) with localized subtitles.

## Out of Scope

- No changes to any other lesson (`w`, `wa`, `wfa`, `t`, `x`, `g`, `h`, `a`, `test`).
- No changes to `wf`'s `lessonIntro`, its three `friendClosedResponse` steps, or its `success` step beyond index shift.
- No changes to player components, store/phase logic, `scripts/generate-mock-videos.mjs`, or video assets. `testvideo01` is reused as-is — no new media and no R2 upload.
- No `cue` or `headsUp` is added; this is a presentation-only step.

## Implementation approach

Single-file config change in `src/config/model.json`: in lesson `wf`, insert one object at `steps[1]` — between the `lessonIntro` (index 0) and the first `friendClosedResponse` (currently index 1).

```json
{
  "responseType": "viewAndContinue",
  "simpleVideoUrl": "testvideo01",
  "subtitles": {
    "en": "Now you will record yourself asking your friends 3 questions using the phrase Would you rather... You will repeat each question exactly. Press the button below to continue.",
    "es": "Ahora te grabarás preguntando a tus amigos 3 preguntas usando la frase Would you rather... Repetirás cada pregunta exactamente. Oprime el botón de abajo para continuar.",
    "pt": "Agora você vai se gravar perguntando aos seus amigos 3 perguntas usando a frase Would you rather... Você repetirá cada pergunta exatamente. Pressione o botão abaixo para continuar."
  }
}
```

Rules and decisions:

- `viewAndContinue` + `simpleVideoUrl` is the only step type used in `model.json` for a purely presentational simple video (no response). `resetUIForNewStep` (`src/modules/lesson/step-executor-webonly.js`) maps it to phase `viewAndContinueVideo`; `SimpleVideoPlayer` fires `transitionTo('simpleVideo-decisionTime-viewAndContinue')` on `ended`, which mounts `ViewAndContinueButtons`.
- `simpleVideoUrl` must be `"testvideo01"` — the same slug the `wf` intro references via `introBackgroundVideoUrl`, so this step replays the already-authored instruction clip.
- `subtitles` must be an `{en,es,pt}` object. `video-loader.web.js` calls `getLocalizedTranslation(step.subtitles, lang)`, which selects the user's native language and falls back to `en`.
- The `en` value must be verbatim the `testvideo01` spoken script in `scripts/generate-mock-videos.mjs` (line 47). `es` and `pt` are new copy authored in this story (see Notes).
- No `cue`/`headsUp`: for `viewAndContinue`, `_renderViewAndContinue` only reads `explanation` and `simpleVideoUrl`, and the visible text comes solely from `subtitles`.

## Tasks

### Task 1 — Insert the WF post-intro `viewAndContinue` step

- `src/config/model.json` is parsed and the `wf` lesson is read
  - → `wf.steps[0].responseType === "lessonIntro"`
  - → `wf.steps[1].responseType === "viewAndContinue"`
  - → `wf.steps[1].simpleVideoUrl === "testvideo01"`
  - → `wf.steps[1].subtitles` is an object whose `en`, `es`, and `pt` values are all non-empty strings
  - → `wf.steps[1].subtitles.en === "Now you will record yourself asking your friends 3 questions using the phrase Would you rather... You will repeat each question exactly. Press the button below to continue."`
  - → the first `wf` step whose `responseType` is `closedResponse`, `openResponse`, or `friendClosedResponse` is at index 2, has `responseType === "friendClosedResponse"`, and `simpleVideoUrl === "testvideo02"`
  - → `wf.steps.length === 6`
- the whole `model.json` is read and compared to the pre-change step lists
  - → every lesson other than `wf` has an unchanged sequence of `{responseType, simpleVideoUrl, interactiveVideoUrl, introBackgroundVideoUrl}` values
  - → `wf`'s remaining steps (indices 0, 2, 3, 4, 5) keep their pre-change values

### Task 2 — Automated coverage for the config

- `npm test -- --run` (vitest, jsdom) is executed
  - → `src/config/model.test.js` exists, imports `model.json`, and every assertion listed in Task 1 passes
  - → the suite fails if the new step is deleted, reordered, given a different `simpleVideoUrl`, or if any subtitle locale is missing/empty

## Technical Context

- Stack: React 19, Vite 8, Zustand (`appStore` in `src/modules/store/store.js`). Lesson content is plain JSON; `src/config/model.json` is the `model` course (`courseId: "model"`).
- `viewAndContinue` path: `src/components/StepLoader.jsx` (`PresentStep`), phase mapping in `src/modules/lesson/step-executor-webonly.js` (`resetUIForNewStep`), simple-video rendering in `src/components/SimpleVideoPlayer.web.jsx`, subtitle localization in `src/modules/utils/utils.js` (`getLocalizedTranslation`).
- Unit test command: `npm test -- --run`. Vitest `include` defaults to `**/*.{test,spec}.?(c|m)[jt]s?(x)`, but `vitest.config.js` excludes `**/tests/**` and `**/*.spec.js`, so the unit test belongs at `src/config/model.test.js`. JSON files can be imported directly (Vite/esbuild JSON support).
- No new packages or versions are introduced; there is no Bootstrap section because no app, service, or package is created.

## Notes

- The `es`/`pt` subtitle strings are new copy authored for this story; product review may reword them. Only the `en` value is verbatim from `scripts/generate-mock-videos.mjs:47`.
- `wf` is a friend-challenge test lesson. `testvideo01` is a mock clip produced by `scripts/generate-mock-videos.mjs` into `public/assets/videos/` (gitignored) and R2.
- No E2E spec is added for this change: the `viewAndContinue` → `SimpleVideoPlayer` rendering path is already exercised by the existing lessons `t`, `x`, `wa`, and `wfa`, and this change is config-only. The unit test pins the config; an E2E would re-test unchanged code and add flakiness (no `wf` poster jpg, mock video on R2, guest-modal timing).
- Keep `model.json`'s existing 2-space indentation when inserting the object to keep the diff minimal.
- Inserting the step shifts the subsequent `wf` step indices; nothing keys off a fixed index (`resetUIForNewStep` recomputes the first-response index via `findIndex`), so no code change is required.
