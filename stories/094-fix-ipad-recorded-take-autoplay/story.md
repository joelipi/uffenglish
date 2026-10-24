# Fix the recorded take's frozen first frame on iPad

## Context

On an iPad the learner's own recorded take (`PlaybackVideo`, the clip that plays right
after they stop recording) shows a static first frame while the rest of the step keeps
running — the take is transcribed and the lesson continues, but the picture never moves.
It reproduces on `main` and on every feature branch, and only on iPad (Android and
desktop are fine), so it is not a regression from any one story: it is the playback
*start* path, which was only ever exercised on browsers where `play()` resolves, an
unhandled rejection is visible in a console, and the element loads eagerly.

Three properties of iPadOS Safari break that path:

- An unmuted `play()` is refused (`NotAllowedError`) unless it runs in the same task as
  the gesture. The take's start runs from a media event, so it is *always* refused on
  iPad and depends entirely on the muted fallback — which in turn only works if the
  element carries the `muted` **attribute** (a React `muted={…}` prop is a property
  write only).
- `play()` returns `undefined` on some WebKit builds. `PlaybackVideo` called
  `video.play().catch(...)` directly in its `loadedmetadata` handler, so an undefined
  return threw inside the handler and the start never happened at all.
- The start hung off a single `loadedmetadata` event, and the same handler armed an
  `IntersectionObserver` that pauses a non-intersecting clip — which on iPad can fire
  before the first frame is presented, pausing the take that was just started, with
  nothing to resume it.

## Out of Scope

- The lesson videos (`SimpleVideoPlayer`, `InteractiveVideoPlayer`): they already
  listen for `canplay`, call `load()` once per source, retry, and expose a play button
  when autoplay is refused.
- The audio guard (stories/075) and the Android capture-release ordering: behaviour is
  preserved, not reworked.
- Replacing the post-recording hand-off (capture release, blob creation).
- Anything on the celebration feature (story 093).

## Implementation approach

Decision rules go in a new pure module, `src/modules/video/playback-start-logic.js`,
so `PlaybackVideo` stays a thin adapter (repo rule: no gates in components). The two
element-touching helpers (`playSafely`, `setElementMuted`) take the element they are
handed, exactly like `recoverAudio` in `audio-playback-logic.js`.

Rules:

- **Start ladder** — `PLAYBACK_START_RETRY_DELAYS_MS = [0, 250, 750, 2000]`. Attempt 0
  asks for sound; every later attempt starts muted (`shouldStartMuted`). A refused
  attempt retries only while a delay remains and only for `NotAllowedError`,
  `AbortError` or an unknown error name. The ladder ends on a logged line naming the
  fact that the learner can tap the clip.
- **`playSafely(element)`** — returns `{ promise, error }`; a `play()` that returns
  `undefined` (WebKit) yields `{ promise: null, error: null }` instead of throwing, and
  a synchronous throw yields the error.
- **`setElementMuted(element, muted)`** — sets the property **and** the `muted`
  attribute / `defaultMuted`, because Safari's muted-inline-autoplay allowance reads
  the attribute.
- **`shouldAttemptStart({ paused, hasStarted, autoplay })`** — only while paused, only
  with autoplay, and only before the first successful start (a clip the learner paused
  after it played is theirs).
- **`shouldPauseOffscreen({ isIntersecting, hasStarted })`** — the viewport observer
  may pause only a clip that has already started.
- **`resolveTapAction({ paused, muted })`** — `play` while paused (an iPad with
  autoplay refused leaves it paused, and a tap is the only way out), otherwise `unmute`
  or `mute`.

`PlaybackVideo` then:

- starts from `loadedmetadata`, `canplay` and `loadeddata` (all routed through one
  `handleReady`), nudging `video.load()` once per element+source when `readyState` is 0,
  because iPadOS defers loading and can sit at `HAVE_NOTHING` with no `canplay` coming;
- marks the clip started on the `playing` event and clears pending retries there;
- keeps the story-075 contract: the muted fallback's technical mute is never written to
  `setPlaybackMuted`, and the unmute+re-issue-`play()` after a muted start stays;
- logs every attempt (`[Playback] start attempt N muted=… readyState=…`) and every
  refusal with its error name, so the next iPad field report names the mechanism
  instead of restarting the guessing.

## Tasks

### Task 1 - Pure start rules

- first start on a clip the learner has not muted + any attempt index
  - → `shouldStartMuted` is `false` (ask for sound)
- retry after a refused attempt
  - → `shouldStartMuted` is `true` (Safari allows muted inline playback)
- learner already muted the clip + first attempt
  - → `shouldStartMuted` is `true`
- refused attempt with a delay left + `NotAllowedError` / `AbortError` / no name
  - → `shouldRetryStart` is `true`
- last attempt in the ladder + refused
  - → `shouldRetryStart` is `false`, `retryDelayMs` is `null`
- `play()` returning `undefined`
  - → `playSafely` returns `{ promise: null, error: null }` (no throw)
- `play()` throwing synchronously
  - → `playSafely` returns the error and no promise
- `setElementMuted(el, true)`
  - → `el.muted === true`, the `muted` attribute is present, `defaultMuted === true`
- `setElementMuted(el, false)`
  - → `el.muted === false`, the attribute is gone
- paused / playing-and-muted / playing-and-audible + tap
  - → `resolveTapAction` returns `play` / `unmute` / `mute`
- clip never started + observer reports not intersecting
  - → `shouldPauseOffscreen` is `false`
- clip already started + observer reports not intersecting
  - → `shouldPauseOffscreen` is `true`
- `shouldAttemptStart` with autoplay off, with a playing clip, or after a successful start
  - → `false` in all three

### Task 2 - PlaybackVideo starts the take on iPad

- the take mounts and `canplay` fires without `loadedmetadata`
  - → playback starts (one start path, no dependence on a single event)
- `readyState === 0` on the first attempt
  - → `video.load()` is called once per element+source, and `play()` is still attempted
- unmuted start refused (`NotAllowedError`)
  - → retried muted with the `muted` attribute set, then unmuted and `play()` re-issued
    100 ms after the muted start succeeded
- muted start also refused on the last attempt
  - → a warning names the exhausted ladder and no further timers are scheduled
- technical (fallback) mute
  - → `setPlaybackMuted` is never called with `true` from the start path
- learner taps a paused take
  - → `play()` is issued instead of toggling the sound
- take played once and ended
  - → the silent loop is still recorded as an intent before the replay
- observer reports not intersecting after the take has started
  - → the clip is paused; before it has started it is not

### Task 3 - Guards that can fail

- `PlaybackVideo` source contains a direct `video.play().catch(` call
  - → the wiring guard fails (the WebKit `undefined` crash shape must not come back)
- the observer pause expression is unwrapped from `shouldPauseOffscreen`
  - → the wiring guard fails
- `onCanPlay` or `onLoadedData` is removed from the `<video>` element
  - → the wiring guard fails
- `resolveTapAction` is bypassed in the tap handler
  - → the wiring guard fails
- story-075 guards (audio guard start/stop, intent before mute, intent before replay,
  unmute before the re-issued play)
  - → still pass against the reworked handlers

## Notes

- Not verifiable on a device from this environment: the fix is reasoned from the iPadOS
  Safari autoplay rules and the WebKit `play()` return shape, and covered by unit tests
  plus source guards. The added logging is the field verification: on an iPad the
  console must now show `[Playback] start attempt 0 muted=false …` followed by a
  refusal and a `muted=true` attempt that succeeds.
- No new dependency, no store or config change, no change to `SimpleVideoPlayer`.
