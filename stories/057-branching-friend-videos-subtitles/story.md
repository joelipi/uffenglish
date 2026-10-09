# Never show app subtitles over a friend-recorded clip

## Context

`wouldyourather` lesson `b` opens with a `branching` step whose `simpleVideoUrl` is `{friendCode}wouldyourather-a-response-01` — the friend's recorded question, a UGC clip published per-segment with its speaker's caption **burned into the video** (stories 035/036). The committed `src/config/wouldyourather.json` also gives that step a `subtitles` object, so `SimpleVideoPlayer` draws the same SRT a second time over the clip.

Where the field comes from: on the overlay master (gid `242913338`) the lesson-`b` row with `video_file = {friendCode}wouldyourather-a-response-01` (`response_type` `branching`, `order` `1`, no `join`) has a non-blank `srt` column (and `srt_es`/`srt_pt`/`srt_bn`). The generator groups that one row into one step and `buildMasterSteps` → `srtSubtitlesFor` emits `step.subtitles` from `srt`, which is why the app shows the caption. Clearing that cell would hide the bug once, but the generator would reproduce it on the next config run, and any stray `srt` on a friend step would do the same.

Every other friend-clip step in every `src/config/*.json` (`wouldrather`, `friendchain`, `test`, `friend`) already has **no** `subtitles`; this one is the sole exception. The fix is to make the generator stop emitting `subtitles` for a step whose clip is a friend UGC video — that clip is already captioned, so an app caption would double it.

## Out of Scope

