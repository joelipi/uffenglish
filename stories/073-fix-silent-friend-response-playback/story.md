# Fix silent first second of friend closed-response video playback

## Context

A friend's `friendClosedResponse` clip (a UGC mp4 served from R2 under `/videos/…`) plays silently for roughly its first second when it auto-plays at the start of the step. Scrubbing the player back to 0:00 and pressing play makes the audio come through for the whole clip, so the bytes are intact — the loss is a playback-start problem, not a missing-audio problem.

Recent work on the 9:16 portrait capture (story 072) gated `MediaRecorder.start()` on the composite painting its first real frame (`startDeferredSpeechCamRecording` now awaits `framesDrawn > 0`, up to a 2 s timeout). That delay happens *after* `canvas.captureStream()` created the video track, so the recorded container ends up with a non-zero first-sample composition time / edit list that shifts the audio track by the gating delay (~1 s on a cold camera). Browsers honour that edit list on the initial play and skip the first second of audio; seeking to 0 resets the decoder and plays the full track — exactly the observed "scrub to the beginning fixes it" behaviour. The friend's clip is a `simpleVideoUrl` UGC mp4, so it is played by `SimpleVideoPlayer`, whose autoplay path never re-seeks to 0.

## Out of Scope

- Re-transcoding or re-publishing clips already on R2 (they expire on the 48 h UGC TTL; new clips are fixed at capture time going forward).
- Changing the 9:16 composite / freeze-detection work from story 072 (the gate stays; only its playback consequence is mitigated).
- InteractiveVideoPlayer scoring logic or subtitle reveal timing.

## Implementation approach

Two complementary fixes:

1. **Playback-side (immediate, covers every clip including already-published ones):** before calling `play()` in the autoplay paths of `SimpleVideoPlayer`, `InteractiveVideoPlayer` and `PlaybackVideo`, reset `video.currentTime = 0` (and, where the player already has a seeked-based replay helper, mirror that pattern) so the browser decodes from the true start instead of honouring the container's initial offset. This is the same operation the user performs manually by scrubbing to 0:00.
2. **Capture-side (prevents recurrence):** stop preferring `video/mp4` on Windows in `startSpeechCamRecording` — record `video/webm` there too, matching iOS. WebM has no edit-list priming delay, so newly recorded clips (friend answers included) play cleanly from 0:00. R2 publish already transcodes webm → mp4 via `transcodeToMp4`, so the published friend clip stays mp4; only the local recording/playback format changes. Keep the mp4 fast-path available for platforms that cannot record webm.

The gating from story 072 stays in place for freeze prevention; the timestamp offset it can introduce is neutralised at playback by (1).

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

### Task 2 - Record webm on Windows (no mp4 edit-list delay)

- `startSpeechCamRecording` runs on Windows
  - → `mimeType` resolves to a `video/webm…` type, never `video/mp4…`
  - → a source guard asserts `mp4Preferred` is `false` (or the mp4 branch is removed) on Windows
- `startSpeechCamRecording` runs on a platform without webm support
  - → falls back to `video/mp4` only when no webm type is supported
- R2 publish of a webm recording
  - → still produces an mp4 via `transcodeToMp4` (unchanged)

### Task 3 - Regression guards

- `src/modules/speech/portrait-capture-guards.test.js` (or a new `silent-playback-guards.test.js`)
  - → asserts the autoplay `tryPlay` blocks reset `currentTime` to 0 in both player components
  - → asserts `mp4Preferred` does not include Windows
  - → all existing speech + player tests still pass

## Bootstrap

N/A — no new dependencies or services.

## Technical Context

- `SimpleVideoPlayer.web.jsx` / `InteractiveVideoPlayer.web.jsx`: `tryPlay` inside the `useLayoutEffect` autoplay effect.
- `PlaybackVideo.jsx`: `handleLoadedMetadata` autoplay branch.
- `src/modules/speech/speech.web.js`: `startSpeechCamRecording`, `mp4Preferred`.
- Tests: `src/modules/speech/portrait-capture-guards.test.js`, player component tests.

## Notes

- The playback-side seek is the fix that helps clips already on R2; the capture-side change only affects recordings made after deploy.
- Do not remove the story-072 gating; it prevents frozen first frames. The seek neutralises its timestamp side-effect at playback.
- Keep `crossOrigin="anonymous"` and existing preload behaviour unchanged.