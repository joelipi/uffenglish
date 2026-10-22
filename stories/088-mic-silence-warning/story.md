# Warn the learner when the microphone delivers no audio

## Context

Story 087 added a no-audio recovery: `error_no_audio_captured` ("No audio was captured. Check your microphone settings. If the problem continues, turn off Bluetooth and reload the page, then try again.") with the mic put back, no score deduction, and no hang. On an iPad running iPadOS 27 that message never appeared — the learner recorded a take, heard nothing back, and got no explanation at all.

Reading the code shows why the message is unreachable in the case that actually happens:

- It is raised from exactly one place — `Core.analyzeCapturedAudio(rawAudioData)` returning `usable: false` in `speech-orchestrator.js` — and that is evaluated **once, after the take**, from the samples the `AudioWorklet` posted (`MIN_USABLE_CAPTURE_AMPLITUDE = 0.005`).
- A **dead tap posts no chunks at all** (`chunks: 0` on the iPad, tap peak `0.00000` in the field diagnosis): `analyzeCapturedAudio([])` is never reached because the orchestrator only gets there after `stopLocalAudioTap()` resolves, and until story 087's timeout fix it did not even resolve. Nothing else in the app looks at whether audio is arriving **while the learner is speaking**, so a dead microphone is completely silent — in both senses.
- A capture that peaks **between 0.005 and 0.03** (muted-mic bleed, room tone) is classified `usable`, is handed to Whisper, comes back with no text, and ends in `onStopEarly` — the generic "try again" copy and a 10-point deduction. That is also not the microphone guidance the learner needs, and it charges them for a device fault.

So the gap is: **nothing tells the learner, during the take, that the microphone is delivering nothing**, and the post-take message only covers the narrow "all zeros, but chunks arrived" case. This story adds the live warning and widens the post-take classification, without touching scoring.

## Out of Scope

- Fluency/flow-score behaviour. The hesitation timer still deducts flow points during dead air exactly as it does today; a dead microphone is indistinguishable from a learner thinking, and suppressing deductions would silently change scoring for slow starters. Not changed here.
- Automatic stopping of a take when the microphone is dead. The learner keeps control of the stop button.
- Audio-device enumeration, switching input devices, or explaining *which* microphone failed. The app cannot know, so the copy keeps presenting Bluetooth as something to try, never as the diagnosis (pinned by `src/data/strings.test.js`).
- The `error_no_audio_captured` copy itself (already correct and translated).
- Native (`speech.native.js`) audio capture — the stub stays a stub.

## Implementation approach

Three rules, each in a pure module with its own test, wired by thin glue.

**1. "Are we hearing anything?" is a pure, rule-based decision** (`src/modules/speech/mic-silence-warning-logic.js`):

```
evaluateMicSilence({ elapsedMs, chunkCount, peak, floor, warnAfterMs }):
  elapsedMs < warnAfterMs                        -> 'listening'
  elapsedMs >= warnAfterMs && chunkCount <= 0    -> 'silent'    (the tap posted nothing at all)
  elapsedMs >= warnAfterMs && !Number.isFinite(peak) -> 'silent'
  elapsedMs >= warnAfterMs && Math.abs(peak) < floor -> 'silent'
  elapsedMs >= warnAfterMs && Math.abs(peak) >= floor -> 'audible'
```

