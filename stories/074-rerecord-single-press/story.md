# Re-record is a single press that starts the take immediately

## Context

On a voice step the learner taps the mic, records, and Whisper transcribes the take. The transcript is then shown in the review overlay with two buttons: accept (✓) and **record again (✕)** — `whisper_re_record` in `src/data/strings.js`, rendered in `src/components/LessonContainer.jsx:224-245` under `bottomState === 'reviewButtons'`.

Pressing **record again** today takes two presses to record again:

1. `LessonContainer.jsx:237-242` calls `phaseData.onReject` — which is `rejectTranscript` in `src/modules/speech/speech-orchestrator.js:146`.
2. `rejectTranscript` clears the playback blob and peaks and calls the `onTranscriptRejected` UI hook (`src/modules/lesson/step-executor-webonly.js:353-365`), whose last line is `transitionTo('recording/answering')`.
3. `recording/answering` is the *idle* recording screen: `mediaState: 'webcamOrAvatar'`, `bottomState: 'micActiveOrAnswerInput'`, but `isMicActive === false` and no take is rolling. The orchestrator's `toggleSpeechRecognition` was already released (`listeningState.active === false`) when the learner stopped the first take, so nothing restarts automatically. The learner sees a bare camera/blank frame with a muted mic button and has to press it a second time before the 3-2-1 countdown and the take begin.

The product wants one press: **record again** should be indistinguishable from the first mic press — camera preview, 3-2-1 countdown, take.

The same restart primitive is not needed anywhere else: `onPreflightRejected` and `onStopEarly`/`onGibberishDetected` have their own recovery copy and timings and are deliberately left alone.

## Out of Scope

- The accept (✓) path and the 7-second review auto-accept timer.
- `onPreflightRejected`, `onStopEarly`, `onGibberishDetected` recovery paths — they keep their current "press the mic again" behaviour and their existing delay/`pointLoss` accounting.
- The correction-card clearing on mic press ([story 014](stories/014-hide-correction-box-on-re-record/story.md)) and the `setHintsVisible(false)` call site in `MicrophoneToggle.web.jsx` — unchanged.
- Any change to the mic button's own behaviour, the review overlay's countdown (`timeLeft`), or the review buttons' markup/labels.
- The `-20` point deduction for a rejected transcript, and `incrementWhisperRejections`.
- React Native: `speech-orchestrator.js` is already web-agnostic (it receives every platform primitive by injection), so no `.native` counterpart is needed.

## Implementation approach

The re-record button already reaches the orchestrator: `rejectTranscript` is the orchestrator's own closure over `params` and `listeningState`, and it is the only thing that knows how to start a take. Restarting from there reuses the *identical* code path as the first mic press — `toggleSpeechRecognition(params)` with `listeningState.active === false` re-enters the `!listeningState.active` branch: `startSpeechCamRecording` → `setMicActive(true)` → `uiHooks.onRecordingStart` → the 3-2-1 `setRecordingCountdown` loop → `startDeferredSpeechCamRecording` → `startLocalAudioTap`. No duplicate countdown, no second camera-acquisition code path, no new state.

Ordering matters: `onTranscriptRejected` must run **first** so the app is already in `recording/answering` when `uiHooks.onRecordingStart` fires. `onRecordingStart`'s guard (`step-executor-webonly.js:256-263`) treats `recording/answering` as "retry within the same step — no-op", so the phase is neither re-transitioned nor warned about.

The store's `answerFlowTransitions.review` currently allows only `feedback` and `loading`, so `review → recording/answering` would log `[Phase] Unexpected transition`. Add `'recording/answering'` to that list — it is now a first-class transition, and an unexpected-transition warning is a defect per `AGENTS.md`.

The two gates ("can we restart right now?") live in a new pure module `src/modules/speech/rerecord-logic.js` per the repo's logic/presentation rule. It returns a single decision from an exported enum; the caller compares against `RERECORD_DECISIONS.restart`. A parallel `restart: boolean` would be a second source of truth a future decision could contradict.

