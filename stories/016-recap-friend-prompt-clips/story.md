# Recap keeps friend prompt clips shown on click-through steps

## Context

The friend-challenge answer lesson now presents each friend's question as a click-through step before the response step. In `src/config/test.json` lesson `b` the sequence per question is:

1. `viewAndContinue` with the friend's clip (`{friendCode}friend-a-response-01/02/03`) — no `cue`, no `subtitles`, the learner only clicks Continue.
2. `friendClosedResponse` with the teacher's explanatory clip (`testvideo05/06/07`) plus the answer `cue` — the learner hears how to respond and then records.

`VideoRenderPlanner.generatePlan` (`src/modules/video/video-processor-logic.js:205-280`) builds a `remote` prompt segment only for steps that have a recording, taking the prompt video from `lesson.steps[rec.originalStepIndex]` via `_getRemoteTarget` (`:354-362`). Because the friend clip now lives on a non-recorded `viewAndContinue` step, and the recorded response step's own video is the system clip `testvideo05/06/07` (`remoteSource === 'system'`), a `recapSources: "friend"` lesson drops the friend's question clips entirely — the end-of-lesson "combined video with your friend" recap loses the friend's half of the conversation.

The friend's question clips must appear in the recap again, without reverting the lesson flow to responding on the friend clip.

## Out of Scope

- The lesson flow itself. `src/config/test.json` lesson `b` already has the click-through friend clips and explanatory response steps; no further JSON restructuring is required by this story beyond what is already applied.
- Every other course config (`friend.json`, `model.json`, `gt2.json`, `t.json`, `test-api.json`) — their recorded steps already carry the friend clip, so the new fallback is a no-op for them.
- `_getStepCue` (`:364-388`) and the remote segment's overlay text, the `webcam` segment, the `tailing` variant, and `prefetchRemoteClips` / render / publish behavior.
- System prompts shown on click-through steps. The fallback is deliberately limited to `recapSources: "friend"` so system/none recaps are unchanged.
- Any new lesson-config flag (e.g. no `recapPromptIndex`); the pairing is derived from step order.

## Implementation approach

Single change in `src/modules/video/video-processor-logic.js`: extend `_getRemoteTarget(rec)` (`:354-362`) with a friend-prompt fallback.

Current method:

```js
_getRemoteTarget(rec) {
    const lesson = this._getLesson(rec);
    if (!lesson?.steps?.[rec.originalStepIndex]) return null;
    const q = lesson.steps[rec.originalStepIndex];
    return q.interactiveVideoUrl || q.introBackgroundVideoUrl || q.simpleVideoUrl || null;
}
```

New behavior, in order:

1. Resolve the recorded step's own target with the existing precedence `interactiveVideoUrl || introBackgroundVideoUrl || simpleVideoUrl`. If no step exists at `originalStepIndex`, return `null` (unchanged).
2. If `own` is set and `remoteSource(own) === 'friend'`, return `own`. This preserves the existing `model.json` `wa`/`wfa` behavior, where the friend clip is on the recorded step.
3. Else if `resolveRecapSources(lesson) === 'friend'`, scan backwards from `rec.originalStepIndex - 1`:
   - stop (and return `own`, i.e. no fallback) if the step's `responseType` is one of `closedResponse`, `openResponse`, `friendClosedResponse` (a question boundary — never borrow a previous question's clip), or if the index goes below `0`;
   - otherwise, if that step's resolved target has `remoteSource(target) === 'friend'`, return it.
4. Return `own`.

Pseudocode for the fallback:

```js
const RESPONSE_TYPES = new Set(['closedResponse', 'openResponse', 'friendClosedResponse']);

function stepTarget(step) {
    return step.interactiveVideoUrl || step.introBackgroundVideoUrl || step.simpleVideoUrl || null;
}
```

`generatePlan`'s existing filter (`remoteSource(remoteSlug) === sources`, `:225`) then admits the friend clip for `recapSources: 'friend'` and still drops it everywhere else. `_getStepCue(rec)` continues to read the recorded (response) step's `cue`, so the remote segment's subtitle is unchanged.

Why the recording still pairs correctly: each `friendClosedResponse` at index `N` is immediately preceded by its own `viewAndContinue` friend clip at index `N-1`; the scan hits it before any response-step boundary, while a second consecutive response step would stop the scan instead of reusing the first question's clip.

## Tasks

### Task 1 - Planner friend-prompt fallback

`src/modules/video/video-processor-logic.test.js`, new cases in the existing `VideoRenderPlanner.generatePlan — recapSources clip selection` describe block. Reuse the `makeConfig` / `makeRecordings` helpers; steps are plain objects.