- `floor = MIC_SILENCE_FLOOR = Core.MIN_USABLE_CAPTURE_AMPLITUDE` (0.005, imported from `speech.core.js`, not re-typed — the "is this capture worth transcribing" floor and the "is anything arriving" floor must be the same number).
- `warnAfterMs = MIC_SILENCE_WARN_AFTER_MS = 3000`. The 3-2-1 pre-roll is finished before the tap starts (`startLocalAudioTap` runs after the countdown), so the whole 3 s is take time; 3 s is long enough that a learner who is simply thinking has not been nagged.
- `chunkCount <= 0` is the branch that matters: it is the only signal available when the worklet never posts, which is exactly the iPad failure.
- `silenceTransition(previous, next)` returns `true` on the edge into `'silent'`, `false` on the edge from `'silent'` to `'audible'`, and `null` otherwise — so the store is written on transitions only, never once per 250 ms tick.
- `createMicSilenceReporter({ onSilenceChange, floor, warnAfterMs, intervalMs = 250, now })` owns the timer and the accumulated peak: `start()` (reset + `setInterval`), `noteChunk(amplitude)` (count + monotonic peak; non-finite treated as 0), `tick()`, `stop()` (clear the interval, reset the state), `snapshot()`. The peak is cumulative for the take, so once the learner has been heard the warning cannot come back mid-take (a pause to think must not look like a dead microphone). Injecting `now` and the interval makes the whole thing testable with `vi.useFakeTimers()`.

**2. The tap reports transitions, the UI owns the copy.** `startLocalAudioTap(stream, onSpeechDetected, onSilenceChange)` creates the reporter, calls `noteChunk(peakAmplitude(chunk))` for every posted chunk (`peakAmplitude` also lives in `audio-resample-logic.js`), and forwards only transitions to `onSilenceChange(boolean)`. `speech-orchestrator.js` passes `(silent) => uiHooks?.onMicSilenceChange?.(silent)`, so the localized copy stays in `step-executor-webonly.js` next to every other message (the orchestrator has no `getAppLanguageFor(userData)` wiring and must not grow one). The existing `Math.max(...chunk)` speech-onset check is left untouched — it feeds the hesitation scoring, which this story does not change.

**3. "We heard nothing" is also the right classification after the take.** A capture that cleared the 0.005 floor but never reached speech level and produced no transcript is a device problem, not a wrong answer, so it must reach the same recovery (no deduction). The rule is pure (`speech.core.js`):

```
classifyEmptyTranscript({ transcript, maxAmplitude }):
  transcript is truthy                                -> 'transcribed'
  maxAmplitude >= MIN_SPEECH_CAPTURE_AMPLITUDE (0.03) -> 'unclear-speech'
  otherwise (including NaN/undefined/absent)          -> 'no-audio'
```

Only `'no-audio'` changes behaviour: the orchestrator calls `onNoAudioCaptured` (and releases the capture, like the existing silent branch) instead of `processTranscript`. A take where Whisper *did* return text is untouched, so a quiet-but-real answer is never thrown away.

Finally the post-take message stops auto-clearing: `clearWarningLater(8000)` is replaced by `cancelWarningClear()`, so the guidance stays on screen until the learner takes the next take (`onRecordingStart` replaces the message with the localized `speak-now` overlay anyway).

## Tasks

### Task 1 - The pure silence detector

- `evaluateMicSilence` + `elapsedMs` 2999, `chunkCount` 0, `peak` 0
  - → returns `'listening'`
- `evaluateMicSilence` + `elapsedMs` 3000, `chunkCount` 0, `peak` 0
  - → returns `'silent'` (a tap that never posted a chunk still warns)
- `evaluateMicSilence` + `elapsedMs` 3000, `chunkCount` 40, `peak` 0
  - → returns `'silent'`
- `evaluateMicSilence` + `elapsedMs` 3000, `chunkCount` 40, `peak` `NaN`
  - → returns `'silent'`
- `evaluateMicSilence` + `elapsedMs` 3000, `chunkCount` 40, `peak` 0.0049
  - → returns `'silent'`
- `evaluateMicSilence` + `elapsedMs` 3000, `chunkCount` 40, `peak` 0.005
  - → returns `'audible'`
- `evaluateMicSilence` + `elapsedMs` 3000, `chunkCount` 40, `peak` -0.2
  - → returns `'audible'` (magnitude, not the signed maximum)
- `MIC_SILENCE_FLOOR` imported
  - → equals `MIN_USABLE_CAPTURE_AMPLITUDE` from `src/modules/speech/speech.core.js`
