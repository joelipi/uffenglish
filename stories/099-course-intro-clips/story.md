# Course intro clips (three reusable lesson openers)

## Context

A friend course drops the learner straight into content: lesson A opens on its
first ask branch, and every later lesson opens on the friend's recorded clip.
There is no short "here is the scenario" moment, so a first-time learner has
to infer what the drill is before recording.

The ABABAB chain repeats only two behaviours — *answer the friend* and *ask
your friend* — so a course needs just three short selfie clips, reused for every
lesson:

1. the **first ask lesson** opener (lesson A only; frames the whole course),
2. the **answer-phase** opener (every lesson from B on, before the friend's clip),
3. the **"now it's your turn"** opener (every lesson from B on, before its ask phase).

This story adds an optional authoring block for those three scripts to a
course's source file, routes the derived slugs through the master CSV, and has
the ABABAB config generator place them at deterministic points. It applies to
`cartoon-preferences` now; the mechanism is course-agnostic and off by default.

## Out of Scope

- Recording/rendering the three clips. The operator records them and uploads
  each `<slug>.mp4` to R2 under `assets/videos/`; `captions.yml` then fills the
  six-language subtitles from the audio (they are ordinary `simpleVideoUrl`
  slugs). Until the upload, those steps have no media — the same honest
  "authored but not yet recorded" state as a not-yet-rendered course.
- Any app, player or store change. A branching step already plays its
  `simpleVideoUrl` before raising its choices, and `viewAndContinue` already
  plays a clip then shows its Continue row.
- New step types, new UI, new tutorial topics.
- `wouldyourather`, `health`, `fruit-preferences`, `money-preferences`: their
  configs must stay byte-identical (they declare no `intros` block).
- Translating the authored scripts in the source: the spoken words reach the
  app through the caption pipeline, not through the translator, because the
  clips are not sheet rows.

## Implementation approach

- **Authoring surface.** `sources/<course>.source.txt` gains an optional
  `"intros"` object with exactly three non-empty English scripts:

  ```json
  "intros": {
    "first": "You're asking your friend which cartoon character you most resemble. ...",
    "respond": "Your friend is asking you what cartoon character they resemble. ...",
    "ask": "Now it's your turn to ask your friend the same questions. ..."
  }
  ```

  All three or none — a partial block is a structural error (the placement
  rules assume the whole set). Each script is trimmed, non-empty and at most
  80 words (the clips are deliberately short).

- **Slugs are derived, never authored.** `{course}-intro-first`,
  `{course}-intro-respond`, `{course}-intro-ask`. This mirrors the existing
  `{course}-{lesson}-{step:02}` derivation rule in the source file's contract
  and keeps a re-record on the same URL.

- **Bridge.** `sourceToRows` writes one new column, `intro_kinds`, on every row:
  the declared kinds in canonical order joined by `|` (`first|respond|ask`), or
  blank when the course declares none. Nothing else is added — the scripts stay
  in the source as the recording guide.

- **Generator (ABABAB).** `buildAbababCourseConfig` reads `intro_kinds`
  (first non-blank) and `abababLesson` places the slugs:
  - the lesson **without** a respond phase (the chain's first ask lesson) gets
    `simpleVideoUrl = intro-first` on its **first record-phase branching step**;
  - every lesson **with** a respond phase gets a `viewAndContinue` step with
    `simpleVideoUrl = intro-respond` immediately after its `lessonIntro` step —
    i.e. immediately before the friend-clip branch;
  - every lesson with a record phase **other than** the first ask lesson gets
    `simpleVideoUrl = intro-ask` on its first record-phase branching step;
  - the closing lesson has no record phase, so it gets no ask clip.

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
  block, the derived slugs, the placement table, and the operator step (record
  → upload to R2 → captions run on the config push).

## Tasks

### Task 1 - Source bridge: authored scripts become one `intro_kinds` column

- `sourceToRows(source)` + called in unit test
  - → emits `intro_kinds` = `first|respond|ask` on every row when `intros` declares all three
  - → emits `intro_kinds` = `` (blank) on every row when `intros` is absent
  - → throws `/intros/` when the block is partial (`{ first }` only)
  - → throws `/intros/` when a script is blank or not a string
  - → throws `/intros/` when a script exceeds 80 words
- `MASTER_HEADER` + called in unit test
  - → contains `intro_kinds` exactly once

### Task 2 - ABABAB generator: place the three clips at deterministic points

- `buildCourseConfig(rows)` with `intro_kinds = first|respond|ask` + called in unit test
  - → lesson `a`: the first `branching` step carries `simpleVideoUrl: '<course>-intro-first'`, and no `viewAndContinue` step exists
  - → lesson `b`: step index 1 is `{ responseType: 'viewAndContinue', simpleVideoUrl: '<course>-intro-respond' }`
  - → lesson `b`: its first record-phase `branching` step carries `simpleVideoUrl: '<course>-intro-ask'`
  - → lesson `b`: the respond-phase first `branching` step keeps the friend-clip `simpleVideoUrl` (the intro never steals it)
  - → the closing lesson: has the `-intro-respond` step and no `-intro-ask` slug anywhere
  - → the three slugs are the only intro slugs in the whole config
- `buildCourseConfig(rows)` with a blank `intro_kinds` + called in unit test
  - → emits no `viewAndContinue` step and no `-intro-` `simpleVideoUrl` (backward compatible)

### Task 3 - cartoon-preferences declares its three scripts

- `sources/cartoon-preferences.source.txt` + called in unit test
  - → parses with an `intros` object whose keys are exactly `first`, `respond`, `ask`
  - → each script is non-empty and at most 80 words
  - → `first` mentions asking which cartoon character you resemble; `respond` mentions your friend asking which character *they* resemble; `ask` says it is your turn to ask
- `public/cartoon-preferences.master.csv` + called in unit test
  - → every data row carries `intro_kinds` = `first|respond|ask`

### Task 4 - The generated cartoon config carries the three clips

- `src/config/cartoon-preferences.json` + called in unit test
  - → lesson `a` step 1 (`branching`) has `simpleVideoUrl` `cartoon-preferences-intro-first`
  - → lessons `b`–`g` step 1 is `viewAndContinue` with `cartoon-preferences-intro-respond`
  - → lessons `b`–`f` first record-phase `branching` step has `simpleVideoUrl` `cartoon-preferences-intro-ask`
  - → lesson `g` contains no `cartoon-preferences-intro-ask`
  - → exactly three distinct `-intro-` slugs exist in the file
  - → lesson step counts are `a: 16`, `b`–`f`: 44, `g`: 34
- `src/config/wouldyourather.json`, `health.json` + called in unit test
  - → contain no `-intro-` slug (the block is opt-in)

### Task 5 - Docs and the changed-path allowlist

- `docs/video-pipeline/authoring-sheet.md` + called in static guard test
  - → documents the `intros` block, the `{course}-intro-{first|respond|ask}` derivation, the placement table and the R2 upload step
- `docs/product.md` + called in static guard test
  - → carries the feature bullet linking the story
- `src/modules/video/recorder-page.test.js` allowlist + called in static guard test
  - → lists every path this story changes

### Task 6 - A caption run does not fail on an authored-but-unrecorded clip

The configs reference the intro slugs before the clips are recorded. The
caption workflow runs on every `src/config` change on `main`, and today a
missing object makes the whole run throw — so adding the slugs would turn the
next push red.

- `buildCaptionEdits` + called in unit test
  - → when `transcribe(slug)` resolves `null`, the slug is reported in `skipped`, `generated` is empty, and the step keeps no `subtitles`
  - → a missing caption that was NOT reported as skipped still throws (no silent loss)
- `applyCaptionsToText` + called in unit test
  - → leaves a step in the `skipped` set untouched
  - → still throws for a slug that is neither captioned nor skipped
- `scripts/generate-captions.mjs` + called in static guard test
  - → treats an HTTP 404 download as `null` (not recorded yet) and logs `SKIP <slug>`
  - → every other non-OK status still throws

## Operational note

The three slugs are ordinary R2 objects the operator records and uploads. Until
they are uploaded, the intro steps have no media (the same authored-but-not-yet
recorded state as a course whose render has not run). Upload with:

```
npx wrangler r2 object put uff/assets/videos/cartoon-preferences-intro-first.mp4 --file <path> --content-type video/mp4
npx wrangler r2 object put uff/assets/videos/cartoon-preferences-intro-respond.mp4 --file <path> --content-type video/mp4
npx wrangler r2 object put uff/assets/videos/cartoon-preferences-intro-ask.mp4 --file <path> --content-type video/mp4
```

Then re-run the caption workflow (`workflow_dispatch`) to fill the six-language
subtitles and `npm run posters:upload` if posters are wanted.
