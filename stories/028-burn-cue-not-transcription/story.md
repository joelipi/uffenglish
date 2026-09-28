# Burn the matched cue, not the transcript, into recap subtitles

## Context

The end-of-lesson recap video and the per-segment R2 clips render a subtitle over each of the learner's recorded clips. `VideoRenderPlanner.generatePlan()` builds that subtitle from the raw speech-to-text transcript: `subtitle: { en: userText, translation: rec.translation || null }` (`src/modules/video/video-processor-logic.js:313`).

For a `closedResponse`/`friendClosedResponse` step the transcript is matched against the step's cue at answer time. `findMatchingCueText` (`src/modules/answer/answers.js:108`) returns the canonical cue variant the learner's speech best matched, and the answer pipeline stores it on the recording as `matchedCue` (plus the matching localized `translation`) via `updateSpeechRecording` (`src/modules/answer/answer-pipeline.js:663,682-692`). The in-lesson whisper review already displays that canonical text (`src/modules/speech/speech-orchestrator.js:104-108`), and the IndexedDB persistence design explicitly lists `matchedCue` as a field the video planner reads (`plans/persist-recordings-idb.md:18,321`).

The recap path never uses it, so a correct answer whose transcript had a recognition error burns the misspelled transcript into the exported video. A closed-response subtitle must be the matched cue when there is one — and no subtitle at all when there is not — but never the transcript.

## Out of Scope

- No change to the cue-matching algorithm, its threshold, or `answers.js`. `rec.matchedCue` as currently computed is authoritative.
- No change to `_getStepCue` itself or to the remote/prompt segment subtitle, which keeps using it (`video-processor-logic.js:282`).
- No change to `openResponse` subtitles: with no canonical cue to match, those keep burning the transcript.
- No change to subtitle styling, wrapping, translation rendering, or the `drawTextOverlay` signature (`video-processor.web.js`).
- No change to `answer-pipeline.js` writing of `matchedCue`/`translation`, and no backfill of already-recorded clips.
- No new dependency.

## Implementation approach

All changes are in the platform-agnostic planner `src/modules/video/video-processor-logic.js`, so both consumers pick them up unchanged: the concatenated recap (`video-processor.web.js:172-173`), the per-segment R2 export (`video-processor.web.js:1371-1372`), and the native recap (`video-processor.native.jsx:54-55`) all call `generatePlan()`.

Add one private method to `VideoRenderPlanner` and call it from the `webcam` plan step. The step's `responseType` comes from the lesson config via the existing `_getLesson(rec)` / `rec.originalStepIndex` lookup used by `_getStepCue`:

```js
/**
 * Subtitle for a learner's recorded (webcam) segment. A closed-response step
 * burns the specific cue variant the transcript matched (`rec.matchedCue`, with
 * its localized `rec.translation`) and nothing when there was no match — a
 * no-match means the answer was wrong, so neither the transcript nor a guessed
 * cue belongs on the video. A non-cue step (open response) keeps burning the
 * transcript.
 */
_getResponseSubtitle(rec, userText) {
    const step = this._getLesson(rec)?.steps?.[rec.originalStepIndex];
    const isClosedResponse =
        step?.responseType === 'closedResponse' ||
        step?.responseType === 'friendClosedResponse';

    if (!isClosedResponse) {
        return { en: userText, translation: rec.translation || null };
    }

    if (typeof rec.matchedCue === 'string' && rec.matchedCue.length > 0) {
        return { en: rec.matchedCue, translation: rec.translation || null };
    }

    return null; // wrong answer: no subtitle
}
```

Then replace `subtitle: { en: userText, translation: rec.translation || null }` in the `webcam` `plan.push` (`video-processor-logic.js:313`) with `subtitle: this._getResponseSubtitle(rec, userText)`.

### Subtitle rule (exhaustive)

For a `webcam` plan step, the subtitle is:

| Step `responseType` | `rec.matchedCue` | Result |
| --- | --- | --- |
| `closedResponse` / `friendClosedResponse` | non-empty string | `{ en: rec.matchedCue, translation: rec.translation \|\| null }` |
| `closedResponse` / `friendClosedResponse` | absent/empty | `null` (no subtitle) |
| anything else (e.g. `openResponse`, missing step) | n/a | `{ en: userText, translation: rec.translation \|\| null }` (existing fallback chain, `video-processor-logic.js:291-295`) |

