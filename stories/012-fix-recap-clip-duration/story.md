# Fix recap user-clip truncation by reading the real clip duration

## Context

In the concatenated end-of-lesson recap, a user-recorded segment can be cut down
to well under its real length (a friend-lesson report saw the 2nd of 3 clips
present for "less than a second"). The user's own webcam segments advance on
`video.currentTime >= endTime` in the render loop (`src/modules/video/video-processor.web.js`).

`endTime` is computed in the draw loop from, in order: the explicit trim, the
`<video>` element's `video.duration`, or a probed container duration:

```js
const endTime = step.trim?.end
    || (Number.isFinite(rawDuration) ? rawDuration : (step.duration || 60));
```

`rawDuration` is `video.duration` — the clip's real media length. When a
MediaRecorder WebM blob reports a non-finite `video.duration`, the previous code
fell back to `step.duration`. But `step.duration` is **not** the clip length:

- `video-processor-logic.js` sets `duration: rec.duration`.
- `answer-pipeline.js` writes `duration: ... speechAnalytics?.netDuration || null`.
- `netDuration` is the **net speaking time** (speech minus trailing/pause
  silence, `speech.core.js`), so any clip with pauses or a short utterance is
  truncated to its net speech when the duration probe fails.

A 60 s hard cap (the `|| 60` fallback) is also not acceptable: it turns an
unresolved duration into a ~62 s hang, i.e. an effectively failed recap. The
real fix is to **resolve the clip's actual duration** rather than bound the
unknown.

`mediabunny` is already a project dependency (used by
`src/modules/video/transcode.web.js`; installed version 1.50.8, `package.json`
`^1.50.8`) and can read the container duration directly — no decoding, works in all browsers, and
independent of the `<video>` element's lazy/absent `duration`. Use it as the
fallback. Extract the advance decision into `video-processor-logic.js` so it is
unit-testable.

The container probe must be the reliable last word on a clip's length. An
earlier revision raced it against a fixed 2000 ms bound and resolved `null`
when the timeout won, which sent the draw loop down the unresolved branch
(`endTime: Infinity`, `UNRESOLVED_SEGMENT_CAP_MS = 15000`). A valid clip longer
than 15 s whose container read exceeds 2 s (large blob / slow device) is then
truncated at 15 s+grace — the exact bug this story removes, just moved into the
probe. Mediabunny documents `Input.computeDuration()` as "potentially
expensive… must check all tracks" and offers the cheaper
`Input.getDurationFromMetadata()`. The probe must use the cheap path first and
must not silently downgrade a slow-but-successful read.

## Out of Scope

- The native renderer (`video-processor.native.jsx`): it advances on
  `currentTime >= trim.end` / `status === 'ended'` and never reads
  `step.duration`, so it is unaffected.
- Changing `forceVideoDuration()` (the element seek probe): it still runs first
  for its seekability/rewind side effects; mediabunny is only consulted if it
  leaves `video.duration` non-finite.
- Persisting a capture-time recording length (the audio-tap `durationMs` at
  `speech-orchestrator.js`) onto the recording. Not needed once the container
  can be read; noted as a possible belt-and-suspenders follow-up.
- The net-speaking `rec.duration` value itself: it stays in the record for
  scoring; it is simply no longer used as a media length.
- Text-mode hold behaviour and the existing stall/buffer safety bounds.
- Reworking the three-branch shape of `resolveSegmentBounds` into a single
  expression: the explicit branches mirror the documented priority order.

## Implementation approach

### Step 1 - Read the true duration from the container (`transcode.web.js`)

Add `probeClipDurationSec(blob)` to `src/modules/video/transcode.web.js`
(web-only; mediabunny is already imported there). Extend the existing mediabunny
import with `BlobSource` (`Input` and `ALL_FORMATS` are already imported):

```js
export async function probeClipDurationSec(blob) {
    if (!blob) return null;
    let input = null;
    try {
        input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
        // Cheap path first: the duration stored in the container header
        // (WebM Segment Info / MP4 mvhd), no packet scan. Usually a few ms.
        const fromMetadata = await input.getDurationFromMetadata(undefined, { skipLiveWait: true });
        if (Number.isFinite(fromMetadata) && fromMetadata > 0) return fromMetadata;
        // Accurate path: scan to the last packet. Bounded because the source is
        // a finite, in-memory Blob and `skipLiveWait` avoids waiting for a live
        // stream that has already ended. skipLiveWait also prevents a
        // MediaRecorder blob flagged as "live" from blocking forever.
        const duration = await input.computeDuration(undefined, { skipLiveWait: true });
        return Number.isFinite(duration) && duration > 0 ? duration : null;
    } catch (e) {
        console.warn('[Transcode] probeClipDurationSec failed:', e?.message || e);
        return null;
    } finally {
        input?.dispose();
    }
}
```

