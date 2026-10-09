# Lesson-a UGC clip burns the wrong subtitle after a config regeneration

## Context

The end-of-lesson recap and the per-segment UGC clips burn a subtitle into each of the learner's own recorded segments (`exportSegmentsToR2` → `renderStepToBlob`/the trimmed stitched recording → `drawTextOverlay`). The subtitle is built by `VideoRenderPlanner.generatePlan` (`src/modules/video/video-processor-logic.js`): a `webcam` segment uses `_getResponseSubtitle(rec, userText)`, which returns `{ en: rec.matchedCue, translation: rec.translation || null }` for a `closedResponse`/`friendClosedResponse` step — the canonical cue plus its localized translation — and nothing when no cue matched.

The planner resolves the step a recording belongs to by a **raw positional index** into the *current* config:

```js
// src/modules/video/video-processor-logic.js:358-361
_getLesson(rec) {
    if (!this.configData.lessons) return null;
    return this.configData.lessons.find(l => l.lessonId === rec.originalLessonId) || null;
}
// src/modules/video/video-processor-logic.js:582
const step = this._getLesson(rec)?.steps?.[rec.originalStepIndex];
```

`rec.originalStepIndex` is the step's array index **at record time** (`src/modules/storage/storage.web.js:47,64`), and recordings are never re-keyed when the config changes. `_getStepCue`, `_getRemoteTarget` and `_getPublishLessonId` use the same index.

The `wouldyourather` config was generated from the sheet on 2026-10-07 (`8223bfe`) and **regenerated on 2026-10-08** (`f3a7e67`). The regeneration inserted a `viewAndContinue` step at index 1 of lesson `a`, moving its recorded `friendClosedResponse` step from index 1 to index 2. Lesson `b`'s recorded response steps kept indices 2 and 3 (the regeneration only appended new steps at 4 and 5). So a lesson-`a` recording made before the regeneration now resolves `steps[1]` to the `viewAndContinue` step, while every lesson-`b` recording still resolves to its real response step.

With the wrong step, `_getResponseSubtitle` takes the non-closed branch (`video-processor-logic.js:587-589`) and burns the **raw speech-to-text transcript** (`rec.userResponse`) instead of the matched cue, and the matched-cue path (`:591-592`) that pairs the canonical cue with its localized `rec.translation` is never taken. The ask question is long and rarely clears the 95% cue-match threshold, so its recording stores no `matchedCue`/`translation`; the mis-resolved step therefore burns English-only (the transcript) where the correct step would burn nothing. Lesson `b`'s answer clips are unaffected — their indices did not move — so they keep burning the matched cue and its localized translation.

The regression is the positional step lookup: a config regeneration silently re-points every stored recording for a lesson whose step list shifted. The fix is to resolve the recorded step by a stable identity that survives regeneration.

## Out of Scope

- No change to `_getResponseSubtitle`/`_getStepCue`'s subtitle rules: a closed response still burns the matched cue + translation, and nothing when no cue matched (story 028); an open response still burns the transcript.
- No change to the cue-matching algorithm, threshold, or `src/modules/answer/answers.js`.
- No change to `answer-pipeline.js`'s writing of `matchedCue`/`translation`, and no change to the guest-first language resolution.
- No backfill or re-render of already-published R2 clips.
- No change to the config generator (`scripts/generate-config-from-sheet.mjs`) or the sheet; the sheet stays authoritative and may legitimately insert steps.
- No change to the renderer, prefetch, playlist, or R2 upload mechanics.
- No new dependency.

## Implementation approach

All changes are in the platform-agnostic planner `src/modules/video/video-processor-logic.js`, so both consumers pick them up unchanged: the concatenated recap (`video-processor.web.js`), the per-segment R2 export, and the native recap all call `generatePlan()`.

Add one private resolver and route every recorded-step lookup through it.

```js
import { getCueText } from '../utils/utils.js';

/**
 * The lesson step a recording belongs to. `rec.originalStepIndex` is the array
 * index at record time; a config regeneration can insert/move steps, so the
 * positional lookup can silently point at a different step (e.g. an inserted
 * `viewAndContinue`). Prefer the step the recording still identifies by its
 * stored English cue text (`rec.cue`, written by updateSpeechRecording) and its
 * response type (written by the recorder), falling back to the index.
 */
_getRecordedStep(rec) {
    const lesson = this._getLesson(rec);
    if (!lesson?.steps) return null;

    const cueText = typeof rec.cue === 'string' && rec.cue.length > 0 ? rec.cue : null;
    if (cueText) {
        const matches = lesson.steps.filter((step) =>
            getCueText(step.cue) === cueText &&
            (!rec.responseType || step.responseType === rec.responseType));
        if (matches.length === 1) return matches[0];
    }

    return lesson.steps[rec.originalStepIndex] || null;
}
```

