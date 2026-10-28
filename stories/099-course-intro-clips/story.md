# Course intro clips (three reusable lesson openers)

## Context

A friend course drops the learner straight into content: lesson A opens on its
first ask branch, and every later lesson opens on the friend's recorded clip.
There is no short "here is the scenario" moment, so a first-time learner has to
infer the drill before recording.

The ABABAB chain repeats only two behaviours — *answer the friend* and *ask
your friend* — so a course needs just three short opening clips, reused for
every lesson:

1. the **first ask lesson** opener (lesson A only; frames the whole course),
2. the **answer-phase** opener (every lesson from B on, before the friend's clip),
3. the **"now it's your turn"** opener (every lesson from B on, before its ask phase).

The recorder's teleprompter renders one `phrase` at **9vw** inside a fixed frame,
so a 25-word paragraph is clipped. The pipeline's unit is therefore one CSV row
= one short line = one recorded take = one subtitle cue; the render concatenates
a step's takes into the one clip the app plays and writes one SRT cue per take.
The intros must follow that model, not be a single long clip uploaded by hand.

This story adds an optional `intros` block of short lines to a course's source,
routes one take row per line through the master CSV, and has the ABABAB config
generator place each concatenated clip (and its timed subtitles) at the right
steps. It applies to `cartoon-preferences` now; the mechanism is course-agnostic
and off by default.

## Out of Scope

- Any app, player or store change. A branching step already plays its
  `simpleVideoUrl` before raising its choices, and `viewAndContinue` already
  plays a clip then shows its Continue row.
- New step types, new UI, new tutorial topics.
- `wouldyourather`, `health`, `fruit-preferences`, `money-preferences`: their
  configs must stay byte-identical (they declare no `intros` block).
- Hand-translating the authored lines: they are ordinary takes, so they ride the
  existing render → `srt` → `srt_<lang>` → `subtitles` chain.

## Implementation approach

- **Authoring surface.** `sources/<course>.source.txt` gains an optional
  `"intros"` object with exactly three **arrays of short lines**:

  ```json
  "intros": {
    "first":   ["You're asking your friend which cartoon character you most resemble.", "Have fun. Let's start."],
    "respond": ["Your friend is asking you what cartoon character they resemble.", "Let's have fun."],
    "ask":     ["Now it's your turn to ask your friend the same questions.", "What cartoon characters do you resemble?"]
  }
  ```

  All three or none; each list has 1–6 non-empty lines; no line exceeds 20
  words (the recorder's 9vw prompt would clip it).

- **Slugs are derived, never authored.** `{course}-intro-first`,
  `{course}-intro-respond`, `{course}-intro-ask`. A re-record replaces the same
  R2 objects.

- **Bridge.** `sourceToRows` emits one master-CSV row per line:
  `set_role: intro`, `video_file` = the derived slug, `filename` =
  `<slug>-NN`, `order` = NN, `phrase` = the line, `response_type`
  `viewAndContinue`, and **blank** `title_text`/`subtitle_text`/`footer_text`
  so no overlay is burned onto a selfie opener. The rows carry no pair/topic
  coordinates and are attached to the chain's first lesson only (every row needs
  a lesson header).

- **Recorder.** Rows with a `filename` are recordable takes, so the three clips
  appear in the operator studio one short line at a time — no clipping.

- **Render + subtitles.** The takes of each slug concatenate into one video
  (`<slug>_full.mp4`), which `plan_publish` publishes as
  `assets/videos/<slug>.mp4` (plus the poster). The pipeline writes that step's
  `srt` with **one cue per line** and the concatenated timings; the translate
  run fills `srt_<lang>` with cue-text-only translations.

- **Generator (ABABAB).** Rows with `set_role: intro` are read by
  `abababIntros` (never as pair takes) and give `{ slug, subtitles? }` per kind:
  - the lesson **without** a respond phase (the chain's first ask lesson) gets
    `simpleVideoUrl = -intro-first` on its **first record-phase branching step**;
  - every lesson **with** a respond phase gets a `viewAndContinue` step with
    `simpleVideoUrl = -intro-respond` immediately after its `lessonIntro` step —
    i.e. immediately before the friend-clip branch;
  - every lesson with a record phase **other than** the first ask lesson gets
    `simpleVideoUrl = -intro-ask` on its first record-phase branching step;
  - the closing lesson has no record phase, so it gets no ask clip;
  - each intro step also gets the group's timed `subtitles` when the render has
    written its `srt` (absent before the render).

  Why this shape: a branching step plays its clip and then raises its choices,
  so the A/ask intros ride the branch itself (no extra tap). The answer-phase
  branch already owns the friend clip, so its intro gets its own
  `viewAndContinue` step (one Continue tap) rather than stealing that slot.

- **Config.** `public/cartoon-preferences.master.csv` is regenerated from the
  source (`generate-master-csv.mjs`, carrying translations) and
  `src/config/cartoon-preferences.json` from the CSV
  (`generate-config-from-sheet.mjs`). Expected step counts: lesson `a` keeps 16
  steps (one field added), `b`–`f` grow to 44 (one `viewAndContinue` step each),
  `g` grows to 34.

- **Docs.** `docs/video-pipeline/authoring-sheet.md` documents the `intros`
  block, the derived slugs, the placement table and the recorder/render/SRT
  flow.

## Tasks

### Task 1 - Source bridge: authored lines become one take row each

- `introScriptLines(source)` + called in unit test
  - → returns the three kinds' line arrays when all three are declared
  - → returns `null` when `intros` is absent (opt-in)
  - → throws on a partial block or an unknown kind
  - → throws when a kind is not a non-empty array of lines
  - → throws on a blank line, more than 6 lines, or a line over 20 words
- `sourceToRows(source)` + called in unit test
  - → emits one row per line in canonical kind order, `filename` `<slug>-NN`, `order` `NN`
  - → every intro row has `set_role: intro`, `video_file` the derived slug, `response_type` `viewAndContinue`, `lesson_id` of the chain's first lesson
  - → every intro row has blank `title_text`, `subtitle_text`, `footer_text`, and no `pair_index`/`topic_index`
  - → emits no intro rows when the source declares none
- `MASTER_HEADER` + called in unit test
  - → contains no `intro_kinds` column (presence is the rows, not a flag)

### Task 2 - ABABAB generator: place the three clips and their timed subtitles

- `buildCourseConfig(rows)` with intro rows + called in unit test
  - → lesson `a`: the first `branching` step carries `simpleVideoUrl: '<course>-intro-first'`, and no `viewAndContinue` step exists
  - → lesson `b`: step index 1 is `{ responseType: 'viewAndContinue', simpleVideoUrl: '<course>-intro-respond' }`
  - → lesson `b`: its first record-phase `branching` step carries `simpleVideoUrl: '<course>-intro-ask'`
  - → lesson `b`: the respond-phase first `branching` step keeps the friend-clip `simpleVideoUrl`
  - → the closing lesson: has the `-intro-respond` step and no `-intro-ask` slug anywhere
  - → the three slugs are the only intro slugs in the whole config
  - → with an `srt` on the intro rows, every intro step carries `subtitles.en` with one cue per line; without it, no `subtitles` key
- `buildCourseConfig(rows)` with no intro rows + called in unit test
  - → emits no `viewAndContinue` step and no `-intro-` `simpleVideoUrl` (backward compatible)
- `buildCourseConfig(rows)` with one kind's rows removed + called in unit test
  - → throws naming the missing kind

### Task 3 - cartoon-preferences declares its three short scripts

- `sources/cartoon-preferences.source.txt` + called in unit test
  - → parses with an `intros` object whose keys are exactly `first`, `respond`, `ask`
  - → each value is an array of 1–6 non-empty lines, each at most 20 words
  - → `first` mentions asking which cartoon character you resemble; `respond` says your friend is asking; `ask` says it is your turn to ask
- `public/cartoon-preferences.master.csv` + called in unit test
  - → has one `set_role: intro` row per line, in canonical slug order, with `filename` `<slug>-NN`
  - → every intro row has a non-empty `phrase`, `response_type` `viewAndContinue`, and blank burned-overlay columns

### Task 4 - The generated cartoon config carries the three clips

- `src/config/cartoon-preferences.json` + called in unit test
  - → lesson `a` step 1 (`branching`) has `simpleVideoUrl` `cartoon-preferences-intro-first`
  - → lessons `b`–`g` step 1 is `viewAndContinue` with `cartoon-preferences-intro-respond`
  - → lessons `b`–`f` carry exactly one `branching` step with `simpleVideoUrl` `cartoon-preferences-intro-ask`
  - → lesson `g` contains no `cartoon-preferences-intro-ask`
  - → exactly three distinct `-intro-` slugs exist in the file
  - → lesson step counts are `a: 16`, `b`–`f`: 44, `g`: 34
- `src/config/wouldyourather.json`, `health.json` + called in unit test
  - → contain no `-intro-` slug (the block is opt-in)

### Task 5 - Docs and the changed-path allowlist

- `docs/video-pipeline/authoring-sheet.md` + called in static guard test
  - → documents the `intros` line arrays, the `{course}-intro-{first|respond|ask}` derivation, the placement table, the `set_role: intro` take rows and the one-cue-per-line SRT
- `docs/product.md` + called in static guard test
  - → carries the feature bullet linking the story
- `src/modules/video/recorder-page.test.js` allowlist + called in static guard test
  - → lists every path this story changes

### Task 6 - A caption run does not fail on a video that is not on R2 yet

A generated config can reference a slug whose render has not published yet (the
caption workflow runs on every `src/config` change on `main`), and today a
missing object makes the whole run throw.

- `buildCaptionEdits` + called in unit test
  - → when `transcribe(slug)` resolves `null`, the slug is reported in `skipped`, `generated` is empty, and the step keeps no `subtitles`
  - → a missing caption that was NOT reported as skipped still throws (no silent loss)
- `applyCaptionsToText` + called in unit test
  - → leaves a step in the `skipped` set untouched
  - → still throws for a slug that is neither captioned nor skipped
- `scripts/generate-captions.mjs` + called in static guard test
  - → treats an HTTP 404 download as `null` (not published yet) and logs `SKIP <slug>`
  - → every other non-OK status still throws

## Operational note

The three clips are produced by the normal pipeline: regenerate the source →
master CSV, record the lines in the studio, render, then let the post-render
chain write `srt`/`srt_<lang>` and regenerate the config. Until the render, the
intro steps exist without media and the course is held back by
`--require-videos` (a missing `srt` is reported per step).
