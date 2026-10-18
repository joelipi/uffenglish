# Fix silent first second of friend closed-response video playback

## Context

The video that plays during a `friendClosedResponse` step (a system/teacher clip uploaded to R2 as a normal high-quality mp4, referenced by `simpleVideoUrl`) is silent for roughly its first second when it auto-plays at the start of the step. The same file plays with full audio when scrubbed back to 0:00 and replayed, so the bytes are intact — the loss is a playback-start problem, not a missing-audio problem.

The clip's container carries a non-zero initial audio composition time (an edit list / `ctts` offset, common in mp4s produced by ffmpeg and honoured inconsistently by browsers): on the initial auto-play the browser starts decoding at the container's media timeline origin and skips the offset window of audio, while seeking to 0:00 resets the decoder and plays the full track — exactly the observed "scrub to the beginning fixes it" behaviour. `SimpleVideoPlayer`'s autoplay path never re-seeks to 0 before `play()`, so the offset survives into playback. (This is not a recording-side issue: the clip is a pre-uploaded teacher video, not a `MediaRecorder` take.)

## Out of Scope

- Re-encoding or re-uploading the teacher clip (the code-side seek covers it; asset-level normalization is a manual `scripts/optimize-videos.mjs` run if desired).
- Changing the 9:16 composite / freeze-detection work from story 072 (unrelated; recording format is untouched).
- InteractiveVideoPlayer scoring logic or subtitle reveal timing.
## Implementation approach

**Playback-side:** before calling `play()` in the autoplay paths of `SimpleVideoPlayer`, `InteractiveVideoPlayer` and `PlaybackVideo`, reset `video.currentTime = 0` (mirroring the existing `replay()` helper that seeks to 0 then plays after a short delay) so the browser decodes from the true start instead of honouring the container's initial offset. This is exactly the operation the user performs manually by scrubbing to 0:00, and it repairs every clip — including ones already on R2 — without re-encoding.

As a belt-and-braces measure for the uploaded asset, the clip should also be (re)processed through `scripts/optimize-videos.mjs` (`+faststart`, `make_zero` timestamp normalization) so the edit list is removed at source; but the code fix alone is sufficient and is what the ACs verify.

Capture-side / recording changes are explicitly out of scope: this clip is a pre-uploaded teacher video, not a `MediaRecorder` take, and story 072's gating is unrelated.
## Tasks

### Task 1 - Reset playback position before autoplay

- `SimpleVideoPlayer` auto-play path runs (readyState ≥ 2 or `canplay` fires) + `tryPlay` invoked
  - → `video.currentTime` is set to `0` before `video.play()` is called
  - → a source guard asserts `video.currentTime = 0` appears inside `tryPlay`
- `InteractiveVideoPlayer` auto-play path runs + `tryPlay` invoked
  - → `video.currentTime` is set to `0` before `video.play()` is called
- `PlaybackVideo` auto-plays a recording blob
  - → `video.currentTime` is set to `0` before `video.play()` is called
- A clip whose container carries a non-zero initial audio offset is auto-played
  - → audio is audible from the first frame (no ~1 s silent gap)

### Task 2 - Regression guards

- `src/modules/speech/portrait-capture-guards.test.js` (or a new `silent-playback-guards.test.js`)
  - → asserts the autoplay `tryPlay` blocks reset `currentTime` to 0 in both player components
  - → asserts `mp4Preferred` does not include Windows
  - → all existing speech + player tests still pass

## Bootstrap

N/A — no new dependencies or services.

## Technical Context

- `SimpleVideoPlayer.web.jsx`: `tryPlay` inside the `useLayoutEffect` autoplay effect (readyState ≥ 2 and `canplay` branches).
- `InteractiveVideoPlayer.web.jsx`: `tryPlay` inside the `useLayoutEffect` autoplay effect.
- `PlaybackVideo.jsx`: `handleLoadedMetadata` autoplay branch.
- Tests: player component tests / source guards beside each component.

## Notes

- The seek is the fix that helps clips already on R2; no re-encode or re-publish is required.
- Keep `crossOrigin="anonymous"` and existing preload behaviour unchanged.
- Do not change the uploaded file's codec or remux settings in code; asset-level normalization (if desired) is a manual `scripts/optimize-videos.mjs` run.