Then replace the four `steps?.[rec.originalStepIndex]` lookups with `this._getRecordedStep(rec)`:

- `_getPublishLessonId` (`:368-372`) — `step?.publishLessonId`.
- `_getRemoteTarget` (`:532-571`) — the recorded step's target.
- `_getResponseSubtitle` (`:581-596`) — the closed-response classification and cue.
- `_getStepCue` (`:598-624`) — the fallback cue.

### Resolution rule (exhaustive)

For a recording `rec` in lesson `L`:

| Condition | Result |
| --- | --- |
| `rec.cue` is a non-empty string and **exactly one** step in `L` has `getCueText(step.cue) === rec.cue` **and** (`rec.responseType` absent or equal) | that step |
| `rec.cue` empty/absent, or 0 matches, or 2+ matches | `L.steps[rec.originalStepIndex]` (unchanged fallback) |

Consequences, all intentional:

- A recording made before a regeneration resolves to the step it was recorded for, so `_getResponseSubtitle` burns the matched cue + localized translation again (lesson `a`).
- A lesson whose steps did not move resolves exactly as today (lesson `b`).
- A recording whose `rec.cue` is absent (an `updateSpeechRecording` that never landed) falls back to the index, preserving today's behaviour.
- Two steps with an identical English cue in one lesson are ambiguous, so the index fallback is used (no behaviour change).

`getCueText` is a pure helper (`src/modules/utils/utils.js:12-18`) with no `window`/`document`/`navigator`/URL references, so the planner stays platform-agnostic (the existing purity guard in `video-processor-logic.test.js` still holds).

## Tasks

### Task 1 - Resolve a recorded step by its stored cue, not its raw index

Tests in `src/modules/video/video-processor-logic.test.js`. Build a lesson whose steps were reindexed by a regeneration: `[lessonIntro, { responseType: 'viewAndContinue', simpleVideoUrl: 'intro' }, { responseType: 'friendClosedResponse', cue: [{ en: 'Q1' }], simpleVideoUrl: 'a01' }, { responseType: 'success' }]`, and a recording with `originalStepIndex: 1` (the pre-regeneration index), `cue: 'Q1'`, `responseType: 'friendClosedResponse'`, `matchedCue: 'Q1'`, `translation: 'P1'`, `userResponse: 'q1 transcript'`, `blob: {}` + `generatePlan()`

- → the `webcam` step's `subtitle` is `{ en: 'Q1', translation: 'P1' }`
- → `subtitle.en` is not the raw transcript `'q1 transcript'`

- recording with the same fields but `originalStepIndex: 2` (the current index) + `generatePlan()`
  - → the `webcam` step's `subtitle` is `{ en: 'Q1', translation: 'P1' }` (identical to the shifted case)

- recording with `matchedCue` absent, `translation` absent, `cue: 'Q1'`, `responseType: 'friendClosedResponse'`, `originalStepIndex: 1`, `userResponse: 'q1 transcript'` + `generatePlan()`
  - → the `webcam` step's `subtitle` is `null` (the correct no-match rule, not the raw transcript)

- recording with `cue` absent, `responseType` absent, `originalStepIndex: 1`, `matchedCue: 'Q1'`, `translation: 'P1'` + `generatePlan()`
  - → the `webcam` step's `subtitle.en` is `'q1 transcript'` (index fallback: `steps[1]` is the `viewAndContinue` step, so the non-closed branch applies — documents the fallback)

- lesson `[lessonIntro, { responseType: 'friendClosedResponse', cue: [{ en: 'Q1' }], simpleVideoUrl: 'x1' }, { responseType: 'friendClosedResponse', cue: [{ en: 'Q1' }], simpleVideoUrl: 'x2' }, { responseType: 'success' }]`; recording `cue: 'Q1'`, `responseType: 'friendClosedResponse'`, `originalStepIndex: 1`, `matchedCue: 'Q1'`, `translation: 'P1'`, `blob: {}` + `generatePlan()`
  - → resolves via the index fallback (ambiguous cue → 2 matches), so the `webcam` step's `subtitle` is `{ en: 'Q1', translation: 'P1' }` (from `steps[1]`)