- `silenceTransition` called with each pair of `'listening' | 'silent' | 'audible'`
  - → `('listening','silent')` true, `('silent','audible')` false, `('silent','silent')` null, `('listening','listening')` null, `('audible','audible')` null, `('audible','silent')` null
- `createMicSilenceReporter` with fake timers, `start()` then 2500 ms with no `noteChunk`
  - → `onSilenceChange` not called
- the same reporter advanced to 3000 ms
  - → `onSilenceChange` called exactly once with `true`
- the same reporter advanced another 2000 ms with no audio
  - → `onSilenceChange` still called exactly once
- a reporter with `noteChunk(0.2)` before the 3000 ms mark, then advanced past it
  - → `onSilenceChange` never called with `true`
- a warned reporter that then receives `noteChunk(0.2)` and one more tick
  - → `onSilenceChange` called with `false`, and no further calls on later ticks
- a reporter that has been warned, then `stop()`, then advanced 5000 ms
  - → no further calls
- `stop()` then `start()`
  - → elapsed time restarts, so a further warning needs a fresh 3000 ms
- `noteChunk(NaN)` repeated 10 times, then a tick past 3000 ms
  - → `'silent'` (`snapshot().chunkCount` is 10, `snapshot().peak` is 0)

### Task 2 - Wire the detector into the audio tap and the orchestrator

- `startLocalAudioTap(stream, onSpeechDetected, onSilenceChange)` called with an audible chunk posted
  - → `onSilenceChange` is never invoked with `true` (source guard: the reporter is fed `peakAmplitude(chunk)` from `port.onmessage`, not the signed `Math.max(...chunk)`)
- `stopLocalAudioTap()` called while a reporter is running
  - → the reporter's `stop()` is invoked before the worklet is disconnected (source guard: the `stop()` call sits inside `stopLocalAudioTap`, and `startLocalAudioTap` calls `start()` again before returning)
- `createSpeechOrchestrator` take with a fake `startLocalAudioTap` that invokes its third argument with `true` then `false`, and `uiHooks.onMicSilenceChange` supplied
  - → the hook is called with `true` then `false`
- the same take with no `uiHooks.onMicSilenceChange`
  - → the take still completes without throwing (`onReviewStart` reached)
- `src/modules/speech/speech.native.js` source
  - → still exports `startLocalAudioTap` and `stopLocalAudioTap` (the extra parameter is ignored, no signature change required there)

### Task 3 - The live warning and a message that stays put

- raw `strings` table entry `warning_no_audio_detected`
  - → the `en` value is exactly `We're not hearing you. Check your microphone, or turn off Bluetooth.`
  - → carries a non-empty `en`, `es`, `pt`, `fr`, `hi` and `bn` value
- `warning_no_audio_detected.en`
  - → contains `microphone` and `Bluetooth`
  - → contains no `reload` (a message shown mid-take must not tell the learner to reload and lose the take)
- raw `strings` table entry `error_no_audio_captured`
  - → still carries all six locales and still names the reload step (existing guard unchanged)
- `MicStatusText.jsx` source, `renderIcon` function body
  - → contains `case 'no-audio-live':`
- `MicStatusText.jsx` source, `colorClass` function body
  - → contains `case 'no-audio-live':` and the case's returned class is `'text-warning'`
- `step-executor-webonly.js`, `onMicSilenceChange` hook block (sliced to the next hook)
  - → `silent === true` path sets `type: 'no-audio-live'` with `Strings.get('warning_no_audio_detected'`
  - → calls `trackEvent('mic_silence_warned'`
  - → the otherwise path sets `type: 'speak-now'` with `Strings.getBilingual('status_speak'`
  - → contains no `deductSpeakingScore`
- `step-executor-webonly.js`, `onNoAudioCaptured` hook block (sliced to `onGibberishDetected`)
  - → contains `cancelWarningClear()`
  - → contains no `clearWarningLater` (the message is no longer timed out after 8 s)
  - → still contains `applyNoAudioRecovery(appStore` and no `deductSpeakingScore`
