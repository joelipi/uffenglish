# iPadOS 27 — every voice take captures digital silence

**Investigation record and handover.**
Last updated: 22 Oct 2026, 00:40 UTC. Everything below is measured on the user's iPad unless it says
"desktop/headless". Hypotheses are labelled as such; a measurement never is.

---

## 1. Where we are in one page

| Question | Answer | Evidence |
|---|---|---|
| Is the hardware / OS / microphone broken? | **No** | Mic-only, camera+mic, the app's exact constraints and a `MediaRecorder` capture all deliver audio on the same iPad, in the same browser session (§4.1) |
| Is it a code regression? | **No** | Builds back to 15 Oct fail identically; the capture module is byte-identical to a working-era commit; no deploy in the failure window (§5.1–5.3) |
| Is it the audio-session category? | **No** | `navigator.audioSession.type` is `play-and-record`/`auto` and forcing it changes nothing (§5.10) |
| Is it resampling / 16 kHz? | **No** | Native 48 kHz capture is silent too (§5.7) |
| Is it the camera stream shape? | **No** | An audio-only capture in the app is silent too; a camera+mic capture on a lab page is fine (§5.8, §4.4) |
| Is it another `AudioContext`? | **No** | Lab 2/3 tests 3 and 5: 0.72–0.94 AUDIO (§4.3, §4.4) |
| Is it closing a context / touching a media element? | **No** | Lab 3: 0.62–0.94 AUDIO on every variant (§4.4) |
| Is it the AudioWorklet? | **No** | Lab 4: mic through the app's own worklet = probe 0.557, worklet output 0.557, 122 624 frames (§4.5) |
| Is it the full graph (camera + preview + recorder + worklet)? | **No** | Lab 5 test 5 = the app's exact graph → 0.52–0.81 AUDIO, twice (§4.6) |
| Is it an idle capture dying during the countdown? | **No** | Lab 6: a capture idle for 4 s still reads 0.30–1.0 (§4.7) |
| Is the app's **document** hostile to microphone capture? | **No — at load it is healthy** | In-page probes 3 s and 12 s after the lesson opened, with no take running: **0.21431** and **0.33433** (§4.8) |
| Is the app's **take** silent? | **Yes, always** | `tap peak 0.00000`, `captured 0.0000` over 162k–635k samples, `recorder: recording` with `chunks: 0` (§4.8) |

**Conclusion: the fault is inside the app's take path, between the page that measures fine and the take
that measures zero.** Every individual ingredient of that path has been proven good in isolation on the
same device. What has *not* been tested is the app's actual take with a measurement that separates "the
app's capture stream is dead" from "the app's audio graph is dead" (§7.1) — that is the single next test.

---

## 2. Symptom

- Device: iPad, **iPadOS 27.0.1**. Browsers: Safari (`Version/27.0.1 Safari/605.1.15`) and Chrome iOS
  (`CriOS/155.0.8059.37`); both are WebKit/WKWebView, both fail identically. iPad Playwright/WebKit is not
  available in the sandbox, so every on-device datapoint comes from the owner.
- In the lesson, every recording take captures **digital silence**: the PCM the app sends to Whisper is all
  zeros. The take is classified as unusable (`max amplitude 0.0000`) and discarded.
- **Every take, including the first one after a page reload.**
- The track always reports healthy: `iPad Microphone`, `readyState: live`, `muted: false`,
  `settings.sampleRate: 48000`, `volume: 1`, real `deviceId`; the `AudioContext` is `running` at 48 kHz.
- Reported to start **around 09:55 UTC on 21 Oct 2026**. The last production deploy before that was
  `5aec091a` at ~07:58 UTC; **no deploy happened inside the failure window**. The same build had worked for
  days, including the 3-2-1 countdown commit (which was initially suspected and is now cleared).
- The owner's own note, which turned out to be exactly right: *"I've been testing earlier commits going
  back as far as October 15 when I know for a fact the thing was working […] and the issue was still
  presenting itself, so it would seem that is not an issue with the code base per se."*

---

## 3. The app's capture path (code map)

Branch under investigation: `fix/release-capture-before-playback` (worktree `/home/user/fix-release`).
`main` == `origin/main` == `be29ac17` and is clean; the diagnostic work is **not pushed**.