- lesson `[lessonIntro, { responseType: 'friendClosedResponse', cue: [{ en: 'Q1' }], simpleVideoUrl: 'a01', publishLessonId: 'a' }]`, recording `originalStepIndex: 1`, `cue: 'Q1'`, `responseType: 'friendClosedResponse'`, `matchedCue: 'Q1'`, `blob: {}` + `generatePlan()`
  - → the plan still carries `publishLessonId: 'a'` on the webcam step (the resolver is used by `_getPublishLessonId`)

- a `friend` lesson (`recapSources: 'friend'`) whose recorded step was reindexed: steps `[lessonIntro, { responseType: 'viewAndContinue', simpleVideoUrl: 'ab12-model-w-response-01' }, { responseType: 'friendClosedResponse', cue: [{ en: 'Q1' }], simpleVideoUrl: 'a01' }]`, recording `originalStepIndex: 1`, `cue: 'Q1'`, `responseType: 'friendClosedResponse'`, `matchedCue: 'Q1'`, `translation: 'P1'`, `blob: {}` + `generatePlan()`
  - → a `remote` step exists with `targetId === 'ab12-model-w-response-01'` and `subtitle === null` (friend clip rule unchanged, resolution still finds the recorded response step)

- full suite `npm test -- --run`
  - → passes, including every existing `video-processor-logic.test.js` case.

### Task 2 - Document the behavior

Add a test to the existing recap-subtitle docs describe in `src/modules/video/video-processor-logic.test.js` (it already reads `docs/product.md`).

- test reading `docs/product.md`
  - → it contains the link `stories/058-fix-ugc-clip-translation-subtitles/story.md`.
  - → the Known Limitations slice (from `## Known Limitations`) contains `config regeneration` and `stored cue`.

## Technical Context

- No new dependencies and no new app/service/package: no Bootstrap section.
- `VideoRenderPlanner` lives in `src/modules/video/video-processor-logic.js`; `getCueText` is exported from `src/modules/utils/utils.js`. `rec.cue` is written by `updateSpeechRecording` (`src/modules/answer/answer-pipeline.js:587,684`, value `getCueText(cue)`); `rec.responseType` is written by the recorder meta (`src/modules/speech/speech-orchestrator.js:363-368`).
- Unit tests: `npm test -- --run` (vitest 4.1.6 + jsdom 29.1.1, colocated `*.test.js`). The affected spec is `src/modules/video/video-processor-logic.test.js`.
- `video-processor-logic.js` is deliberately platform-agnostic: a guard test asserts it references no `window`/`document`/`navigator` and no `http(s)://` literal (`video-processor-logic.test.js`). `getCueText` is pure, so the guard holds.
- `generatePlan` is the single source for the concatenated recap (`video-processor.web.js`), the per-segment R2 export (`exportSegmentsToR2`), and the native recap, so no wiring changes are needed.
- The regression's evidence: `git show 8223bfe:src/config/wouldyourather.json` has lesson `a` steps `[lessonIntro, friendClosedResponse, success]`; `git show f3a7e67:src/config/wouldyourather.json` has `[lessonIntro, viewAndContinue, friendClosedResponse, success]`. Lesson `b`'s `friendClosedResponse` steps stay at indices 2/3 across both.

## Notes

- The bug only manifests for recordings made **before** a config regeneration that shifts the lesson's step list; a fresh recording stores the current index and resolves correctly until the next regeneration. The resolver makes the mapping stable in both cases.
- If the reporter's lesson-`a` recording stored no `matchedCue` (the long ask question failed the 95% match), the correct outcome after the fix is **no subtitle** for that segment, not a guessed cue — story 028's rule. The fix removes the bogus English transcript; it does not invent a translation.
- No manual pixel verification is possible; the contract is the plan object (`webcam.subtitle`), which is exactly what both renderers consume.
- Manual check: complete lesson `a`, generate the recap/ask clip, and confirm the burned subtitle is the matched cue with its localized translation (not the raw transcript), and that lesson `b`'s clips are unchanged.
