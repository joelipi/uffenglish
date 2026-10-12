# Extend recorder max take from 7s to 10s

## Context

The operator-only recording studio (`public/recorder.html`, served at `/recorder`) auto-stops every take after 7 seconds. Takes that run long are cut off, forcing the operator to rush or split lines. The request is to extend the cap to 10 seconds.

The cap lives in one place — `triggerStartRecording()` in `public/recorder.html` (lines 746–761):

- comment `THE RECORDING DURATION TIMER (7 SECONDS)`
- `var remaining_ms = 7000 - diff;`
- `appCoreLog("Max duration (7s) reached.");`

A repo-wide search confirms no other file assumes the 7s cap: `docs/video-pipeline/video_pipeline.py` handles arbitrary clip durations (silence trimming, zoom math), and no Pages Function or sheet consumer references 7000/7s. The manual STOP toggle (`node_btn_record.onclick` → `executeStopRecording()`) is independent of the timer and keeps working for shorter takes.

## Out of Scope

- Any change to the render pipeline, silence trimming, zoom, SRT write-back, or config generation.
- Any change to the pre-roll countdown (4s), pause/resume logic, upload, render triggering, or status polling.
- Any change to learner-facing recording (lesson recaps, friend clips) — this is the operator studio only.
- Any product.md feature entry — the recorder is covered by the existing "Cloud lesson-video pipeline (authoring)" bullet; a duration constant is not a user-facing feature.

## Implementation approach

Edit `public/recorder.html` only, in the `global_record_duration_timer` interval inside `triggerStartRecording()`:

1. `var remaining_ms = 7000 - diff;` → `var remaining_ms = 10000 - diff;`
2. Comment `THE RECORDING DURATION TIMER (7 SECONDS)` → `(10 SECONDS)`.
3. Log `Max duration (7s) reached.` → `Max duration (10s) reached.`

All three must change together so the countdown overlay (`(remaining_ms / 1000).toFixed(1)`, 50 ms tick), the auto-stop trigger (`remaining_ms <= 0` → `executeStopRecording()`), and the debug log agree. Manual stop before 10s is untouched: `executeStopRecording()` already clears the interval and stops the `MediaRecorder`.

Extend the existing guard `src/modules/video/recorder-page.test.js` (do not create a new `src/**` test file — any new file under `src/**` mentioning `/recorder` trips the hidden-page guard; extending the existing file, already in its exclude set, avoids this). Assert on the raw file text, scoped to the duration-timer block between `global_record_duration_timer = setInterval` and `executeStopRecording()`, so a whole-file `toContain('10000')` cannot pass vacuously and a bare-token search cannot be satisfied by an unrelated comment.

## Tasks

### Task 1 - Extend the auto-stop timer to 10s

- recorder page source after the edit + `npx vitest run src/modules/video/recorder-page.test.js` (Task 2 guard is the automated verification for all outcomes below)
  - → duration-timer block contains `10000 - diff` and contains neither `7000 - diff` nor `Max duration (7s)` (auto-stop fires at ~10s via the existing `remaining_ms <= 0` → `executeStopRecording()` path, unchanged)
  - → overlay countdown starts near `10.0` and reaches `0.0` (same `(remaining_ms / 1000).toFixed(1)` display on the 10s budget — asserted via `10000` in the timer slice, not by wall-clock)
  - → debug log contains `Max duration (10s) reached.`
- recorder recording + STOP pressed before the cap (existing `executeStopRecording()` path, source inspected — interval clear is untouched)
  - → recording stops immediately and review mode opens (manual stop unaffected by the longer cap)
  - → `executeStopRecording` source still contains `clearInterval(global_record_duration_timer)` (no auto-stop fires afterwards)

### Task 2 - Guard the 10s cap against regression

- repo state with the 10s cap + `npx vitest run src/modules/video/recorder-page.test.js`
  - → suite passes, including a new case asserting the timer block (sliced from `global_record_duration_timer = setInterval` to the next `executeStopRecording`) contains `10000`, `10 SECONDS`, and `Max duration (10s)`, and does not contain `7000` or `(7s)`/`7 SECONDS` within that slice
  - → guard proves it can fail: temporarily restoring `7000` in the slice makes the new case fail

## Notes

- No new dependencies; no Bootstrap or Technical Context needed.
- The overlay tick stays at 50 ms — only the budget changes, so no countdown-display rework.
- Uploaded take size grows modestly (~15 Mbps × 3s ≈ 5.6 MB extra worst case); well within the `/api/pipeline/upload-raw` path, which has no 7s assumption.
- Precedent: prior recorder-only fixes (e.g. skipping non-take rows) did not add product.md entries; this story likewise leaves `docs/product.md` unchanged.