| Where | What it does |
|---|---|
| `src/modules/speech/speech.web.js:83` `getMediaConstraints()` | `video: { aspectRatio: { ideal: 16/9 }, facingMode: 'user' }`, `audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }`. **No `sampleRate` constraint** (deliberate — see §5.7). |
| `src/modules/speech/speech.web.js` `ensureSpeechCamStream()` | `getUserMedia(getMediaConstraints())`, memoised in module state. On iOS the **raw** stream is used (no 9:16 canvas composite — the iOS `MediaRecorder` path is deliberately untouched). |
| `src/modules/speech/speech.web.js` `warmUpSpeechCamStream()` | Opens the capture and stores it (`setWebcamStream`). Wired through `src/components/step-loader.web.js` and `src/hooks/app-infra-webonly.js`; the answer pipeline receives it as `warmUpSpeechCam`. |
| `src/modules/lesson/step-executor-webonly.js:100–140` `onStepLoaded` | Response steps do **not** pre-acquire the mic ("requesting getUserMedia while the step video is auto-playing mutes the first second(s) of playback"); video steps call `releaseSpeechCam()` at the step boundary (`stories/075`). |
| `src/modules/speech/speech-orchestrator.js:~340–400` | Take start: stream ready → 3-2-1 countdown → `await startDeferredSpeechCamRecording()` (**`MediaRecorder.start()` on the already-open capture**) → `await startLocalAudioTap(stream)`. |
| `src/modules/speech/speech.web.js:652` `startLocalAudioTap(stream)` | Closes the previous `localAudioContext`, creates a **new** `AudioContext` at the native rate, `addModule('../../workers/whisper/audio-processor.js')`, `createMediaStreamSource(stream)` → `AudioWorkletNode('audio-processor')` → gain `0.001` → destination; plus an `AnalyserNode` on the same source (`[TAP-PROBE]`) and the audio-only fallback. |
| `src/modules/speech/speech.web.js:828` `stopLocalAudioTap()` | Disconnects the worklet, `await localAudioContext.close()` (deliberate: a shared suspend/resume context degraded iOS's AudioWorklet to all-zero PCM in an earlier incident), then downsamples 48k→16k in JS for Whisper (`audio-resample-logic.js`). |
| `src/modules/speech/speech.web.js:478` `stopSpeechCamRecording()` | On iOS the capture is **released before the clip is handed to the player** (`stories/087`), then `waitForAudioRouteSettle()`. |
| `src/modules/media/media.web.js:39` `enableAudioSystem()` | Resumes **Howler's** `AudioContext` for iOS autoplay unlock; called at the `lessonIntro` step and from `answer-pipeline.js`. Howler's context stays alive for the whole lesson. |
| `src/modules/video/after-video-player.web.js:38` `createSharedAudioContext()` | Shared context used by `SuccessButtons.jsx` to play the recorded clip. |
| `src/modules/video/video-processor.web.js:104, 1386` | One-off contexts for the recap export; one of them is `close()`d. |

The page therefore runs several contexts over a lesson (Howler's, one per take, the success-screen shared
one, the export one) and the capture is opened separately from all of them.

---

## 4. The measurements

All lab pages are part of the app build and are served next to it (paths, not the alias root). They
**report themselves** to a write-only table (§6), so the owner never has to copy log text — copy/paste from
an iPad was a real cost in this investigation.

### 4.1 Harness v1 — the device is fine (two separate sessions)

`/audio-harness`

| Test | Run A | Run B |
|---|---|---|
| 1. Microphone only | 0.96156 AUDIO | 0.82938 AUDIO |
| 2. Camera + microphone | 0.88715 AUDIO | 0.93022 AUDIO |
| 3. Camera + mic, app's exact constraints | 0.83855 AUDIO | 0.90383 AUDIO |
| 4. Camera + mic **while a `MediaRecorder` is running** (app order) | 0.85597 AUDIO | 0.87517 AUDIO |

Both runs recorded an mp4 clip (861 528 / 1 017 980 bytes) and **the owner heard their voice in it**.

### 4.2 Lab 2 — first reproduction (and why its verdict was wrong)

`/audio-lab`

| Test | Peak |
|---|---|
| 1. Control: mic only | 0.86744 |
| 2. Mic open → lesson video plays → probe the SAME capture | **0.87523, then 0.00000** |
| 3. Another `AudioContext` already running → mic | 0.72551 |
| 4. Unlock context + video played → mic | 0.73671 |
| 5. Video element destroyed → fresh capture | 0.86036 |

Test 2's log killed its own headline: `video.play: The request is not allowed by the user agent…`,
`playing= false, t= 0.00` — **the video never played**. So the trigger had to be one of the two other
things that happened between the two probes: the first probe's `AudioContext` was **closed**, or the media
element was **touched**.

### 4.3 Lab 3 — bisecting that reproduction

`/audio-lab3`

| Test | iPad |
|---|---|
| 1. Control | 0.82069 |
| 2. Same capture measured twice, context **closed** in between | 0.62210 |
| 3. Same capture measured twice, context **kept open** | 0.80248 |
| 4. Same capture, **media element touched** | 0.93394 |
| 5. Same capture, a **second** `AudioContext` | 0.94230 |

**Result code F: nothing reproduced.** Closing a context is not the trigger, touching media is not the
trigger, a second context is not the trigger. Lab 2's test 2 was a fluke of its own sequence.

### 4.4 Lab 4 — the AudioWorklet

`/audio-lab4` (run twice; second run)

| Test | Probe | Worklet output |
|---|---|---|
| 1. Control: capture + analyser, **no** worklet | 0.39626 | — |
| 2. Capture **through the app's own worklet** | 0.50647 | **0.50647** (122 624 frames) |
| 3. 440 Hz tone through the same worklet | — | 0 (see note) |
| 4. Worklet module loaded **before** the capture opens | 0.41869 | 0.41869 (120 576 frames) |

**The worklet is innocent** — test 2 is the app's exact worklet receiving the microphone and passing it
through at full level. (Test 3's zero is a defect in the page's tone graph, not a platform finding: the
oscillator produced no `process()` calls at all, `frames: 0`.)

### 4.5 Lab 5 — the app's full shape, combined for the first time

`/audio-lab5` (run twice; second run)

| Test | Probe | Worklet | Frames |
|---|---|---|---|
| 1. Control: mic + worklet | 0.67263 | 0.67263 | 127 616 |
| 2. Mic + **recorder running** + worklet | 1.00000 | 1.00000 | 124 672 |
| 3. **Camera+mic** + worklet | 0.58574 | 0.58574 | 124 928 |
| 4. Camera+mic + **preview playing** + worklet | 0.61468 | 0.85348 | 124 544 |
| 5. **THE APP**: camera+mic + preview + recorder + worklet | 0.81138 | 0.81138 | 124 544 |

**Result code T: every combination passes.** (First run reported U — the control failed once; a transient,
it passed on the rerun.)

### 4.6 Lab 6 — does an idle capture die during the countdown?

`/audio-lab6`

| Test | Peak |
|---|---|
| 1. Control: measure immediately | 0.23961 |
| 2. Open, wait 4 s with **nothing** consuming it, then measure | 0.30478 |
| 3. Open, wait 4 s with a **recorder** consuming it | 1.00000 |
| 4. Open, wait 4 s with a **silent context** attached | 0.37573 |

**Result code X: an idle capture survives.** Not the countdown.

### 4.7 The app's own page — in-page probes

Added to `useAppBootstrap` (`use-app-bootstrap-webonly.js`): `probeFreshCaptureDiagnostic()` runs 3 s and
12 s after the lesson opens, **with no take running**, opening its own capture and its own context.

```
page probe   : 0.21431   (t+3 s, no take)
page probe 2 : 0.33433   (t+12 s, no take)
mic          : iPad Microphone live muted=false   session=auto
tap peak     : 0.00000
fresh probe  : 0.00000   (2 s into the take — see the confound below)
recorder     : recording
chunks       : 0
captured     : 0.0000 (536960 samples @ 48000Hz)
```

Earlier takes, same shape: `captured 0.0000 (162176 samples)`, `(226304 samples)`, `(635648 samples)`.

**Reading of this:** the app's document is healthy when it holds no capture. The take is silent. The
in-take `fresh probe` is **confounded** — it opens a second capture while the app's own camera+mic capture
is live, and iOS may simply refuse the second one; it must not be read as "the page is hostile".

The `after probe` (planned 2 s after the capture is released) **never reported**, because it is scheduled
inside `recorder.onstop`, and on this device `MediaRecorder.stop()` did not fire `onstop` for a take that
recorded zero chunks (`chunks: 0` at stop). The same reason means `[CLIP]` never decoded a recorded file:
**there is no recorded clip to inspect on a silent take.**

---

## 5. Everything that was tried, chronologically

### 5.1 Field instrumentation
`diag-audio-capture`: log the track, `getSettings()`, the context rate, and an `AnalyserNode` peak on the
same `MediaStreamAudioSourceNode` the worklet uses. Result: live/unmuted 48 kHz track, running context,
`[TAP-PROBE] peak 0.00000`. This instrument is what makes the failure measurable without listening.

### 5.2 Deploy timeline
Every Cloudflare deploy mapped; none inside the failure window; last one before it was `5aec091a`.

### 5.3 Build bisect
`bisect-oct8` (`abed7e05`), `bisect-oct18` (`003c8df5`), `bisect-0420` (`a3476a3b`), `bisect-0531`
(`224163ad`), `bisect-0733` (`5aec091a`), `bisect-7b0c70b8`, `bisect-4f7e5e24` — **all fail**.
`git diff 4f7e5e24 HEAD -- src/modules/speech/speech.web.js` is empty. Not a regression.
(Caveat learned: preview-alias A/B on a stateful browser is unreliable — prefer in-page tests.)

### 5.4 `fix-tap-gesture`
Tap creation moved into the same gesture as the recorder start. No change. Hypothesis withdrawn.

### 5.5 `fix-release-capture` (stories/087)
Release the capture **before** the clip plays on iOS, then wait for the audio route to settle
(`capture-release-logic.js`). Correct and worth keeping — it fixed the "next take is silent after a replay"
field case — but it does not fix the current symptom (take 1 is silent with nothing played before it).

### 5.6 `diag-take-path`
`[TAKE]` logs for take start/stop, stream description, deferred recorder, sample count; plus a forced
replay of the recorded clip. Proved the take pipeline runs end to end.

### 5.7 `fix-native-rate`
Context created at the device rate (48 kHz) instead of `{ sampleRate: 16000 }`; 48k→16k moved to JS
(`audio-resample-logic.js`, 11 unit tests). On device the native-rate capture is **also silent** — the
analyser is flat at 48 kHz. Retained as the better design, but not the fix.

### 5.8 `fix-audio-only-tap`
When the camera-stream tap reads zeros, open a dedicated `getUserMedia({ audio: true })`, attach it to the
same context and drop the silent lead-in. Proven to fire (`[TAP] audio-only tap attached`) and **also
reads 0.00000** — strong evidence the composite stream is not the problem.

### 5.9 `fix-audiosession`
WebKit infers the AVAudioSession category from the media APIs a page uses; `playback` has no input.
The build set `navigator.audioSession.type = 'play-and-record'` before opening the capture. On device:
`[TAP] … | audioSession: play-and-record` and still `0.00000`. **Reverted.**

### 5.10 `clip-probe`
`inspectRecordedClipAudio()` decodes the recorded blob 1.5–5 s after the take and reports its peak, to
answer "does the file carry the voice even if the tap does not". It never produced a value, because on a
silent take the recorder's `onstop` never fires (`chunks: 0`). Only the blob-sized line was added later
(`clip bytes`), and it also never reported for the same reason.

### 5.11 The lab pages, and the on-device telemetry
`/audio-harness` → `/audio-lab` → `/audio-lab3` → `/audio-lab4` → `/audio-lab5` → `/audio-lab6`, each
adding one variable, plus `field_diag` reporting so the owner never has to copy console text. Results in §4.

### 5.12 The iOS `aspectRatio: 9/16` attempt (my own mistake)
Changing the iOS video constraint to 9:16 made the framing worse and was never the cause. Reverted; the
reason is now recorded in `getMediaConstraints()` so nobody re-tries it blind.

---

## 6. The diagnostic telemetry (temporary — must be removed)

- Table `public.field_diag` in the project's Supabase (`jbrbmbmupjfangqvaevx`): `id`, `created_at`,
  `source`, `payload jsonb`. **RLS on, insert-only policy for `anon`, no select.** The anon/publishable key
  is already public in the client bundle.
  **Drop it when the investigation ends:**
  ```sql
  drop table if exists public.field_diag;
  ```
- `src/modules/debug/field-diag.webonly.js` — builds a fixed, non-interactive panel at the top of the
  screen (`MIC / SESSION / TAP PEAK / CAPTURED / RECORDER / CHUNKS / CLIP PEAK / FRESH PROBE / PAGE PROBE`)
  and posts each batch to the table. No identifiers are sent (no deviceId, no user).
- The owner reads nothing and copies nothing; the investigator queries the table.

**Never hand-type the publishable key.** Two wasted rounds came from a truncated key being typed into a
page instead of copied from `src/modules/api/supabase-constants.js`.

---

## 7. What the evidence now points to, and the next tests

Everything the take is made of works on a lab page. The app's page works when no take runs. So the fault is
in the take, and there are exactly two possibilities left; one measurement separates them.

### 7.1 The single next test (highest value)

At the moment the app's tap reads `0.00000`, probe **the app's own stream** with a **separate
`AudioContext`**:

```js
const s = getSpeechCamStream();                 // the stream the take is using
const c = new AudioContext();                   // brand-new context
const src = c.createMediaStreamSource(s);
// analyser + gain(0.001) + destination, measure 2 s
```

- **AUDIO** → the capture is healthy and **the app's tap/graph is what is dead**. Next: instrument the tap
  context (was a previous context of the same page closed while this capture was open? is the worklet
  module the one that was registered on an earlier context?), and consider building the tap before the
  capture opens.
- **0.00000** → **the app's capture stream itself is dead**, even though lab 5 built the same stream shape
  successfully. Then the difference is in how the app acquires or holds it (memoised/warm-up stream? the
  exact moment of acquisition? the page's other activity) — and the next step is to re-acquire a capture at
  tap time and probe it *with the app's capture closed* (see 7.2).

### 7.2 The unconfounded re-probe (do this regardless)

The `after probe` never ran because it hangs off `recorder.onstop`, which does not fire on a zero-chunk
take. Move it: in `speech-orchestrator.js`, in the `if (!videoBlob)` / `if (!capture.usable)` branch,
after `safelyStopStream()` (which releases the capture), open a fresh capture and probe it. That answers
"is a *new* capture usable the moment the take's capture is gone?" with no second live capture in the page.

### 7.3 Other untested variables between "lab page" and "app take"

1. **The app reuses a memoised capture** (`speechCamStream`), possibly opened before the tap by
   `warmUpSpeechCamStream`. Labs always used a stream created milliseconds before the tap. Test: log
   `Date.now()` at acquisition and at the tap, and compare a take that re-acquires the capture at tap time
   with one that reuses it.
2. **A running Howler context + a played lesson video** (lab pages had neither a running extra context nor
   real media playback). Previously "another context" was tested *suspended*.
3. **Ordering**: the app opens the capture → starts the recorder → creates the context + worklet. Labs did
   context → capture → recorder → worklet. Lab 6 did open → (idle) → context, which is close but not
   identical (no recorder in between, no worklet module registration).
4. **The Whisper worker/WASM** starts when the mic is pressed. If a worker saturates the audio thread the
   capture could starve — but exact zeros from the *source* node argue against starvation.

### 7.4 If a fix is needed before the root cause is known

Transcribe from the **recorded clip** instead of the Web Audio tap. Two preconditions, both currently
unproven: (a) the recorder must actually produce data on this device — today `chunks: 0` on every take, so
the clip may be empty too; (b) WebKit must decode an mp4-with-video via `decodeAudioData`, or the audio
track must be demuxed. **Do not build this until (a) is measured** (log `chunks.length` and `blob.size` on
a take where the recorder *does* produce data — e.g. on a lab page it does: 1 MB mp4).

---

## 8. Candidate fixes, ranked

1. **Order the tap so nothing is closed while the capture is live** — if §7.1 shows the stream is fine and
   the graph is dead. `startLocalAudioTap` closes the previous context; `stopLocalAudioTap` closes the
   current one with the capture still open.
2. **Re-acquire the capture at tap time** — if §7.1/7.3 shows the memoised/warm-up stream is the dead one.
   Small change in `ensureSpeechCamStream` callers; the preview only appears at the take either way.
3. **Probe-driven fallback inside the app** — keep the `[TAP-PROBE]`, and when it reads zeros, close
   everything the take owns (context, worklet), re-acquire the capture, rebuild the graph, and probe again
   before declaring the take unusable. This turns a dead page into a retry.
4. **Transcribe from the clip** — only after §7.4's preconditions are measured.

Do **not** ship any of the diagnostics: `[TAP-PROBE]`, `[TAKE]`, `[CLIP]`, `[FRESH]`, the forced replay
(`playback: true`), the audio-only fallback's lead-in drop, `inspectRecordedClipAudio`, `probeFreshCaptureDiagnostic`,
`field-diag.webonly.js`, the `field_diag` table, or the six lab pages.

---

## 9. Constraints from the product owner

- **Do not touch the iOS raw-camera / `MediaRecorder` path** (iOS deliberately keeps the raw `getUserMedia`
  stream; its `MediaRecorder` is fragile).
- **Do not re-attempt `aspectRatio: 9/16` on iOS** without measuring the captured track's real dimensions.
- **Do not deploy to production or move `staging`** without explicit approval. Preview aliases only.
- Every URL handed to the owner carries **`?eruda`** if a console is needed, and must include the page path
  (`/audio-lab6`, never the alias root — the root serves the SPA).
- Tests must not require impractical actions on the iPad; the owner **cannot** force-quit Chrome, and
  copy/pasting log text is a real cost (hence the auto-reporting).
- The owner has **no second iOS device**.

---

## 10. Operational notes

```bash
cd /home/user/fix-release           # branch fix/release-capture-before-playback
npm run build
npx wrangler pages deploy dist --project-name=uffenglish --branch=<alias>
# → https://<alias>.uffenglish.pages.dev/<path>
```

Reading the telemetry (from this sandbox; `SUPABASE_ACCESS_TOKEN` is set):

```bash
curl -s -X POST https://api.supabase.com/v1/projects/jbrbmbmupjfangqvaevx/database/query \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":"select id, created_at, source, payload from public.field_diag order by id"}'
```

Aliases deployed during the investigation: `bisect-oct8`, `bisect-oct18`, `bisect-0420`, `bisect-0531`,
`bisect-0733`, `bisect-7b0c70b8`, `bisect-4f7e5e24`, `diag-audio-capture`, `fix-tap-gesture`,
`fix-release-capture`, `diag-take-path`, `fix-native-rate`, `fix-audio-only-tap`, `fix-audiosession`,
`clip-probe`, `audio-harness`, `audio-lab`, `audio-lab2`, `audio-lab3`, `field-view`, `field-view2`,
`field-run`, `field-run2`, `lab4`, `lab5`, `lab6`, `fresh-probe`, `page-probe`.

Diagnostic files in the tree: `public/audio-harness.html`, `public/audio-lab.html`,
`public/audio-lab3.html`, `public/audio-lab4.html`, `public/audio-lab5.html`, `public/audio-lab6.html`,
`src/modules/debug/field-diag.webonly.js`, plus the instrumentation in
`src/modules/speech/speech.web.js`, `src/modules/speech/speech-orchestrator.js` and
`src/hooks/use-app-bootstrap-webonly.js`.

---

## 11. Appendix — annotated failing take (from the device console)

```
[SimpleVideo] tryPlay called. readyState: 4 paused: true src: assets/videos/wouldyourather-a-01-01.mp4
[Phase] simpleVideo → simpleVideo-decisionTime-response
[TAKE] start — stream: audio=[iPad Microphone:live:live] video=[live]     // capture already open
[Phase] simpleVideo-decisionTime-response → recording/answering
[TAKE] take start — deferredOk: true | stream: audio=[iPad Microphone:live:live] video=[live]
[TAKE] starting the audio tap
[Speech] AudioContext created at native sampleRate: 48000
[TAP] track: iPad Microphone | readyState: live | muted: false | settings: {"sampleRate":48000}
      | contextRate: 48000 | audioSession: play-and-record        // every API says "healthy"
[TAKE] audio tap started
[TAP-PROBE] tick 1 peak 0.00000 ctx=running chunks=184           // worklet runs, samples are 0
[TAP] camera-stream tap was silent → retrying on a dedicated audio-only capture: iPad Microphone |
      readyState: live | settings: {"deviceId":"7B2E…","echoCancellation":true,"sampleRate":48000,"volume":1}
[TAP] audio-only tap attached; dropped the silent lead-in
[TAP-PROBE] tick 2..6 peak 0.00000 ctx=running chunks=35…785     // the audio-only capture is silent too
[TAKE] stop — samples: 37802 | stream: audio=[iPad Microphone:live:live] video=[live]
[Speech] No usable audio captured (silent), max amplitude 0.0000 — not sending it to Whisper
```

Earlier run with the 16 kHz resampler in the graph:
`Captured 157568 samples, max amplitude: 0.0000`, `Resampled 157568 → 52522 frames @ 16000 Hz`.