Add a matching stub to `src/modules/video/transcode.native.jsx` so the symbol
stays resolvable on native (the module is web-only in practice; callers import
it via `./transcode.js`):

```js
export async function probeClipDurationSec() {
    return null;
}
```

`./transcode.js` re-exports `./transcode.web.js`, and `vite.config.js` resolves
`.web.js` first (`resolve.extensions`), so `video-processor.web.js` gets the
real implementation.

`getDurationFromMetadata()` may return `0` for a container whose header has no
usable duration and `null` when it cannot be determined at all; both fall
through to `computeDuration()`. `computeDuration()` may return `0` when no
decodable track exists; that too resolves to `null` (unreadable).

### Step 2 - Pure advance decision (`video-processor-logic.js`)

Add to `src/modules/video/video-processor-logic.js` (platform-agnostic; no
browser globals, matching the existing guard in `video-processor-logic.test.js`):

```js
export const UNRESOLVED_SEGMENT_CAP_MS = 15000;
export const STALL_GRACE_MS = 2000;

export function resolveSegmentBounds({ trimEnd, rawDuration, fallbackDurationSec, start = 0 } = {}) {
    const safeStart = Number.isFinite(start) ? start : 0;
    if (trimEnd) {
        return { endTime: trimEnd, wallClockCapMs: Math.max(0, (trimEnd - safeStart) * 1000) };
    }
    if (Number.isFinite(rawDuration)) {
        return { endTime: rawDuration, wallClockCapMs: Math.max(0, (rawDuration - safeStart) * 1000) };
    }
    if (Number.isFinite(fallbackDurationSec) && fallbackDurationSec > 0) {
        return { endTime: fallbackDurationSec, wallClockCapMs: Math.max(0, (fallbackDurationSec - safeStart) * 1000) };
    }
    return { endTime: Infinity, wallClockCapMs: UNRESOLVED_SEGMENT_CAP_MS };
}
```

Rule, in priority order (first match wins):

| Branch | Condition | `endTime` | `wallClockCapMs` | Advance condition |
| --- | --- | --- | --- | --- |
| Explicit trim | truthy `trimEnd` | `trimEnd` | `(trimEnd - start) * 1000` | `endedNaturally \|\| currentTime >= endTime \|\| stalledTimeout` |
| Finite media duration | else `Number.isFinite(rawDuration)` | `rawDuration` (real media length) | `(rawDuration - start) * 1000` | same |
| Probed container duration | else finite `fallbackDurationSec` | `fallbackDurationSec` (real media length) | `(fallbackDurationSec - start) * 1000` | same |
| Unresolved (last resort) | else | `Infinity` (no timestamp end) | `UNRESOLVED_SEGMENT_CAP_MS` (15000) | `endedNaturally \|\| stalledTimeout` |

Notes on the table:

- A falsy `trimEnd` (`0`, `NaN`, `null`, `undefined`) falls through, exactly
  matching the original `step.trim?.end || ...` semantics. `start` is defaulted
  to `0` when it is not finite.
- `endTime: Infinity` makes `video.currentTime >= endTime` always false, so the
  unresolved branch can only advance on the natural `ended` event or the
  wall-clock cap. `step.duration` (net speaking) is never consulted.
- The last-resort cap (15000 ms) is only reachable when **both** the element and
  the container reader cannot report a length at all (a corrupt/unreadable
  blob). A valid MediaRecorder blob is read by `computeDuration`, so the cap is
  not reachable for valid recordings; the cap value is intentionally adjustable.

### Step 3 - Wire it into the render loop (`video-processor.web.js`)

In `onloadedmetadata`, after `forceVideoDuration` and the rewind, if
`video.duration` is still non-finite, probe the blob **and await it directly**
— no `Promise.race`, no timeout branch that resolves `null`:

```js
if (!Number.isFinite(video.duration)) {
    step.mediaDurationSec = await probeClipDurationSec(step.blob || step.remoteBlob);
    console.log('[VideoProcessor] Probed clip duration:', step.mediaDurationSec, 'step', stepIndex);
}
```

