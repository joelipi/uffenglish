# No audio captured: tell the learner, and never sit on "transcribing" forever

## Context

Field report (iOS, iPad): the learner taps the mic, speaks, taps to stop — the
waveform is a flat line, the playhead loops, and the app never leaves
`processing/transcribing`. No console error. **The cause turned out to be the
audio input, not the transcription**: a Bluetooth microphone was connected and
its capture produced no frames. Disconnecting it and reloading the page fixed
the recording, transcription and the countdown all at once.

The app got this wrong in three ways:

1. **It accepted the silent capture.** `stopLocalAudioTap()` flattened an
   all-zero buffer, `computeWaveformPeaks()` drew the flat line, and the zeros
   were sent to Whisper as if they were speech.
2. **It could wait forever.** `transcribeAudioBuffer`
   (`src/workers/whisper/app-vad-asr-web.js`) stores a resolver and waits for
   the worker's `result` message. There is no timeout, and the worker's
   `onerror` handler never settles a pending transcription — a dead or hung
   worker leaves the promise pending for the life of the page.
3. **The "try again" recovery was a dead end.** `onStopEarly`
   (`src/modules/lesson/step-executor-webonly.js`) shows the localized
   "TRY AGAIN" message but never leaves `processing/transcribing`
   (`bottomState: 'hidden'`), so no mic button is mounted. `triggerPreflightRejected`
   only increments a counter that nothing consumes. The learner can read
   "TRY AGAIN" but has no control to do it.

The learner never saw why. The fix makes the failure explicit and recoverable,
without changing the working audio path.

## Approach

### 1. Classify the capture before transcription

Add a pure `analyzeCapturedAudio(data)` to `src/modules/speech/speech.core.js`:

- `{ usable: false, reason: 'empty' }` for a null/zero-length buffer,
- `{ usable: false, reason: 'silent' }` when the peak amplitude is below a
  deliberately low floor (`0.005`, about -46 dBFS) — it catches an all-zero
  worklet, not quiet room noise,
- `{ usable: true, reason: 'ok', maxAmplitude }` otherwise.

The orchestrator asks this **after** `stopLocalAudioTap()` and before Whisper.
An unusable capture:

- does not call `setRecordedAudioPeaks` (so the flat waveform is never drawn),
- stops the camera take with `playback: false` (a silent clip is not replayed),
- clears the peaks and the playback blob, and
- calls a new `onNoAudioCaptured(userData)` UI hook instead of transcribing.

### 2. A clear, non-blaming message and a real retry

`step-executor-webonly.js` implements `onNoAudioCaptured`:

- shows `error_no_audio_captured` (all six locales) through the existing
  `SystemMessageOverlay` with a microphone-muted icon,
- does **not** deduct speaking points — this is a device/settings problem, not
  a bad answer,
- transitions back to `recording/answering`, which mounts the mic button again
  (guarded so an already-correct phase does not log an "Unexpected
  transition").

The copy names what happened and what to try, without claiming to know which
device is at fault:

> No audio was captured. Check your microphone settings. If the problem
> continues, turn off Bluetooth and reload the page, then try again.

`onStopEarly` (empty transcript after Whisper) gets the same guarded transition,
so it is no longer a dead end either.

### 3. Bound the transcription promise

`app-vad-asr-web.js`:

- a finite `TRANSCRIPTION_TIMEOUT_MS` (45 s) settles `{ text: null, error:
  'timeout' }`, logs, and reports to PostHog,
- the worker `onerror` handler settles any pending transcription with
  `{ text: null, error: 'worker-error' }` and marks the engine failed,
- `result` and `terminate` clear the timer, so a timeout cannot fire after a
  successful result.

The orchestrator already turns a `null` result into `stopListeningEarly`, which
now returns to the mic.

### 4. Microphone selection — not in this story

Device selection is feasible on Android/desktop Chrome
(`enumerateDevices()` + `deviceId` constraints, labels after permission) but
**not reliably on iOS Safari**: WebKit has long-standing bugs where
`enumerateDevices()` omits audio inputs, and iOS routes capture through the
system's current input; a page cannot be relied on to force the built-in mic.
Shipping a picker would therefore help some devices and silently do nothing on
the one in the report. It is left as a separate, feature-detected follow-up;
this story makes the capture failure visible either way.

## Out of scope

- Choosing/forcing an input device (see above).
- The 10-point `stopListeningEarly` penalty for a *transcription* that comes
  back empty (unchanged). The new no-audio path deliberately has no penalty.
- `preflightRejected` / `onGibberishDetected` dead ends (same class of bug, but
  separate copy and scoring decisions).

## Acceptance criteria

1. `analyzeCapturedAudio` classifies null/empty, all-zero, near-silent and
   speech buffers — unit tests.
2. An empty or all-zero capture never reaches `transcribeAudioBuffer`; the
   orchestrator calls `onNoAudioCaptured` once, leaves `recordedAudioPeaks`
   cleared and does not set a playback blob — behavioural orchestrator tests.
3. A usable capture still transcribes (no regression) — behavioural test.
4. `step-executor-webonly.js` defines `onNoAudioCaptured`, shows
   `error_no_audio_captured`, does not deduct points, and transitions to
   `recording/answering`; `onStopEarly` also transitions — source guard plus a
   check that the phase really becomes `recording/answering`.
5. `transcribeAudioBuffer` settles `{ text: null, error: 'timeout' }` within
   `TRANSCRIPTION_TIMEOUT_MS`; a worker `onerror` settles a pending
   transcription; a `result` clears the timer — behavioural tests with a fake
   worker and fake timers.
6. `error_no_audio_captured` carries en/es/pt/fr/hi/bn, and the English copy
   says no audio was captured, to check the microphone settings, and to turn
   off Bluetooth and reload — raw-table strings guard.
7. The existing speech-orchestrator and countdown suites stay green.

## Files

- `src/modules/speech/speech.core.js`
- `src/modules/speech/speech-orchestrator.js`
- `src/workers/whisper/app-vad-asr-web.js`
- `src/modules/lesson/step-executor-webonly.js`
- `src/modules/lesson/no-audio-recovery-logic.js`
- `src/components/widgets/MicStatusText.jsx`
- `src/data/strings.js`
- tests: `src/modules/speech/speech.core.test.js`,
  `src/modules/speech/speech-orchestrator-no-audio.test.js`,
  `src/modules/speech/no-audio-wiring.test.js`,
  `src/modules/lesson/no-audio-recovery-logic.test.js`,
  `src/workers/whisper/app-vad-asr-web.test.js`,
  `src/data/strings.test.js`
