# The success-screen Continue button waits for the clip upload

## Context

At the end of a lesson the success screen shows three actions: Replay, Share and
Continue (`src/components/widgets/SuccessScreen.jsx`). For a logged-in learner
the recap is also published to R2 segment by segment, and while that upload
runs the screen raises a yellow warning — "Do not close this tab yet — it is
safe to navigate away to share the video, just don't close the tab yet."
(`clips_uploading_warning` in `src/data/strings.js`), driven by the
`clipsPublishing` store flag (`src/components/store/store.js:192`, set in
`src/components/widgets/SuccessButtons.jsx` around `exportSegmentsToR2`).

Continue is revealed at the same moment the recap becomes ready
(`setContinueVisible(true)` in `SuccessButtons.jsx`), i.e. **while the upload
is still running**. The learner can therefore tap Continue, navigate to the
next lesson, and abort the per-segment upload the warning is about — exactly
the outcome the warning exists to prevent. The two pieces of UI contradict
each other: one says "you may go on", the other says "do not leave yet".

The fix: Continue must not appear until the warning is hidden, i.e. until the
upload finished (`clipsPublishing` back to `false`).

## The fix

The Continue button's appearance is gated on the same flag that drives the
warning, decided by a pure predicate in the existing success-screen logic
module (`src/modules/lesson/success-continue-logic.js`):

- `isSuccessContinueBlockedByUpload(clipsPublishing)` — true while the upload
  gate is up.
- `shouldShowSuccessContinue({ visible, clipsPublishing })` — the row wants
  Continue **and** the upload gate is open.

`ContinueButton` (`src/components/widgets/SuccessButtons.jsx`) renders
nothing unless `shouldShowSuccessContinue(...)` is true, so the button
appears the moment the upload finishes and the warning goes away — for the
immediate (non-friend) reveal and for the friend-row delayed reveal alike,
because the store's `visible` flag stays set and the button re-renders on
the flag change.

The publish gate is also raised **before** the Continue reveal in
`runProcessing`, so no frame can show Continue while the upload is already
running (the two store writes are in the same tick today, but the order in
the source is what makes the invariant true by construction).

Guests (no upload) are unaffected: `clipsPublishing` stays `false`, so
Continue appears exactly as before.

## Acceptance criteria

1. the Continue button is not rendered while the clips are uploading
   → `src/components/widgets/SuccessButtons.test.jsx` renders the real
     `ContinueButton` with `clipsPublishing: true` and asserts
     `#continueButtonSuccess` is absent, then flips the flag to `false` and
     asserts it is present
2. the reveal decision is a pure, unit-testable predicate
   → `src/modules/lesson/success-continue-logic.test.js` covers
     `isSuccessContinueBlockedByUpload` / `shouldShowSuccessContinue` for
     every input combination (visible × publishing)
3. the button and the warning read the same flag
   → `src/components/widgets/clips-uploading-warning-wiring.test.js` asserts
     both `SuccessScreen.jsx` and `SuccessButtons.jsx` read
     `state.clipsPublishing`, and that the `ContinueButton` region gates on
     the shared predicate
4. the publish gate is raised before the Continue reveal
   → the same wiring guard asserts the index order inside `runProcessing`
5. the guards can fail
   → proved by mutation before the commit (removing the gate from the button,
     swapping the order of the two store writes, and dropping the predicate
     from the component each turn a guard red)
6. the browser behaviour is covered
   → `tests/success-concat-button.spec.js` asserts the Continue button is
     absent while `#clipsUploadingWarning` is on screen and appears once the
     warning is gone
7. `npx vitest run` reports 0 failures and `npm run lint` is clean
   → recorded in the completion report

## Out of scope

- The warning banner itself, its copy and the `beforeunload` guard — unchanged.
- The Replay and Share buttons — they stay available during the upload.
- The recap's own concatenated R2 upload (`uploadCompleteVideoToR2`), which is
  fire-and-forget and never raised the warning.
- The `beforeunload` prompt: it still fires on tab close while publishing.
- The friend-row delayed reveal's timing (3s after the Share tap) — unchanged;
  it is only additionally gated on the upload.