Consequences, all intentional:

- A closed response never burns the transcript, not even a wrong/unmatched attempt — the reported bug is fixed at the source.
- A matched cue burns the specific variant (plain, array variant, template-expanded, or regex-reconstructed) with its localized translation.
- A closed response with no match burns no subtitle. This is reachable when a learner advances after more than two incorrect attempts (`answer-pipeline.js:1014,1025`); showing the transcript would misrepresent what they said, and a configured cue would claim they said something they did not.
- `openResponse` steps never compute `matchedCue`, so they keep burning the transcript.
- Text-mode recordings also carry `matchedCue` when applicable, so their avatar-card segments burn the cue too.
- A recording restored from IndexedDB spreads `...rec`, so `matchedCue` survives the round-trip (`plans/persist-recordings-idb.md:252`; asserted in `tests/recording-persistence.spec.js`).

A `null` subtitle is safe: `drawTextOverlay` skips when the unpacked `en` is empty (`video-processor.web.js:1006-1016`), and the native view only renders a truthy `subtitle` (`video-processor.native.jsx:339`).

`getAllSpeechRecordingsForLesson` dedupes to the newest record per step (`storage.web.js:97-129`), so after a wrong attempt and a corrected retry only the retry's recording — which carries `matchedCue` — reaches the planner.

## Tasks

### Task 1 - Closed responses always burn the cue, never the transcript

Write the tests in `src/modules/video/video-processor-logic.test.js`. Each fixture needs a lesson step with an explicit `responseType` at the recording's `originalStepIndex`; add named step builders rather than reusing `SYSTEM_STEPS` so the response type is unambiguous.

- a `closedResponse` step + recording `{ matchedCue: 'I like English', userResponse: 'i like inglish', translation: 'Me gusta el inglés' }` + `generatePlan()`
  - → the `webcam` step's `subtitle.en` is `'I like English'`.
  - → the `webcam` step's `subtitle.translation` is `'Me gusta el inglés'`.
  - → `subtitle.en` is not the transcript `'i like inglish'`.
- a `closedResponse` step whose cue is a template `{ en: 'I [feeling] English', slots: { feeling: ['love', 'like'] } }` + recording with `matchedCue: 'I like English'` + `generatePlan()`
  - → `subtitle.en` is `'I like English'`, never the raw `'I [feeling] English'`.
- a `closedResponse` step whose cue is an array `['I love English', 'I like English']` + recording with `matchedCue: 'I like English'` + `generatePlan()`
  - → `subtitle.en` is `'I like English'` (the matched variant is used regardless of cue shape).
- a `closedResponse` step + recording with `matchedCue` and no `translation` + `generatePlan()`
  - → `subtitle.translation` is `null`.
- a `closedResponse` step whose cue is `{ en: 'I love English', es: 'Amo el inglés' }` + recording with `matchedCue` absent, `userResponse: 'i love inglish'`, planner `userLang` `'es'` + `generatePlan()`
  - → the `webcam` step's `subtitle` is `null` (no match → no subtitle; the configured cue is not used).
- a `closedResponse` step whose cue is the plain string `'Q1'` + recording with `matchedCue` absent, `userResponse: 'answer 1'` + `generatePlan()`
  - → the `webcam` step's `subtitle` is `null`; it is never `'answer 1'` and never `'Q1'`.
- a `closedResponse` step whose cue is the array `['I love English', 'I like English']` + recording with `matchedCue` absent, `userResponse: 'answer 1'` + `generatePlan()`
  - → the `webcam` step's `subtitle` is `null`.
- a `closedResponse` step whose cue is a template `{ en: 'I [feeling] English', slots: { feeling: ['love'] } }` + recording with `matchedCue` absent + `generatePlan()`
  - → the `webcam` step's `subtitle` is `null`.
- a `closedResponse` step + recording with `matchedCue: ''`, `userResponse: 'answer 1'` + `generatePlan()`
  - → the `webcam` step's `subtitle` is `null` (empty string is treated as no match).
- a `closedResponse` step + recording with `matchedCue` absent, `userResponse: ''` + `generatePlan()`
  - → the `webcam` step's `subtitle` is `null` (no subtitle, no empty-string subtitle object).
