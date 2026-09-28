# Burn the matched cue, not the transcript, into recap subtitles

## Context

The end-of-lesson recap video and the per-segment R2 clips render a subtitle over each of the learner's recorded clips. `VideoRenderPlanner.generatePlan()` builds that subtitle from the raw speech-to-text transcript: `subtitle: { en: userText, translation: rec.translation || null }` (`src/modules/video/video-processor-logic.js:313`).

For a `closedResponse`/`friendClosedResponse` step the transcript is matched against the step's cue at answer time. `findMatchingCueText` (`src/modules/answer/answers.js:108`) returns the canonical cue variant the learner's speech best matched, and the answer pipeline stores it on the recording as `matchedCue` (plus the matching localized `translation`) via `updateSpeechRecording` (`src/modules/answer/answer-pipeline.js:663,682-692`). The in-lesson whisper review already displays that canonical text (`src/modules/speech/speech-orchestrator.js:104-108`), and the IndexedDB persistence design explicitly lists `matchedCue` as a field the video planner reads (`plans/persist-recordings-idb.md:18,321`).

The recap path never uses it, so a correct answer whose transcript had a recognition error burns the misspelled transcript into the exported video. The subtitle must instead burn `rec.matchedCue` when one exists.

## Out of Scope

- No change to the cue-matching algorithm, its threshold, or `answers.js`. `rec.matchedCue` as currently computed is authoritative.
- No change to the remote/prompt segment subtitle, which already uses `_getStepCue(rec)` (`video-processor-logic.js:282`).
- No change to subtitle styling, wrapping, translation rendering, or the `drawTextOverlay` signature (`video-processor.web.js`).
- No change to `answer-pipeline.js` writing of `matchedCue`/`translation`, and no backfill of already-recorded clips.
- No new dependency.

## Implementation approach

All changes are in the platform-agnostic planner `src/modules/video/video-processor-logic.js`, so both consumers pick them up unchanged: the concatenated recap (`video-processor.web.js:172-173`), the per-segment R2 export (`video-processor.web.js:1371-1372`), and the native recap (`video-processor.native.jsx:54-55`) all call `generatePlan()`.

Add one private method to `VideoRenderPlanner` and call it from the `webcam` plan step:

```js
/**
 * Subtitle for a learner's recorded (webcam) segment. Prefers the specific cue
 * variant their transcript matched at answer time (`rec.matchedCue`) so the
 * burned text is the canonical, correctly-spelled cue rather than the
 * error-prone transcript. Falls back to the transcript when no cue was matched
 * (open-response steps, and closed responses that never reached the threshold).
 * Mirrors the `rec.matchedCue` branch of `_getStepCue`, but a prompt segment
 * falls back to the lesson cue while a recorded segment falls back to the
 * transcript.
 */
_getResponseSubtitle(rec, userText) {
    if (typeof rec.matchedCue === 'string' && rec.matchedCue.length > 0) {
        return { en: rec.matchedCue, translation: rec.translation || null };
    }
    return { en: userText, translation: rec.translation || null };
}
```

Then replace `subtitle: { en: userText, translation: rec.translation || null }` in the `webcam` `plan.push` (`video-processor-logic.js:313`) with `subtitle: this._getResponseSubtitle(rec, userText)`.

### Subtitle rule (exhaustive)

For a `webcam` plan step, the subtitle is:

| Condition | `subtitle.en` | `subtitle.translation` |
| --- | --- | --- |
| `rec.matchedCue` is a non-empty string | `rec.matchedCue` | `rec.translation \|\| null` |
| otherwise | `userText` (existing fallback chain, `video-processor-logic.js:291-295`) | `rec.translation \|\| null` |

Consequences, all intentional:

- Correct/matched closed responses burn the cue (plain, array variant, template-expanded, or regex-reconstructed) — the bug being fixed.
- `openResponse` steps never compute `matchedCue`, so they keep burning the transcript.
- A closed response that never reached the similarity threshold (`matchedCue` null/absent) keeps burning the transcript. There is no corresponding cue in that case; this is the one judgement call, recorded so a reviewer can veto it.
- Text-mode recordings also carry `matchedCue` when applicable, so their avatar-card segments burn the cue too.
- A recording restored from IndexedDB spreads `...rec`, so `matchedCue` survives the round-trip (`plans/persist-recordings-idb.md:252`; asserted in `tests/recording-persistence.spec.js`).

`getAllSpeechRecordingsForLesson` dedupes to the newest record per step (`storage.web.js:97-129`), so after a wrong attempt and a corrected retry only the retry's recording — which carries `matchedCue` — reaches the planner.

## Tasks

### Task 1 - Prefer `rec.matchedCue` for recorded-segment subtitles