- `listeningActive` — a take is still rolling. Re-entering `toggleSpeechRecognition` would run its **stop** branch and immediately abort the take the learner is trying to redo. Never restart. Checked first, so it wins when both gates are held.
- `transitioning` — the orchestrator's own start/stop mutex is still held. `toggleSpeechRecognition` already refuses in that state; refusing here too keeps the decision explicit and loggable instead of a silent no-op. Never happens for a real UI click (the reject lands in a later task, after the stop branch's `finally` released the lock), but it is the one case the guard exists for.

On a refusal the learner is **not** stranded: `onTranscriptRejected` has already put the app in `recording/answering`, which renders the mic button, so the manual second press still works exactly as today.

`onTranscriptRejected` is optional-chained, but the whole design depends on it running first: it is the hook that transitions to `recording/answering`. The shipped step executor always registers it together with `onReviewStart`, so the two are effectively a pair — a caller must not supply one without the other.

`onMediaError` on the restarted take needs no special handling: `startSpeechCamRecording`'s catch already routes through `uiHooks.onMediaError`, which leaves the mic button mounted with localized recovery copy — the same behaviour as a first take with no camera.

## Tasks

### Task 1 - Pure decision for the re-record restart

- `listeningActive: false` + `transitioning: false` + reject pressed
  - → `decideRerecordAction` returns `RERECORD_DECISIONS.restart`
- `listeningActive: true` + reject pressed
  - → returns `RERECORD_DECISIONS.alreadyRecording`
  - → the mic path is not re-entered (no `startSpeechCamRecording` call)
  - → the learner is not stranded: `onTranscriptRejected` has already put the app in `recording/answering`, so the mic button stays mounted
- `transitioning: true` + reject pressed
  - → returns `RERECORD_DECISIONS.transitioning`
  - → the mic path is not re-entered
  - → the learner is not stranded (same reason)
- both gates held at once
  - → returns `RERECORD_DECISIONS.alreadyRecording` (the actionable reason wins over the mutex one, since a rolling take would be *aborted* by the re-entry)
- `decideRerecordAction()` called with no argument
  - → returns `RERECORD_DECISIONS.restart` (both flags default to `false`)
- the restart proceeds
  - → `[Speech] Re-record pressed — restarting the take immediately` is logged (AGENTS.md: a significant event logs on success)

### Task 2 - Re-record restarts the take through the first-tap path

- full take recorded, transcript reviewed, learner presses **record again**
  - → `uiHooks.onTranscriptRejected(cue, transcript)` is called exactly once, before the restart
  - → `startSpeechCamRecording` is called a second time (the mic path is re-entered)
  - → the store's `recordingCountdown` goes `3, 2, 1` again and returns to `null`
  - → `startDeferredSpeechCamRecording` is called for the second take
  - → `startLocalAudioTap` is called again (the take is actually rolling)
  - → `appStore.getState().isMicActive` is `true` again
  - → `orchestrator.listeningState.active` is `true` again
- learner presses **record again** twice for the same transcript
  - → the second press is completely inert: `startSpeechCamRecording` stays at one restart, and `onTranscriptRejected` and `updateSpeechRecording` each fire once (`reviewActive` latches the whole closure, so no second deduction or write happens)
- learner presses **record again** while a take is still rolling
  - → `startSpeechCamRecording` is not called again
  - → a `[Speech] Re-record not started` warning is logged naming the decision
- accept (✓) pressed instead of re-record
  - → `startSpeechCamRecording` is not called a second time (accept still ends in `feedback`)
- ✕ pressed while the orchestrator's start/stop lock is still held
  - → the mic path is not re-entered and the warning names `transitioning`
- restart of the take fails with a media error
  - → `uiHooks.onMediaError(error)` is called and `isMicActive` is left `false` (the learner keeps the mic button and the recovery copy)

### Task 3 - Wiring guards

- `src/modules/speech/speech-orchestrator.js` source inspected
  - → the restart closure it calls from `rejectTranscript` (`restartTakeAfterReject`) contains the `decideRerecordAction(...)` call and, after it, the `toggleSpeechRecognition(params)` re-entry (index order asserted, so hoisting the re-entry above the decision fails the guard)
  - → `rejectTranscript` calls `restartTakeAfterReject()` after `onTranscriptRejected`
  - → `rejectTranscript`'s `reviewActive` latch still precedes the restart, and the latch is the region's only `reviewActive` assignment
  - → the module imports `decideRerecordAction` from `./rerecord-logic.js`