- No player/runtime change: `loadVideoForStep` keeps mapping `step.subtitles` straight to the player. The generator is authoritative (it overwrites configs) and a config test guard enforces the invariant over every course, so a runtime guard would duplicate the rule in two places.
- No sheet edit and no pipeline/recorder change — the stray master `srt` cell is left in place and becomes inert; no `srt` write-back touches this row (`write-srt-to-sheet.mjs` matches sheet rows by `filename`, which this row does not have).
- No change to `srt` behavior for system/teacher steps (they keep app subtitles) and no change to the recap (story 036 already nulls a friend clip's recap subtitle).
- No new dependency.

## Implementation approach

### Sheet → config mapping (the answer to "which row makes which field")

On the overlay master a **step** is the `join` value when non-blank, else `video_file`; a step's rows are all rows sharing that key within the lesson. Per step:

| Master column(s) | Config field |
|---|---|
| `join` else `video_file` | step key → `simpleVideoUrl` (or `introBackgroundVideoUrl` for a synthesized `lessonIntro`) |
| `response_type` | `responseType` |
| `phrase` (ordered by `Order` within the step) | `cue` (array) |
| `srt` / `srt_<lang>` | `subtitles` (localized) — system steps only |
| `subtitle_text` | burnt-in overlay markup — never app `subtitles` |
| `next_step` | `nextStep` |
| `choose_step_next` + `choose_step_text` | `chooseStep` |

The friend row in question groups alone (`join` blank) under `video_file = {friendCode}wouldyourather-a-response-01`, and its `srt` was the column producing `steps[1].subtitles`.

### Fix rule

A step whose key matches the shared friend/UGC convention `FRIEND_VIDEO_REGEX` (`/-response-\d+$/i`, `src/modules/video/video-source.js`) is a friend's published clip and must get **no** `subtitles`, regardless of `srt`/`srt_<lang>`/`subtitle_text`. Implement by reusing `isFriendVideoSlug` in `scripts/lib/sheet-config-utils.js` and skipping the subtitle call in both builders:

- `buildMasterSteps` (around line 485): `if (!isFriendVideoSlug(key)) { const subtitles = srtSubtitlesFor(stepRows, \`video_file "${key}"\`); if (subtitles !== undefined) step.subtitles = subtitles; }`
- `buildAuthoringSteps` (around line 554): guard the `subtitlesFor(groupRows, \`video_file "${videoFile}"\`)` call the same way with `videoFile`.

Skipping the call (rather than only dropping its result) also skips `srt_<lang>` timing validation for a friend step, so a stray/mistimed translation on a friend row can never skip the whole course.

## Tasks

### Task 1 - Generator omits subtitles for friend-video steps

Files: `scripts/lib/sheet-config-utils.js`, `scripts/lib/sheet-config-utils.test.js`.

- master-format lesson, a `branching` step keyed by `video_file: '{friendCode}wouldyourather-a-response-01'` with a non-blank `srt` and a deliberately timing-inconsistent `srt_es` + `buildCourseConfig(rows)`
  - → the step has no `subtitles` key
  - → no throw (the friend step's `srt_es` is not validated)
- the same lesson containing a system step (`video_file: 'wouldyourather_b01_i'`, non-blank `srt`) + `buildCourseConfig(rows)`
  - → that step's `subtitles.en` equals `unescapeSrt(srt)` (unchanged)
- authoring-format lesson, friend `video_file: 'ab12-x-a-response-01'` with a non-blank `srt`
  - → the step has no `subtitles`
- authoring-format lesson, friend `video_file` with only a non-blank `subtitle_text` (no `srt`)
  - → the step has no `subtitles` (the `subtitle_text` fallback is skipped too)
- authoring-format lesson, system `video_file: 'my-response-video'` (contains `response`, not `-response-NN`) with a non-blank `srt`
  - → `subtitles.en` is set (no false positive)
- `buildCourseConfigs` over two courses where only one has a friend step with `srt`
  - → the friend course's step has no `subtitles`; the other course is unaffected
- `findMissingColumns` for a friend step with a blank `srt`
  - → `[]` for `srt` (not a required column; unchanged)

### Task 2 - Committed config + all-config invariant

Files: `src/config/wouldyourather.json`, `src/modules/video/model-config.test.js`.

- read `src/config/wouldyourather.json`
  - → lesson `b`'s `branching` step (index 1) has no `subtitles` key
  - → its `simpleVideoUrl` (`{friendCode}wouldyourather-a-response-01`) and `chooseStep` are unchanged
- extend the `friend-slug invariant` describe over every `src/config/*.json`
  - → no step whose `simpleVideoUrl` / `introBackgroundVideoUrl` / `interactiveVideoUrl` matches `FRIEND_VIDEO_REGEX` has a `subtitles` key
  - → the guard is proven failable: adding a `subtitles` key to a friend-slug step throws
- full suite `npm test -- --run`
  - → passes, including `src/config/generated-config-contract.test.js` over the `wouldyourather` allow-list entry

### Task 3 - Document the master → config mapping and the friend-caption rule

Files: `docs/video-pipeline/authoring-sheet.md`, `docs/product.md`, `scripts/generate-config-from-sheet.test.js`.

- `docs/video-pipeline/authoring-sheet.md` gains an "Overlay master → config fields" section containing the mapping table above, the `join`/`video_file` step-grouping rule, and the rule that a step whose clip ends in `-response-NN` gets no `subtitles` because its caption is already burned in
- `docs/product.md` Features gains an entry for this behavior, linking `stories/057-branching-friend-videos-subtitles/story.md`
- a source-guard test in `scripts/generate-config-from-sheet.test.js` (raw source, no comment stripping) asserts the pinned doc tokens (the mapping section's `join`/`video_file` wording, the `-response-NN` no-`subtitles` rule, and the product entry + story link) and is proven failable per token

## Technical Context

- No new dependencies. Unit tests: `npm test -- --run` (vitest 4.1.6 + jsdom 29.1.1, colocated `*.test.js`).
- `FRIEND_VIDEO_REGEX`/`isFriendVideoSlug` live in `src/modules/video/video-source.js` (pure — no browser globals). `scripts/lib/pipeline-assets-utils.js` already imports from `src/modules/video/`, so `scripts/lib/sheet-config-utils.js` importing `../../src/modules/video/video-source.js` matches precedent.
- Generator grouping: `groupMasterRowsByKey` (master; key = `join || video_file`) and the `video_file` group loop in `buildAuthoringSteps`. Subtitle helpers: `srtSubtitlesFor` (master; `srt` only) and `subtitlesFor` (authoring; `srt` else `subtitle_text`).
- Player path: `step.subtitles` → `src/modules/video/video-loader.web.js` (`getLocalizedTranslation(step.subtitles, lang)`) → `SimpleVideoStateController.initSubtitles` → `src/components/SimpleVideoPlayer.web.jsx`. A `branching` step loads the `simpleVideo` phase (story 054), which is why the caption appeared on the branch clip.
- `wouldyourather` is the sole entry in `scripts/lib/generated-configs.json`, so `src/config/generated-config-contract.test.js` already validates the shipped config on every test run.

## Notes

- The root cause is a single stray `srt` on a friend row, but the durable fix is the generator rule: the sheet is the source of truth and regenerates (and overwrites) `wouldyourather.json`, so a data-only fix would regress on the next config run.
- The master row's `srt` cell need not be cleared; it is now inert for a friend step. Leaving it avoids a manual sheet edit.
- Not automatable: an operator confirming on a real device that the branch clip shows only its own burned-in caption and no second subtitle line. The contract is the absent `subtitles` key, which is exactly what the player consumes.
