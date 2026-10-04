# Friend clips keep their own caption in the concatenated recap

## Context

For the friend answer lessons (`b` in `friend.json`/`test.json`/`wouldrather.json`/`newtest.json`, and `wa`/`wfa` in `model.json`) the end-of-lesson recap concatenates the friend's clips (the asker's questions, fetched from R2 as `<shareCode>-<courseId>-<lessonId>-response-NN.mp4`) with the current user's recorded answers.

`VideoRenderPlanner.generatePlan` (`src/modules/video/video-processor-logic.js`) builds each friend clip as a `remote` step and sets its subtitle with `_getStepCue(rec)`. `_getStepCue` returns `rec.matchedCue` first (`:465`), and `rec.matchedCue` is the **current user's** matched answer cue for the response step they recorded. As a result the responder's answer is burned over the friend's question clip, so the one speaker's caption appears on every segment.

The friend clip is itself a previously-published UGC segment: `exportSegmentsToR2` renders each `webcam` segment through `renderStepToBlob` → `executeRenderLoop` → `drawTextOverlay(step.subtitle)` (`video-processor.web.js:1300-1345,658-663`), and for the asker's `friendClosedResponse`/`closedResponse` steps that subtitle is the asker's own matched cue (the question). The friend's clip therefore already displays the friend's own caption. The recap must not draw a second caption over it.

## Out of Scope

- System/model prompt subtitles. A `remote` step whose target is a system slug keeps `this._getStepCue(rec)` unchanged (story 028 explicitly deferred this).
- The current user's own `webcam` subtitle rule from story 028 (`_getResponseSubtitle`): matched cue for closed responses, nothing when no cue matched, transcript for open responses.
- `_getRemoteTarget` and clip selection (the `remoteSource` source filter, the click-through friend fallback) — only the subtitle of an already-selected friend `remote` step changes.
- Config files: no new question copy and no new flags. The friend's question text is not introduced anywhere.
- How UGC clips are captioned at publish time (`exportSegmentsToR2`), and no backfill of already-published clips.
- The renderer, prefetch, playlist, and R2 upload mechanics. A `null` subtitle is already a supported no-op.
- No new dependency.

## Implementation approach

Single change in `VideoRenderPlanner.generatePlan` (`src/modules/video/video-processor-logic.js:276-286`): a `remote` step whose clip is a friend/UGC video gets `subtitle: null`.

```js
if (needsRemote) {
    const remoteSlug = this._getRemoteTarget(rec);
    if (remoteSlug && remoteSource(remoteSlug) === sources) {
        // Friend (UGC) clips are already captioned: they are published
        // per-segment with their own speaker's cue burned in
        // (exportSegmentsToR2 -> renderStepToBlob). Drawing the response
        // step's cue here would stamp the current user's answer onto the
        // friend's question video, so a friend prompt gets no recap subtitle.
        const isFriendClip = remoteSource(remoteSlug) === 'friend';
        plan.push({
            type: 'remote',
            targetId: remoteSlug,
            subtitle: isFriendClip ? null : this._getStepCue(rec),
            isFirst: plan.length === 0
        });
    }
}
```

`_getStepCue` is retained for the system prompt path.

### Subtitle rule (exhaustive)

For a `remote` plan step, with `remoteSlug = _getRemoteTarget(rec)` and `sources = resolveRecapSources(lesson)`:

| `remoteSource(remoteSlug)` | `=== sources` | Result |
| --- | --- | --- |
| `friend` | `friend` | pushed, `subtitle: null` |
| `system` | `system` | pushed, `subtitle: this._getStepCue(rec)` (unchanged) |
| either | false (`none`, or a mismatched source) | not pushed (unchanged) |

Consequences, all intentional:

- Every remote step admitted by a `recapSources: 'friend'` lesson is a friend clip (the source filter admits only `remoteSource === 'friend'`), so all of a friend lesson's remote segments lose the overlay. This covers both friend-clip placements: the recorded step's own friend clip (`friend.json`/`newtest.json`/`model.json` `wa`/`wfa`, via `_getRemoteTarget`'s first branch) and the borrowed preceding click-through friend clip (`test.json`/`wouldrather.json`, via the fallback scan).
- The user's own `webcam` segments are untouched; they still burn their matched cue.
- A friend clip with no burned-in caption (the asker never matched a cue) has no overlay either — preferable to showing the current user's words on the friend's video.

Null safety: `drawTextOverlay` skips when the unpacked `en` is empty (`video-processor.web.js:1006-1016`), and `video-processor.native.jsx` renders only a truthy subtitle (`:339`), so `null` draws nothing.

## Tasks

### Task 1 - Friend remote segments get no recap subtitle

Tests in `src/modules/video/video-processor-logic.test.js`. Reuse `makeConfig`/`makeRecordings`; give every recorded step an explicit `responseType` so the planner's classification is unambiguous.

- friend lesson (`recapSources: 'friend'`), steps `[lessonIntro, { responseType: 'friendClosedResponse', simpleVideoUrl: 'ab12-model-w-response-09', cue: 'Q1' }]`, recording at index 1 `{ matchedCue: 'I would rather have a million dollars.', userResponse: 'i would rather have a million dollars' }` + `generatePlan()`
  - → a remote step exists with `targetId === 'ab12-model-w-response-09'` (the clip is not dropped)
  - → the remote step's `subtitle` is `null` (neither the matched cue nor the configured cue `'Q1'`)
  - → the webcam step's `subtitle.en` is `'I would rather have a million dollars.'` (webcam rule unchanged)
- friend lesson, steps `[lessonIntro, { responseType: 'viewAndContinue', simpleVideoUrl: 'ab12-model-w-response-01' }, { responseType: 'friendClosedResponse', simpleVideoUrl: 'testvideo05', cue: 'Q1' }]`, recording at index 2 `{ matchedCue: 'Q1 matched', userResponse: 'q1 matched' }` + `generatePlan()`
  - → the remote step's `targetId` is `'ab12-model-w-response-01'` and its `subtitle` is `null`
  - → the webcam step's `subtitle.en` is `'Q1 matched'`
- friend lesson, recorded `friendClosedResponse` on its own friend clip with `cue: 'Q1'`, recording with `matchedCue` absent + `generatePlan()`
  - → the remote step's `subtitle` is `null` (no fallback to the configured cue)
- friend lesson, three click-through friend clips (`ab12-model-w-response-01/02/03` at indices 1, 3, 5) each followed by a recorded system response (`testvideo05/06/07` at indices 2, 4, 6), recordings at indices 2, 4, 6 each with its own `matchedCue` + `generatePlan()`
  - → plan types are `['remote', 'webcam', 'remote', 'webcam', 'remote', 'webcam', 'tailing']`
  - → every remote step's `subtitle` is `null`
  - → the three remote `targetId`s are `ab12-model-w-response-01`, `ab12-model-w-response-02`, `ab12-model-w-response-03`
- system lesson (`recapSources: 'system'`), recorded step `{ responseType: 'closedResponse', interactiveVideoUrl: 'testvideo02', cue: 'Q1' }` at index 0, recording `{ userResponse: 'answer 1' }` + `generatePlan()`
  - → the remote step's `subtitle.en` is `'Q1'` (system prompt subtitle unchanged)
- update the existing `'borrows the preceding click-through friend clip for a system response step'` case (`video-processor-logic.test.js:217-236`)
  - → the remote `targetId` is `'ab12-model-w-response-01'`
  - → the remote `subtitle` is `null` (was `'Q1'`); the stale "Cue still comes from the recorded response step" comment is replaced
- full suite `npm test -- --run`
  - → passes, including every existing `video-processor-logic.test.js` case.

### Task 2 - Document the behavior

Add a test to the existing `recap subtitle docs` describe in `src/modules/video/video-processor-logic.test.js` (it already reads `docs/product.md`).

- test reading `docs/product.md`
  - → it contains the link `stories/036-fix-friend-lesson-subtitles/story.md`.
  - → the Features slice (`## Features` … `## Non-Goals`) contains `Friend clips keep their own caption in the recap`, `gets no subtitle from the recap`, and `already carries its own speaker's caption burned in`.
  - → the Known Limitations slice (from `## Known Limitations`) contains `no burned-in caption`, `shows no subtitle`, and `never used as a fallback`.

## Technical Context

- No new dependencies and no new app/service/package: no Bootstrap section.
- `VideoRenderPlanner` and `_getStepCue` live in `src/modules/video/video-processor-logic.js`; `remoteSource`/`isFriendVideoSlug`/`FRIEND_VIDEO_REGEX` (`/-response-\d+$/i`) live in `src/modules/video/video-source.js`.
- Unit tests: `npm test -- --run` (vitest 4.1.6 + jsdom 29.1.1, colocated `*.test.js`). The affected spec is `src/modules/video/video-processor-logic.test.js`.
- `video-processor-logic.js` is deliberately platform-agnostic: a guard test asserts it references no `window`/`document`/`navigator` and no `http(s)://` literal (`video-processor-logic.test.js:797-831`). The new code is a pure object mapping and stays that way.
- `generatePlan` is the single source for the concatenated recap (`video-processor.web.js:172-173`), the per-segment R2 export (`:1371-1372`), and the native recap (`video-processor.native.jsx:54-55`), so no wiring changes are needed. The per-segment export filters to `webcam` steps, so its output is unaffected.
- UGC clips already carry their own caption because publish renders each segment's plan subtitle (`renderStepToBlob` → `executeRenderLoop` → `drawTextOverlay`), and a closed-response (`closedResponse`/`friendClosedResponse`) segment's subtitle is its matched cue (story 028).

## Notes

- The fix is keyed on the target being a friend clip (`remoteSource(remoteSlug) === 'friend'`), not on the lesson's `recapSources`. In a `system`/`none` lesson a friend remote is filtered out before the push, so the two are equivalent today, but keying on the target is exact and survives future source-filter changes.
- The friend's question text is intentionally not surfaced as a recap overlay: it does not exist in the answer lessons' config, and the clip already shows it. Adding it would require new copy in every `b`/`wa`/`wfa` config and would double the burned-in caption.
- No manual pixel verification is possible; the contract is the plan object (`remote.subtitle === null`), which is exactly what both renderers consume (`video-processor.web.js:658-663`, `video-processor.native.jsx:219,339`).
- Manual check: finish a friend answer lesson, create the recap, and confirm the friend's question clip shows only its own caption while the user's answer clip shows the answer.