The `step.resolvingDuration` hold (set before `forceVideoDuration`, cleared after
the probe) already keeps the draw loop on this frame, so awaiting the probe
cannot advance the segment early. The probe always settles: the source is a
finite in-memory `Blob`, `skipLiveWait` avoids the only documented blocking case
(live streams), and `probeClipDurationSec` catches its own errors. Removing the
short race is what guarantees a valid clip is never truncated by a slow read.

Import `probeClipDurationSec` from `./transcode.js` alongside the existing
transcode imports. Reset the probed value with the other per-step playback
health fields so a stale probe can never leak across steps:

```js
step.resumeAttempted = false;
stepStartedPlaying = false;
stepPlayStart = 0;
step.loadFailed = false;
step.playFatal = false;
step.mediaDurationSec = undefined;
```

In the draw loop, resolve the segment's end with `resolveSegmentBounds`,
importing it from `./video-processor-logic.js`:

```js
const { endTime, wallClockCapMs } = resolveSegmentBounds({
    trimEnd: step.trim?.end,
    rawDuration: video.duration,
    fallbackDurationSec: step.mediaDurationSec,
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
`TEXT_MODE_DURATION_MS`) are unchanged. `probeClipDurationSec` only reads
`step.blob || step.remoteBlob`; it must not null any shared plan field.

## Tasks

### Task 1 - Add and test the container duration probe

- `probeClipDurationSec` added to `transcode.web.js` + `transcode.native.jsx`
  - → `transcode.web.js` imports `BlobSource` from `mediabunny`, wraps the blob in `new BlobSource(blob)`, and calls `input.getDurationFromMetadata(undefined, { skipLiveWait: true })` before `input.computeDuration(undefined, { skipLiveWait: true })` (source guard: `indexOf('getDurationFromMetadata') < indexOf('computeDuration')`)
  - → `transcode.web.js` disposes the `Input` (`input.dispose()` in a `finally`)
  - → `transcode.native.jsx` exports `probeClipDurationSec` returning `null`
- `probeClipDurationSec(null)` and `probeClipDurationSec(undefined)` called
  - → resolve to `null`
- `probeClipDurationSec(new Blob([new Uint8Array([0, 1, 2, 3])]))` called (malformed container)
  - → resolves to `null` (rejects internally, does not throw)

### Task 2 - Extract and unit-test the segment-end decision rule

- `resolveSegmentBounds({ trimEnd: 4, rawDuration: 10, start: 1 })` called
  - → `endTime === 4`
  - → `wallClockCapMs === 3000`
- `resolveSegmentBounds({ trimEnd: 0, rawDuration: 12, start: 0 })` called
  - → `endTime === 12` (a `0` trim end falls through, preserving `step.trim?.end || ...`)
- `resolveSegmentBounds({ rawDuration: 12, start: 2 })` called
  - → `endTime === 12`
  - → `wallClockCapMs === 10000`
- `resolveSegmentBounds({ rawDuration: Infinity, fallbackDurationSec: 8 })` called
  - → `endTime === 8` (real container duration)
  - → `wallClockCapMs === 8000`
- `resolveSegmentBounds({ rawDuration: Infinity, fallbackDurationSec: 8, start: 3 })` called
  - → `endTime === 8`
  - → `wallClockCapMs === 5000`
- `resolveSegmentBounds({ rawDuration: NaN, fallbackDurationSec: null })` and `({ rawDuration: undefined })` called
  - → `endTime === Infinity`
  - → `wallClockCapMs === UNRESOLVED_SEGMENT_CAP_MS`
- `resolveSegmentBounds({ rawDuration: Infinity, fallbackDurationSec: 0 })` called
  - → `endTime === Infinity` (a non-positive probe result is ignored)
- `resolveSegmentBounds({ rawDuration: 8, start: NaN })` called (non-finite start)
  - → `start` defaults to 0, `wallClockCapMs === 8000`
- source guard on `video-processor-logic.js`
  - → exports `resolveSegmentBounds`, `UNRESOLVED_SEGMENT_CAP_MS`, `STALL_GRACE_MS`
  - → the function body does not reference `step.duration` or `netDuration`
  - → the existing "references no browser globals" guard still passes

### Task 3 - Wire the probe and rule into the web render loop

- `video-processor.web.js` read as source
  - → imports `probeClipDurationSec` from `./transcode.js`
  - → imports `resolveSegmentBounds` from `./video-processor-logic.js`
  - → source matches `fallbackDurationSec: step\.mediaDurationSec`
  - → source matches `await probeClipDurationSec\(step\.blob \|\| step\.remoteBlob\)`
  - → source does **not** wrap the probe in `Promise.race` (does not match `/Promise\.race\(\[\s*probeClipDurationSec/`)
  - → source does **not** match `/Number\.isFinite\(rawDuration\)\s*\?\s*rawDuration\s*:\s*\(step\.duration/` (buggy fallback removed)
  - → source does **not** match `step.duration || 60`
  - → source resets `step.mediaDurationSec = undefined` alongside `step.playFatal = false` and `step.loadFailed = false`
  - → source matches `const endedNaturally = stepStartedPlaying && video\.ended`
  - → source matches `stalledTimeout` and `STALL_GRACE_MS`
- text-mode + unresolved-duration paths read as source
  - → source still matches `step\.isTextMode \|\| \(step\.type === 'webcam' && !step\.blob\)`
  - → source still matches `TEXT_MODE_DURATION_MS`
  - → source still matches `step\.resolvingDuration`
  - → source still matches `forceVideoDuration`
- existing `video-processor-web-guard.test.js` non-finite-duration test updated
  - → its `Number\.isFinite\(rawDuration\)` assertion is replaced with `probeClipDurationSec` / `step\.mediaDurationSec` / `resolveSegmentBounds` (the literal `Number.isFinite(rawDuration)` no longer exists in the web module once the rule moves to `video-processor-logic.js`)
  - → the rewound / `endedNaturally` guard assertions remain
- full vitest suite run
  - → `video-processor-logic.test.js`, `video-processor-web-guard.test.js`, and the new `transcode` probe test pass
  - → no other vitest test regresses

## Notes

- **Assumption (last-resort cap).** `UNRESOLVED_SEGMENT_CAP_MS = 15000` applies
  only when both `video.duration` and the mediabunny container probe cannot
  report a length at all (corrupt/unreadable blob). Once the probe is awaited
  rather than raced to `null`, that is unreachable for a valid MediaRecorder
  recording; the cap is a short anti-freeze bound rather than the previous 60 s
  hang. It is a documented constant, easy to change. If a measurement-based
  residual is preferred, persist the audio-tap `durationMs`
  (`speech-orchestrator.js`) on the record and pass it as a second fallback —
  tracked as out of scope.
- **Why metadata-first.** Mediabunny's own `conversion.js:590` resolves a clip's
  length as `(await track.getDurationFromMetadata()) ?? (await track.computeDuration())`,
  and the API docs call `computeDuration()` "potentially expensive… must check
  all tracks" while `getDurationFromMetadata()` reads the container header
  (WebM Segment Info / MP4 `mvhd`) without a packet scan. Following the
  library's own pattern keeps the probe fast whenever the header carries a
  duration. Most blobs that reach this probe (a non-finite `video.duration`)
  have no header duration, so `computeDuration()` still runs; that is bounded
  by the finite Blob (below). For the WebM/MP4 containers this path handles the
  stored header duration is exact; `getDurationFromMetadata()` is only used
  when it yields a positive finite value, otherwise the precise
  `computeDuration()` is authoritative. If a future format reports only an
  approximate header duration, drop the metadata shortcut for that format
  rather than risk an early `endTime`.
- **Why no probe timeout.** A watchdog that resolves `null` on expiry is exactly
  the failure this story fixes: it converts a slow-but-valid read into the 15 s
  truncation. The probe cannot block indefinitely because the source is a
  finite `Blob` and `skipLiveWait` avoids waiting on a live stream; errors are
  caught and return `null`, which routes to the documented anti-freeze cap.
- **Dependency.** No new dependency: `mediabunny` (installed 1.50.8) is already used by
  `transcode.web.js`, and `video-processor.web.js` already imports
  `./transcode.js`, so there is no bundle-size change.
- **Why not just rely on `video.ended`.** For a MediaRecorder blob whose
  `duration` stays non-finite, the element can treat the stream as endless and
  never fire `ended` (the freeze that a prior commit addressed);
  `computeDuration` reads the container instead, so the segment ends at its real
  length and the cap is effectively unreachable.
- `step.duration` is retained for the text-mode hold path only (text mode stores
  `duration: 3`). It must not be used as a media length anywhere else.
- Testing level: the render loop uses a real `<video>` element and canvas, and
  mic/camera cannot be exercised headlessly (`agents.md` §6), so coverage is
  vitest unit tests on the pure rule, a unit test on the probe's failure/guard
  paths, and source guards on the web wiring — the same convention used by the
  prior non-finite-duration fix. No new Playwright spec is added.
- Preserve existing comments and `console.log`/`console.warn` statements
  (`agents.md` §2). New success/failure logs are added around the probe.
- Run `npx vitest run` (or `npm test`) before committing.
