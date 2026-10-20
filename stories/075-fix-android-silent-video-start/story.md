# Fix the Android-only silent start of lesson-video playback

## Context

On **Android Chrome only** a lesson video starts **silent for roughly one to two
seconds**. iOS Safari is unaffected. The field report: *"It might play sound for
a split second, then it mutes for one or two seconds and then continues playing
normally"*, and *"when I scroll back I can play the videos normally from the
beginning without any interruption"*.

Two earlier theories were pursued and both are **disproven** by this story's
investigation:

- **Story 073 (`073-fix-silent-friend-response-playback`)** blamed the mp4
  container ("a non-zero initial audio composition time — an edit list / `ctts`
  offset") and shipped `video.currentTime = 0` before autoplay. That commit was
  **reverted** (`d74a10d` — *"measured it stalls playback ~0.4s and did not fix
  the silence"*).
- **The microphone / audio-context theory.** The mic acquisition was deferred to
  the mic-button press (`062a53a`) and the symptom persisted.

### What the investigation measured (this story)

Every item below was checked against the running app, the real R2 media, and
Chromium's own behaviour — not reasoned about.

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| 1 | The mp4 has an audio offset / edit list | **DEAD** | The real file (`wouldyourather-a-01.mp4`, 1.3 MB) was downloaded from R2 and parsed: `moov` before `mdat` (faststart), **no `edts`/`elst` box on either track**, audio track `timescale=44100`, first sample DTS `0`, no `ctts` on the audio track. Nothing for a decoder to skip. |
| 2 | The app mutes the element | **DEAD for the normal flow** | Instrumented a real-Chrome run of the lesson: the `.ivp-video` element is `muted=false` from `attach` through playback, `play()` **resolves** (never rejected), and `webkitAudioDecodedByteCount` grows from the first frame. The app never touches `muted` on the happy path. |
| 3 | The app's Android `navigator.mediaSession` writes silence the audio | **DEAD** | The app writes `playbackState='none'` + `metadata=null` every 100 ms on Android. Instrumented: **64 of 64 writes were `none -> none`** — i.e. pure no-ops (Chromium's setter early-returns on an unchanged value), so the browser is never even notified. The output RMS was unaffected. |
| 4 | A second `<video>` with the same src steals the audio | **DEAD** | The app really does mount a muted `intro-video` **and** a muted `continue-video-preview` for the same URL. Measured with a `MediaElementSource -> Analyser` RMS probe: the unmuted element's output is unaffected by a muted twin. |
| 5 | Chromium's own media audio focus mutes | **DEAD** | Per Chromium's `docs/media/audio_focus.md`, a focus loss moves the `MediaSession` to `SUSPENDED`, where *"all audio-producing objects are **paused**"*. It pauses; it does not mute. A muted-but-moving video cannot be a focus suspension. |
| 6 | `muted -> unmuted` recovery is slow | **DEAD on desktop** | RMS-probed the exact fallback the app uses (play muted, `muted = false` 100 ms later): audio returns within ~150-500 ms, with no multi-second gap. |
| 7 | The media files are broken | **DEAD** | Same as #1 — the container is clean and the bytes are intact. |

### What the investigation *did* find

Three real defects sit on the critical path of "a lesson video starts playing",
and one of them matches the field report's shape exactly.

**F1 — The autoplay effect runs twice, so the media is loaded twice.**
`SimpleVideoPlayer`'s autoplay effect depends on `pendingVideoPlayType`, and the
effect *itself* clears that flag (`setPendingVideoPlayType(null)`). Clearing it
re-runs the effect, so `attemptAutoplay()` — and therefore `video.load()` —
runs a second time. The second `load()` **aborts the first resource selection**
and restarts the media pipeline. Observed in the app's own log:

```
[SimpleVideo] autoplay effect running. ... pendingVideoPlayType: simple
[SimpleVideo] attemptAutoplay. readyState: 0
[SimpleVideo] autoplay effect running. ... pendingVideoPlayType: null
[SimpleVideo] attemptAutoplay. readyState: 0
```

`InteractiveVideoPlayer` has the identical dependency/clear pair.

**F2 — The camera/microphone capture is left open across a step boundary.**
`setWebcamStream(null)` only clears the **store** reference; the module-level
`speechCamStream` keeps its live tracks. `stopSpeechCamRecording`'s
never-started branch (`shouldForceReleaseComposite({ isAndroid, keepStreamAlive:
true, recordingStarted: false })` → `false`) deliberately keeps the capture
alive on Android, and the next step only calls `setWebcamStream(null)`.
**On Android an open capture holds the device in a communication audio mode,
which mutes media playback while it is open** — an Android-only mechanism that
matches "only on Android" and explains why the *deferral* fix did not help: the
deferral moved the *acquisition*, not the *release*.

**F3 — The muted→unmuted fallback is a bare flag flip.**
`video.muted = true; video.play().then(() => setTimeout(() => { video.muted =
false; }, 100))` assumes the flag flip alone restores the audio output. It does
not re-assert playback, and nothing ever verifies the element ended up audible.
If any path leaves the element muted (the browser's own autoplay handling, the
fallback itself, a re-mount), the video stays silent for the rest of the clip
with **no recovery and no trace**.

### The remaining, and now instrumented, question

The symptom is *output-level* (the element keeps moving, the audio is gone), so
whatever silences it is not visible in `muted`/`volume` on desktop Chrome. The
one thing the app can do about a silent start is **detect it and repair it**,
and — just as important — **leave a trace that names the mechanism** so the next
field report is a diagnosis rather than another round of theories.

## Out of Scope

- Re-encoding or re-uploading any media. The container is clean (finding #1).
- The recap renderer (`video-processor.web.js`) and the after-video tail
  (`after-video-player.web.js`) — they own their audio through WebAudio
  already and are not part of the lesson-video path.
- The `PlaybackVideo` component (the recorded-take playback), which has its own
  explicit mute UI and is not a lesson video.
- iOS behaviour. Nothing here may regress the iOS autoplay path, which is the
  one that currently works.

## Implementation approach

### 1. A pure rule module — `src/modules/video/audio-playback-logic.js`

No React, no DOM, no browser globals; vitest imports it directly.

- `isAudible(element)` — an element is audible only when it is **not muted**
  **and** its volume is **> 0**.
- `shouldRepairAudio({ playing, expectedAudible, audible, elapsedMs, windowMs })`
  — the guard repairs only while the element is *playing*, is *supposed to be
  audible*, is *not audible*, and is still inside the guard window.
- `recoverAudio(element, play)` — the one statement that touches a browser
  object, isolated behind fakes: clears `muted`, restores `volume` to 1,
  re-issues `play()` (a fresh `play()` is what makes the browser re-open the
  audio output), and returns whether the element is audible afterwards.
- `AUDIO_GUARD_INTERVAL_MS` (200) and `AUDIO_GUARD_WINDOW_MS` (5000).

### 2. A browser adapter — `src/modules/video/audio-guard.js`

`createAudioGuard({ getElement, isExpectedAudible, play, log })` → `{ start, stop }`.
It samples the element every 200 ms for 5 s after playback starts, repairs a
muted element via `recoverAudio`, and **logs the audio state** so the next field
report is decisive:

- `[AudioGuard] muted during playback at 300ms` — the smoking gun: the element
  was muted.
- `[AudioGuard] repaired muted audio at 300ms` — the app fixed it.
- `[AudioGuard] audio state at 5000ms muted=false volume=1 audioBytes=…` — the
  summary line that separates "the element was muted" from "the data never
  arrived".

### 3. Wiring in the two lesson players

`SimpleVideoPlayer.web.jsx` and `InteractiveVideoPlayer.web.jsx` create the
guard on mount, `start()` it on `play`, and `stop()` it on `pause`/`ended`.
The guard is the single recovery mechanism; the players no longer rely on the
bare `muted = false` flip (F3) — the fallback still unmutes, and the guard
verifies and repairs if the element is still muted 200 ms later.

### 4. The double load (F1)

`video.load()` is called **once per element + source**. The autoplay effect
re-runs when it clears `pendingVideoPlayType` — that re-run is the iOS
transient-activation retry and must stay — but the *second* `load()` is what
aborts the first resource selection and restarts the media pipeline. The fix
keeps the effect's dependency array untouched and guards the `load()` call
instead:

```js
const loadKey = video.src;
if (loadedElementRef.current?.element !== video || loadedElementRef.current?.key !== loadKey) {
    loadedElementRef.current = { element: video, key: loadKey };
    video.load();
}
```

A new element (or a new source) still loads exactly as before; only the
duplicate `load()` on the *same* element and source is suppressed.

### 5. Release the capture on a step boundary (F2)

- `speech.web.js` exports `releaseSpeechCamStream()` — `setWebcamStream(null)`
  **plus** `safelyStopStream()`, so the tracks are actually stopped.
- `step-executor-webonly.js` takes a new `releaseSpeechCam` dependency and
  calls it on the non-response-step branch (the branch that currently only
  calls `setWebcamStream(null)`). The module stays platform-agnostic and
  testable — the capture release is injected, exactly like `enableAudioSystem`.
- `step-loader.web.js` wires `releaseSpeechCam: () => Speech.releaseSpeechCamStream()`.

The release happens at the **step boundary**, not mid-flow, so story 072's
"never-started abort" exemption (which exists to avoid a mid-flow teardown and
rebuild) is preserved.

## Tasks

### Task 1 — Pure rule module + unit tests

Create `src/modules/video/audio-playback-logic.js` and
`src/modules/video/audio-playback-logic.test.js`.

- `isAudible(null)` → `false`; `isAudible({ muted: true, volume: 1 })` → `false`;
  `isAudible({ muted: false, volume: 0 })` → `false`;
  `isAudible({ muted: false, volume: 1 })` → `true`;
  `isAudible({ muted: false, volume: 0.5 })` → `true`.
- `shouldRepairAudio` → `true` only when *playing* **and** *expectedAudible* **and**
  *not audible* **and** `0 <= elapsedMs <= windowMs`.
  - not playing → `false`; not expected audible → `false`; already audible → `false`;
    `elapsedMs > windowMs` → `false`; negative `elapsedMs` → `false`.
- `recoverAudio(fakeElement, fakePlay)`:
  - clears `muted`, sets `volume` to 1, calls `play()`, returns `true`.
  - a `play()` that throws does not propagate and still returns `true`.
  - `recoverAudio(null)` → `false` and does not throw.
  - a fake element whose `muted` setter throws → returns `false`.
- importing the module references no browser global (`window`, `document`,
  `navigator` absent from the **raw** source — no comment stripping).

### Task 2 — Audio guard adapter + unit tests

Create `src/modules/video/audio-guard.js` and `src/modules/video/audio-guard.test.js`.

- `createAudioGuard(...).start()` samples on the guard interval; `.stop()` stops
  sampling.
- While the element is playing and audible → **no** repair and **no** error log.
- While the element is playing and **muted** → `recoverAudio` runs, a repair is
  logged, and the element ends up audible.
- While the element is paused → **no** repair.
- The window closes after `AUDIO_GUARD_WINDOW_MS` → **no** repair after it.
- A summary line is logged when the window closes.

### Task 3 — Player wiring + source guards

- `SimpleVideoPlayer.web.jsx` and `InteractiveVideoPlayer.web.jsx`:
  - the guard is created on mount and `start()`ed on play / `stop()`ed on pause
    and on ended;
  - the muted fallback still unmutes the element **and re-issues `play()`**
    after the unmute (a bare flag flip does not re-open the audio output);
  - `video.load()` is called at most once per element+source — the guard check
    sits **before** the `load()` call in `attemptAutoplay`;
  - the autoplay effect's dependency array is **unchanged** (the iOS
    transient-activation retry depends on it).
- Source guards (raw source, no comment stripping) assert each of the above.
- Every guard is proven able to fail by temporarily injecting the defect it
  forbids (dropping the `start()` call, removing the `load()` guard, removing
  the re-issued `play()`, replacing the capture release with the store-only
  clear) and confirming that exactly the intended guard goes red.

### Task 4 — Capture release on a step boundary

- `speech.web.js` exports `releaseSpeechCamStream()` and it stops the tracks
  (`safelyStopStream`).
- `step-executor-webonly.js` calls the injected `releaseSpeechCam` on the
  non-response-step branch instead of `setWebcamStream(null)`.
- `step-loader.web.js` wires `releaseSpeechCam`.
- Unit tests for the injected-dependency behaviour.

### Task 5 — Playwright regression guard

- A spec drives a lesson to the `SimpleVideoPlayer`, forces
  `video.muted = true` while it plays, and asserts the app **restores audibility
  on its own** within the guard window.
- The same for `volume = 0`.
- The spec must fail on the pre-fix code (the element stays muted) — proven by
  temporarily removing the `start()` call.
- The sentinel WebM is looped: it is ~1 s long, so without `loop` the clip ends
  (and disarms the guard) before the assertions run.
- The spec must not be in `playwright.config.js`'s `testIgnore` list
  (`e2e-smoke`, `recording-persistence`, `success-screen`, `whisper-review`).

### Task 6 — Record the diagnosis

- `docs/learnings.md` gains an entry: what was ruled out (the container
  offset, the mic at step load, the `mediaSession` writes, Chromium's focus
  arbitration, the muted twin element) and how it was ruled out (atom-level mp4
  parse, setter instrumentation, an `Analyser` RMS probe), plus the rule that a
  silent-but-moving video is an **output-level** symptom.
- `src/modules/video/recorder-page.test.js`'s per-story allowlist gains this
  story's paths (the repo's convention for every story that touches
  `src/**`).