- lesson `recapSources: 'friend'`, steps `[lessonIntro, viewAndContinue {simpleVideoUrl: 'ab12-model-w-response-01'}, friendClosedResponse {simpleVideoUrl: 'testvideo05', cue: 'Q1'}]`, one recording at step index 2
  - → plan types are `['remote', 'webcam', 'tailing']`
  - → the remote `targetId === 'ab12-model-w-response-01'`
  - → the remote `subtitle.en === 'Q1'` (cue comes from the response step)

- lesson `recapSources: 'friend'` with three click-through friend clips (`ab12-model-w-response-01/02/03` at indices 1, 3, 5) each followed by a system `friendClosedResponse` (`testvideo05/06/07` at indices 2, 4, 6), recordings at indices 2, 4, 6
  - → plan types are `['remote', 'webcam', 'remote', 'webcam', 'remote', 'webcam', 'tailing']`
  - → the three remote `targetId`s in order are `ab12-model-w-response-01`, `ab12-model-w-response-02`, `ab12-model-w-response-03`

- lesson `recapSources: 'friend'`, recorded `friendClosedResponse` whose own `simpleVideoUrl` is already a friend slug (`ab12-model-w-response-09`)
  - → remote `targetId === 'ab12-model-w-response-09'` (own clip wins; no fallback)

- lesson `recapSources: 'system'`, click-through friend clip at index 1 and recorded `friendClosedResponse` whose own `simpleVideoUrl` is `testvideo05` at index 2
  - → remote `targetId === 'testvideo05'` (no cross-source fallback in a system lesson)

- lesson `recapSources: 'none'`, click-through friend clip followed by a recorded system response step
  - → zero remote steps

- lesson `recapSources: 'friend'`, recorded `friendClosedResponse` with `simpleVideoUrl: 'testvideo05'` and no friend clip at any earlier index
  - → zero remote steps

- lesson `recapSources: 'friend'`, steps `[viewAndContinue friend-01, friendClosedResponse testvideo05, friendClosedResponse testvideo06]`, recordings at indices 1 and 2
  - → exactly one remote, for the index-1 recording (`targetId === 'ab12-model-w-response-01'`); the index-2 recording gets no remote (scan stops at the response boundary)

- lesson `recapSources: 'friend'`, click-through friend clip followed by a system response step, two recordings at the same response index (retry)
  - → exactly one remote and plan types `['remote', 'webcam', 'webcam', 'tailing']`

### Task 2 - Pin the motivating config

`src/modules/video/model-config.test.js` (already globs every `src/config/*.json`), new `test.json` structure assertions:

- `src/config/test.json` lesson `b` is read
  - → each of its `viewAndContinue` steps has a `simpleVideoUrl` matching `/-response-\d+$/` and has no `cue` and no `subtitles`
  - → each `viewAndContinue` friend clip is immediately followed by a `friendClosedResponse` step whose `simpleVideoUrl` is one of `testvideo05`, `testvideo06`, `testvideo07` and which has a `cue`
  - → `lesson.recapSources === 'friend'`

## Technical Context

- `VideoRenderPlanner` and `resolveRecapSources` live in `src/modules/video/video-processor-logic.js`; `remoteSource`/`isFriendVideoSlug`/`FRIEND_VIDEO_REGEX` (`/-response-\d+$/i`) live in `src/modules/video/video-source.js`.
- `generatePlan` iterates the recordings array; `needsRemote` is false when the previous recording has the same `originalStepIndex`, which is what dedupes retry pairs (`:212-213`).
- Configs are normalized before planning (`normalizeConfig`, `config-normalizer.js`), so `{friendCode}` is already substituted and `remoteSource` only ever sees resolved slugs.
- Unit tests: `npm test -- --run` (vitest 4.1.6 + jsdom 29.1.1, colocated `*.test.js`). `src/modules/video/video-processor-logic.test.js` already covers `generatePlan`; the new cases extend it. `src/modules/video/model-config.test.js` already reads every config with `readdirSync`.
- No new dependencies and no new app/service/package: no Bootstrap section.

## Notes

- `src/config/test.json` is the config this change was authored for. It is a copy of `friend.json` with lesson `b` reordered; it is part of this branch's deliverable.
- Only the friend question clips are restored to the recap. The teacher explanatory clip (`testvideo05/06/07`) is the recorded step's own system video and is intentionally excluded from a `recapSources: 'friend'` recap by the existing source filter.
- Mic/camera/R2 playback cannot be exercised headlessly, so the unit tests are the verification gate; the manual check is to answer a friend lesson and confirm the recap opens on the friend's question clip, interleaved with the webcam answers.
