# Fix recap user-clip truncation to net-speaking duration

## Context

In the concatenated end-of-lesson recap, a user-recorded segment can be cut down
to well under its real length (a friend-lesson report saw the 2nd of 3 clips
present for "less than a second"). The user's own webcam segments advance on
`video.currentTime >= endTime` in the render loop (`src/modules/video/video-processor.web.js:665-705`).

`endTime` is computed at `video-processor.web.js:670-671` as:

```js
const endTime = step.trim?.end
    || (Number.isFinite(rawDuration) ? rawDuration : (step.duration || 60));
```

`rawDuration` is `video.duration` — the clip's real media length. When a
MediaRecorder WebM blob reports a non-finite `video.duration`, the code falls
back to `step.duration`. But `step.duration` is **not** the clip length:

- `video-processor-logic.js:215` sets `duration: rec.duration`.
- `answer-pipeline.js:691` writes `duration: ... speechAnalytics?.netDuration || null`.
- `netDuration` is the **net speaking time** (speech minus trailing/pause
  silence, `speech.core.js:97`), so any clip with pauses or a short utterance is
  truncated to its net speech when the duration probe fails.

The non-finite branch is reachable: `forceVideoDuration()`
(`video-processor.web.js:1043-1069`) seeks to `1e7` and gives up after a 2000 ms
timeout; an iPad MediaRecorder WebM blob can still report a non-finite
`video.duration` afterwards. The branch was introduced by commit `1a79e18`
("resolve non-finite clip duration"), whose intent was only to prevent an
infinite freeze — the net-speaking fallback is an unintended truncation.

Fix: when the media duration genuinely cannot be resolved, let the clip play to
its natural `ended` event and terminate on a safe wall-clock cap — never on the
net-speaking duration. Extract the decision rule into
`video-processor-logic.js` so it is unit-testable.

## Out of Scope

- The native renderer (`video-processor.native.jsx`): it advances on
  `currentTime >= trim.end` / `status === 'ended'` and never reads
  `step.duration`, so it is unaffected.
- Improving `forceVideoDuration()` itself (probe strategy / timeout): the fix
  only makes the fallback safe when the probe fails.
- Persisting a real recorded length (e.g. the audio-tap `durationMs` at
  `speech-orchestrator.js:346`) onto the recording. The net-speaking value stays
  in `rec.duration` for scoring; it is simply no longer used as a media length.
- Text-mode hold behaviour and the stall/buffer safety bounds.

## Implementation approach

### Decision rule (pure, extracted)

Add to `src/modules/video/video-processor-logic.js` (platform-agnostic; no
browser globals, matching the existing guard in `video-processor-logic.test.js`):

```js
export const UNRESOLVED_SEGMENT_CAP_MS = 60000;
export const STALL_GRACE_MS = 2000;

export function resolveSegmentBounds({ trimEnd, rawDuration, start = 0 } = {}) {
    const safeStart = Number.isFinite(start) ? start : 0;
    if (trimEnd) {
        return { endTime: trimEnd, wallClockCapMs: Math.max(0, (trimEnd - safeStart) * 1000) };
    }
    if (Number.isFinite(rawDuration)) {
        return { endTime: rawDuration, wallClockCapMs: Math.max(0, (rawDuration - safeStart) * 1000) };
    }
    return { endTime: Infinity, wallClockCapMs: UNRESOLVED_SEGMENT_CAP_MS };
}
```

Rule, in priority order (first match wins):

| Branch | Condition | `endTime` | `wallClockCapMs` | Advance condition |
| --- | --- | --- | --- | --- |
| Explicit trim | truthy `trimEnd` | `trimEnd` | `(trimEnd - start) * 1000` | `endedNaturally \|\| currentTime >= endTime \|\| stalledTimeout` |
| Finite media duration | else `Number.isFinite(rawDuration)` | `rawDuration` (real media length) | `(rawDuration - start) * 1000` | same |
| Unresolved duration | else (`Infinity`/`NaN`/`undefined`) | `Infinity` (no timestamp end) | `UNRESOLVED_SEGMENT_CAP_MS` (60000) | `endedNaturally \|\| stalledTimeout` |

Notes on the table:

- A falsy `trimEnd` (`0`, `NaN`, `null`, `undefined`) falls through to the
  duration branch, exactly matching the original `step.trim?.end || ...`
  semantics. `start` is defaulted to `0` when it is not finite.
- `endTime: Infinity` makes `video.currentTime >= endTime` always false, so the
  unresolved branch can only advance on the natural `ended` event or the
  wall-clock cap. `step.duration` (net speaking) is never consulted.
- `UNRESOLVED_SEGMENT_CAP_MS = 60000` reuses the pre-existing hard cap (`|| 60`
  in the current code) as the safe upper bound. It is a last-resort anti-freeze
  bound, not a target length; `endedNaturally` normally fires first.
- `wallClockCapMs` keeps the current stall semantics: the loop advances when
  `performance.now() - stepPlayStart > wallClockCapMs + STALL_GRACE_MS`.

### Web wiring (`video-processor.web.js`)