- `step-executor-webonly.js` hook ordering
  - → `onMicSilenceChange` is declared after `onGibberishDetected`, so the existing `onNoAudioCaptured` slice in `no-audio-wiring.test.js` is unaffected

### Task 4 - An empty transcript from a silent capture is a microphone problem

- `classifyEmptyTranscript({ transcript: 'hello', maxAmplitude: 0.5 })`
  - → `'transcribed'`
- `classifyEmptyTranscript({ transcript: '', maxAmplitude: 0.5 })`
  - → `'unclear-speech'`
- `classifyEmptyTranscript({ transcript: '', maxAmplitude: 0.03 })`
  - → `'unclear-speech'`
- `classifyEmptyTranscript({ transcript: '', maxAmplitude: 0.02 })`
  - → `'no-audio'`
- `classifyEmptyTranscript({ transcript: '', maxAmplitude: undefined })` and `({ transcript: '', maxAmplitude: NaN })`
  - → `'no-audio'`
- `MIN_SPEECH_CAPTURE_AMPLITUDE` compared with the orchestrator's real-time onset threshold in `speech.web.js`
  - → both are `0.03` (a guard reads the literal out of `speech.web.js` so the two can never drift apart)
- orchestrator take, `stopLocalAudioTap()` resolving 32000 samples of `0.02`, `transcribeAudioBuffer` resolving `''`
  - → `onNoAudioCaptured` called once, `onStopEarly` not called, `handleAnswer` not called, `safelyStopStream` called
- orchestrator take, `stopLocalAudioTap()` resolving 32000 samples of `0.02`, `transcribeAudioBuffer` resolving `'a clear sentence'`
  - → `onNoAudioCaptured` not called and `onReviewStart` called
- orchestrator take, `stopLocalAudioTap()` resolving 32000 samples of `0.2`, `transcribeAudioBuffer` resolving `''`
  - → `onStopEarly` called and `onNoAudioCaptured` not called (the existing retry path is unchanged)
- orchestrator source
  - → the `classifyEmptyTranscript` check indexes before the `processTranscript(` call

### Task 5 - Browser proof and the story's changed-path allowlist

- `tests/mic-silence-warning.spec.js` launched with `--use-file-for-fake-audio-capture=<silent wav>`, `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, `--autoplay-policy=no-user-gesture-required`
  - → importing `startLocalAudioTap` in the page, opening a fake `getUserMedia({ audio: true })` stream and running the tap for 5 s delivers exactly one `onSilenceChange(true)` event
- the same spec after `stopLocalAudioTap()`
  - → no `onSilenceChange` event arrives in the following 2 s
- `src/modules/video/recorder-page.test.js` allowlist
  - → contains every path this story adds or edits, and `git status --porcelain` reports no untracked file

## Notes

- The silent WAV for the spec is generated by the spec itself (canonical 44-byte RIFF header, PCM 16-bit mono, 16000 Hz, 16000 zero frames) into `os.tmpdir()`, and removed in `afterAll`; nothing is committed under `public/`. The spec must build its own browser (`chromium.launch({ args })`) because the fake-audio *file* flag is a launch argument, and must read the server address from `test.info().project.use.baseURL` rather than hardcoding one.
- The `#micStatusText` element renders at `top: 30%` with `z-index: 10007` (`index.html`), above the full-screen camera takeover (`.pip-container--takeover`, `z-index: 30`), so both the live warning and the post-take message are visible over the camera preview with no CSS change.
- This cannot be confirmed on-device from here (the sandbox has no microphone, and headless Chromium cannot reproduce WebKit's dead worklet). The unit tests and the browser spec prove the detector, the plumbing and the copy; the iPad check is the final confirmation, and `mic_silence_warned` in analytics is what will show whether real devices still start a take with a dead tap.
- Do not "fix" the 8 s auto-clear by shortening it: the reported failure was that the learner never saw the guidance at all, so the message now persists until the next take replaces it.