- a recording with `matchedCue: 'I like English'`, `userResponse: 'i like inglish'`, `translation: 'Me gusta el inglés'`, referencing a step whose cue is the array `['I love English', 'I like English', 'I adore English']` + `generatePlan()`
  - → the `webcam` step's `subtitle.en` is `'I like English'`.
  - → the `webcam` step's `subtitle.translation` is `'Me gusta el inglés'`.
  - → `subtitle.en` is not the transcript `'i like inglish'`.
- a recording with `matchedCue` referencing a template step (cue `{ en: 'I [feeling] English', slots: { feeling: ['love', 'like'] } }`) + `generatePlan()`
  - → `subtitle.en` is the matched expanded variant (`'I like English'`), never the raw `'I [feeling] English'`.
- a recording with `matchedCue` and no `translation` + `generatePlan()`
  - → `subtitle.translation` is `null`.
- a recording with `matchedCue` absent and `userResponse: 'answer 1'` + `generatePlan()`
  - → `subtitle.en` is `'answer 1'` (fallback unchanged).
  - → `subtitle.translation` is `null`.
- a recording with `matchedCue: ''` and `userResponse: 'answer 1'` + `generatePlan()`
  - → `subtitle.en` is `'answer 1'` (empty string is treated as no match).
- a recording with `matchedCue: 'Correct cue'`, `isTextMode: true`, `userResponse: 'typed answer'` + `generatePlan()`
  - → the `webcam` step's `subtitle.en` is `'Correct cue'`.
- an `openResponse` recording (no `matchedCue`) with `userResponse: 'my open answer'` + `generatePlan()`
  - → `subtitle.en` is `'my open answer'`.
- a recording whose only response text is in `rec.meta.userResponse` (no top-level `userResponse`) and no `matchedCue` + `generatePlan()`
  - → `subtitle.en` is the `meta.userResponse` value (fallback chain unchanged).
- any of the above + `generatePlan()`
  - → `remote` step subtitles are unchanged (`_getStepCue` semantics), including the existing case at `video-processor-logic.test.js:184-203`.
- full suite `npm test -- --run`
  - → passes, including all existing `video-processor-logic.test.js` cases.

### Task 2 - Document the behavior

Add a `describe('recap subtitle docs')` to `src/modules/video/video-processor-logic.test.js` that reads `docs/product.md` relative to the repo root (precedent: `scripts/generate-captions.test.js:72-75`).

- test reading `docs/product.md`
  - → it contains the link `stories/028-burn-cue-not-transcription/story.md`.
  - → it contains the phrase `matched cue`.
  - → a Features bullet states the recorded-clip subtitle is the matched cue rather than the raw speech-to-text transcript.
  - → the Known Limitations list states that an answer with no matched cue (open response, or one below the similarity threshold) still burns the transcript.

## Technical Context

- No new dependencies. Tests run with the existing `vitest ^4.1.6` (`npm test -- --run`); the affected spec is `src/modules/video/video-processor-logic.test.js` (52 passing today).
- `video-processor-logic.js` is deliberately platform-agnostic: a guard test asserts it references no `window`/`document`/`navigator` and no `http(s)://` literal (`video-processor-logic.test.js:600-621`). The new method is a pure object mapping and must stay that way.
- `generatePlan()` is the single source of both the recap overlay and the per-segment R2 clips, so the fix requires no wiring changes.
- The recording shape carrying `matchedCue` is produced by `saveSpeechRecording` (`storage.web.js:41-65`) + `updateSpeechRecording` (`storage.web.js:225-249`) and documented in `plans/persist-recordings-idb.md:18,252,321`.
- The planner's webcam config-derived fallback is intentionally absent: unlike `_getStepCue`, it does not read `q.cue` from the lesson config, because a template/array cue's raw config text (`I [feeling] English`, an array object) is not displayable; only the matched variant is.
- Docs convention: feature/docs wiring is asserted by unit tests elsewhere in the repo (e.g. `scripts/generate-captions.test.js:72-75`, `scripts/verify-thumbnails.test.js:99-101`), which is why Task 2 includes an automated assertion.

## Notes

- Scope is the `webcam` step's `subtitle` only. `remote` prompt subtitles keep `_getStepCue(rec)`, whose matched-cue branch already produces the same `{ en: rec.matchedCue, translation: rec.translation || null }` shape.
- The fallback choice — keep burning the transcript when `matchedCue` is absent — is an explicit assumption, not a stated requirement: the learner asked for "the corresponding cue", and no cue corresponds to an answer that never matched within threshold. If the desired behavior is "always burn the config cue for closed responses", that would additionally require handling template/array/regex cues without a match and is a follow-up decision.
- Text-mode segments become the cue too when a cue matched; this follows from text-mode answers going through the same `findMatchingCueText` call and is consistent with the goal (typed typos should not be burned either).
- No manual verification is possible for the actual pixels; the contract is the plan object (`subtitle.en` / `subtitle.translation`), which is exactly what both renderers consume (`video-processor.web.js:661`, `video-processor.native.jsx:219`).