Replace the `endTime`/`plannedMs` computation inside the non-text branch
(`video-processor.web.js:665-705`) with `resolveSegmentBounds`, importing it
from `./video-processor-logic.js`:

```js
const { endTime, wallClockCapMs } = resolveSegmentBounds({
    trimEnd: step.trim?.end,
    rawDuration: video.duration,
    start: step.trim?.start || 0,
});
...
const stalledTimeout =
    stepPlayStart && wallClockCapMs > 0 &&
    performance.now() - stepPlayStart > wallClockCapMs + STALL_GRACE_MS;
const endedNaturally = stepStartedPlaying && video.ended;
if (endedNaturally || video.currentTime >= endTime || stalledTimeout) {
    shouldAdvance = true;
}
```

Preserve the surrounding comments (update the `endTime` comment to describe the
new rule), the iPad resume block, and the `endedNaturally` guard comment. The
`step.resolvingDuration` hold branch and the text-mode hold branch
(`step.isTextMode || (step.type === 'webcam' && !step.blob)`,
`TEXT_MODE_DURATION_MS`) are unchanged.

## Tasks

### Task 1 - Extract and unit-test the segment-end decision rule

- `resolveSegmentBounds({ trimEnd: 4, rawDuration: 10, start: 1 })` called
  - → `endTime === 4`
  - → `wallClockCapMs === 3000`
- `resolveSegmentBounds({ trimEnd: 0, rawDuration: 12, start: 0 })` called
  - → `endTime === 12` (a `0` trim end falls through, preserving `step.trim?.end || ...`)
- `resolveSegmentBounds({ rawDuration: 12, start: 2 })` called
  - → `endTime === 12`
  - → `wallClockCapMs === 10000`
- `resolveSegmentBounds({ rawDuration: Infinity })`, `({ rawDuration: NaN })`, and `({ rawDuration: undefined })` each called
  - → `endTime === Infinity`
  - → `wallClockCapMs === UNRESOLVED_SEGMENT_CAP_MS`
- `resolveSegmentBounds({})` called
  - → `endTime === Infinity`
  - → `wallClockCapMs === UNRESOLVED_SEGMENT_CAP_MS`
- `resolveSegmentBounds({ rawDuration: 8, start: NaN })` called (non-finite start)
  - → `start` defaults to 0, `wallClockCapMs === 8000`
- source guard on `video-processor-logic.js`
  - → exports `resolveSegmentBounds`, `UNRESOLVED_SEGMENT_CAP_MS`, `STALL_GRACE_MS`
  - → the function body does not reference `step.duration` or `netDuration`
  - → the existing "references no browser globals" guard still passes

### Task 2 - Wire the rule into the web render loop and guard the regression

- `video-processor.web.js` read as source
  - → imports `resolveSegmentBounds` from `./video-processor-logic.js`
  - → source does **not** match `/Number\.isFinite\(rawDuration\)\s*\?\s*rawDuration\s*:\s*\(step\.duration/` (buggy fallback removed)
  - → source does **not** match `step.duration || 60`
  - → source matches `resolveSegmentBounds(`
  - → source matches `const endedNaturally = stepStartedPlaying && video\.ended`
  - → source matches `stalledTimeout` and `STALL_GRACE_MS`
- text-mode + unresolved-duration paths read as source
  - → source still matches `step\.isTextMode \|\| \(step\.type === 'webcam' && !step\.blob\)`
  - → source still matches `TEXT_MODE_DURATION_MS`
  - → source still matches `step\.resolvingDuration`
  - → source still matches `forceVideoDuration`
- full vitest suite run
  - → `video-processor-logic.test.js` and `video-processor-web-guard.test.js` pass
  - → no other vitest test regresses

## Notes

- **Assumption (cap value).** `UNRESOLVED_SEGMENT_CAP_MS = 60000` is chosen
  because the current code already uses `60` seconds as its hard cap in the
  non-finite branch (`step.duration || 60`). It is a deterministic anti-freeze
  bound for the rare case where `forceVideoDuration()` times out and the blob
  still reports a non-finite duration; in normal playback the natural `ended`
  event advances the segment first. A fixed constant is intentionally used
  because no trustworthy per-clip length is available in that branch. If a
  tighter bound is wanted later, persist the audio-tap `durationMs`
  (`speech-orchestrator.js:346`) as the per-clip fallback — tracked as out of
  scope here.
- `step.duration` is retained for the text-mode hold path only (text mode stores
  `duration: 3`). It must not be used as a media length anywhere else.
- Testing level: the render loop uses a real `<video>` element and canvas, and
  mic/camera cannot be exercised headlessly (`agents.md` §6), so the fix is
  covered by vitest unit tests on the extracted pure rule plus a source-guard
  test on the web wiring — the same convention used by commit `1a79e18`. No new
  Playwright spec is added.
- No new dependencies. Pure React/DOM conventions unchanged (`agents.md` §1);
  the web module already owns the canvas/video drawing.
- Preserve existing comments and `console.log`/`console.warn` statements
  (`agents.md` §2).
- Run `npx vitest run` (or `npm test`) before committing; run the smoke test
  `tests/answer-flow.spec.js` only if imports change beyond the two files above.