## Technical Context

- `vitest ^4.1.6` — `environment: 'jsdom'`, `globals: true`. The pure module
  imports directly; the guard takes its element through a getter so a plain
  object is enough in tests.
- `@playwright/test ^1.60.0` — the new spec must not be in
  `playwright.config.js`'s `testIgnore` list (`e2e-smoke`,
  `recording-persistence`, `success-screen`, `whisper-review`). It drives the
  **sentinel WebM** (not the R2 mp4), so the bundled Chromium — which lacks
  H.264 — can decode it; the guard works on the element's mute state, so the
  clip needs no audio track.

## Notes

- **The diagnosis is a narrowing, not a single proven cause.** The symptom is
  output-level and only reproducible on an Android device, so the fix is built
  to *repair* the observable failure and to *instrument* the unobservable one.
  The guard turns "the video was silent" into "the element was muted" (and
  fixes it in ~200 ms) or "the element was never muted" (a browser/OS audio
  path, which the summary log then makes unambiguous).
- **Do not "fix" this by muting less loudly.** The guard only ever restores
  audibility; it never mutes.
- **The guard must not fight a user who muted the clip on purpose.** The lesson
  players have no mute control, but `isExpectedAudible` is injected so the
  guard stays correct if one is added.
- **Story 072's release rule is load-bearing** (`docs/learnings.md:158` — the
  9:16 composite OOM'd Android while Whisper was resident). The capture is
  released at the **step boundary**, never mid-flow, so the mid-flow teardown
  that story avoided never happens.