- a `closedResponse` step + recording `{ matchedCue: 'Correct cue', isTextMode: true, userResponse: 'typed answer' }` + `generatePlan()`
  - → the `webcam` step's `subtitle.en` is `'Correct cue'`.
- an `openResponse` step + recording (no `matchedCue`) `userResponse: 'my open answer'` + `generatePlan()`
  - → `subtitle.en` is `'my open answer'` (transcript fallback preserved).
- a recording that references no resolvable step (empty `configData`, or an `originalStepIndex` with no step) + `userResponse: 'answer 1'` + `generatePlan()`
  - → `subtitle.en` is `'answer 1'` (cannot be classified as a cue step, so the transcript fallback applies).
- any of the above + `generatePlan()`
  - → `remote` step subtitles are unchanged (`_getStepCue` semantics), including the existing case at `video-processor-logic.test.js:184-203`.
- full suite `npm test -- --run`
  - → passes, including all existing `video-processor-logic.test.js` cases.

### Task 2 - Document the behavior

Add a `describe('recap subtitle docs')` to `src/modules/video/video-processor-logic.test.js` that reads `docs/product.md` relative to the repo root (precedent: `scripts/generate-captions.test.js:72-75`).

- test reading `docs/product.md`
  - → it contains the link `stories/028-burn-cue-not-transcription/story.md`.
  - → it contains the phrase `matched cue`.
  - → a Features bullet states a closed-response recorded-clip subtitle is the matched cue when one exists and no subtitle otherwise, never the raw speech-to-text transcript.
  - → the Known Limitations list states that open-response answers (which have no cue to match) still burn the transcript.

## Technical Context

- No new dependencies. Tests run with the existing `vitest ^4.1.6` (`npm test -- --run`); the affected spec is `src/modules/video/video-processor-logic.test.js` (52 passing today).
- `video-processor-logic.js` is deliberately platform-agnostic: a guard test asserts it references no `window`/`document`/`navigator` and no `http(s)://` literal (`video-processor-logic.test.js:600-621`). The new method is a pure object mapping and must stay that way.
- `generatePlan()` is the single source of both the recap overlay and the per-segment R2 clips, so the fix requires no wiring changes.
- The recording shape carrying `matchedCue` is produced by `saveSpeechRecording` (`storage.web.js:41-65`) + `updateSpeechRecording` (`storage.web.js:225-249`) and documented in `plans/persist-recordings-idb.md:18,252,321`.
- `responseType` is always present on a config step (`src/config/*.json`), and `_getLesson(rec)` resolves the recorded step from `rec.originalLessonId` / `rec.originalStepIndex` exactly as `_getStepCue` does.
- Docs convention: feature/docs wiring is asserted by unit tests elsewhere in the repo (e.g. `scripts/generate-captions.test.js:72-75`, `scripts/verify-thumbnails.test.js:99-101`), which is why Task 2 includes an automated assertion.

## Notes

- Scope is the `webcam` step's `subtitle` only. `remote` prompt subtitles keep `_getStepCue(rec)`, whose matched-cue branch already produces the same `{ en: rec.matchedCue, translation: rec.translation || null }` shape.
- The unmatched closed-response case is reachable: `showFeedbackAndProceed` lets a learner advance after more than two incorrect attempts (`answer-pipeline.js:1014,1025`), and `getAllSpeechRecordingsForLesson` keeps only the newest record per step (`storage.web.js:97-129`), so their last wrong attempt reaches the planner. It gets no subtitle — deliberately, per the product decision that a no-match answer is wrong and should not be captioned.
- A correct regex answer can also lack `matchedCue`: `evaluateClosedResponse` tests the normalized transcript (`answers.js:35-43`) while `findMatchingCueText` execs the raw one (`answers.js:115-125`). The only regex cue (`model.json:317-321`) therefore falls to no subtitle rather than a wrong one; fixing that mismatch is out of scope.
- Text-mode segments become the cue too when a cue matched; this follows from text-mode answers going through the same `findMatchingCueText` call and is consistent with the goal (typed typos should not be burned either).
- No manual verification is possible for the actual pixels; the contract is the plan object (`subtitle.en` / `subtitle.translation`), which is exactly what both renderers consume (`video-processor.web.js:661`, `video-processor.native.jsx:219`).