- `review → recording/answering` is a legal store transition
  - → `transitionTo('recording/answering')` from `review` logs no unexpected-transition warning and actually writes `appPhase` (`src/modules/store/store.test.js`)
  - → the live reject sequence — take → review → ✕ — logs no unexpected-transition warning (`speech-orchestrator.test.js`)

## Technical Context

- React 19.2.0, Zustand 5.0.13, Vitest 4.1.6 — all already in `package.json`; no new dependencies.
- `createSpeechOrchestrator` receives every platform primitive by injection (`startSpeechCamRecording`, `stopSpeechCamRecording`, `startLocalAudioTap`, `transcribeAudioBuffer`, `updateSpeechRecording`, …), so the whole flow is testable with `vi.fn()`s and no `getUserMedia`.
- `rejectTranscript` is a closure inside `processTranscript` (`speech-orchestrator.js:55-171`), which destructures `params` and `player` from its argument; `toggleSpeechRecognition` is a hoisted function declaration in the same factory scope, so the restart is callable from inside the closure.
- `vi.mock` with `importOriginal` is used to neutralise `validateAnswerPrecheck`/`findMatchingCueText` in `src/modules/answer/answers.js` so the flow reaches the review phase without the real precheck.
- Existing test style to follow: `src/modules/speech/speech-orchestrator.test.js` (`vi.useFakeTimers()`, `advanceTimersByTimeAsync(3000)` to run the 3-2-1 loop, `appStore.subscribe` to capture countdown transitions) and `src/components/widgets/recording-countdown-wiring.test.js` for `readFileSync` source guards.
- `src/**` test files must not mention the operator-only recorder page (scanned by `src/modules/video/recorder-page.test.js`). No such token is used.
- `docs/product.md` gains one feature bullet for this story.

## Notes

- The learner still sees the same 3-2-1 countdown they get on the first tap; only the extra "press the mic again" step disappears.
- Nothing about the take's quality changes: the rejected transcript is still persisted via `updateSpeechRecording`, so analytics and the `whisperRejections` counter are unchanged. That write is fire-and-forget and its position relative to the restart is not load-bearing (the 3 s pre-roll makes an overlap impossible in practice), so no ordering between the two is asserted.
- The 7-second review auto-accept timer cannot fire during the restart: `rejectTranscript` sets `reviewActive = false` and clears the interval before the restart begins, and `acceptTranscript` re-checks the same latch.
- On Android the camera composite is force-released when a take stops (`shouldForceReleaseComposite`), so the restart re-runs `getUserMedia`; that is the same cost as the first tap and is what makes the blank-screen symptom visible there.
- **Not specified by this story, unchanged behaviour:** if the engine is not ready at the moment of the restart, the re-entered mic path takes the existing `!isWhisperReady` branch — `onEngineNotReady` plus the 1 Hz ready poll — and the learner sees the existing engine-error copy on the (still mounted) mic button. A friend/share lesson's ✕ restarts the same way; nothing about the restart is voice-step-specific.
- The restart deliberately bypasses `MicrophoneToggle.web.jsx`'s `setHintsVisible(false)`. That is benign: the review overlay precedes feedback, and `hangmanOps` is only set after an answer is judged, so the "Try again" card cannot be on screen when ✕ is pressed.
- Both `decideRerecordAction` gates are defence in depth — the shipped UI cannot present the ✕ while a take is rolling (in `review` the bottom band shows the review buttons, not the mic) or while the start/stop mutex is held (the click lands in a later task). They are kept because a re-entry into a rolling take would run the STOP branch and abort the take, and because a future UI that keeps the mic mounted behind the overlay would make either reachable.
- Manual verification: load `http://localhost:3000/course/model/lesson/m-g`, dismiss the guest modal, press the mic, speak, stop, then press **record again** and confirm the countdown, camera and take begin without a second press. Automated coverage is at the orchestrator-injection level only — the review phase is reached by stubbing the Whisper transcription, so no browser spec reaches this flow; the end-to-end check needs real Chrome (bundled Chromium lacks H.264) or a real device.
