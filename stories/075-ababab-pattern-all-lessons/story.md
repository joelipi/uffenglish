# ABABAB pattern through every lesson (wouldyourather-test config)

## Context

`src/config/wouldyourather-test.json` is the hand-maintained "model" config for the
would-you-rather friend course. It is **not** machine-generated: `scripts/lib/generated-configs.json`
lists only `wouldyourather`, so `wouldyourather.json` is the generator's output and
`wouldyourather-test.json` is written by hand. That is deliberate for now — we need a
working model of the config we *want* before we can fix the generator, which today
emits incorrect configs.

The authoring surface is `wouldyourather.source.txt` (it documents the design in its
header comment). The course is three **pairs** of lessons:

| pair | ASK lesson | ANSWER lesson | topics |
|---|---|---|---|
| 1 | `a` — Money, food, vacations | `b` — Answer: money vs. time, food vs. talk, vacation vs. weather | 3 |
| 2 | `c` — Ask: languages vs. instruments, city vs. country, honest vs. fun friends | `d` — Answer: (same topics) | 3 |
| 3 | `e` — Ask: job vs. pay, privacy, phone vs. music | `f` — Answer: (same topics) | 3 |

Per topic, the source declares **4 question variants**, **2 choice labels**, and
**2 options × 4 answer variants**. Everything else is derived:

- step video slugs `{course}-{askId|ansId}-{step:02}` → ask: `a-01..a-03`; answer: `b-01..b-06`
- take slugs `{video}-{take:02}` → each take speaks **one** phrase; take *N* = variant *N*
- routing: `question -> branch -> answers`; the branch's *k*-th choice targets the *k*-th
  answer group; each answer advances past its group
- republish: the answer lesson replays each topic's question video with
  `publishLessonId` = the ask lesson id
- SRT / cue arrays come "from the phrases in order (timings measured at render)"

### The two lesson shapes (verified against the running app)

**ASK lesson** (a, c, e) — 16 steps:

```
0                        lessonIntro          introBackgroundVideoUrl = <take of topic 1 question>
1                        branching            (no video) 4 leaf choices = the 4 question variants
2..5                     friendClosedResponse take 1..4 of the topic-1 question video, nextStep -> 6
6                        branching            4 leaf choices = the 4 question variants of topic 2
7..10                    friendClosedResponse takes of topic 2, nextStep -> 11
11                       branching            topic 3
12..15                   friendClosedResponse takes of topic 3, nextStep -> end
```

**ANSWER lesson** (b, d, f) — 31 steps:

```
0                        lessonIntro          introBackgroundVideoUrl = {friendCode}{selfCode}-<askLesson>-01
1                        branching            simpleVideoUrl = same friend clip; 2 choice groups x 4 leaves
2..9                     friendClosedResponse answer takes <ansLesson>-01-01..04 and -02-01..04, nextStep -> 10
10                       branching            friend clip for topic 2; 2 groups x 4 leaves
11..18                   friendClosedResponse answer takes -03-01..04 and -04-01..04, nextStep -> 19
19                       branching            friend clip for topic 3; 2 groups x 4 leaves
20..27                   friendClosedResponse answer takes -05-01..04 and -06-01..04, nextStep -> 28
28..30                   friendClosedResponse republish: the ask lesson's question take 1 of each topic,
                                            publishLessonId = <askLesson>
```

### Rules the config must respect (verified in code, not guessed)

- `nextStep` is a **forward-only 1-based offset** from the step's own index
  (`resolveNextStepIndex`, `src/modules/lesson/branch-choice-logic.js:106`). A branching
  leaf's `nextStep` is the same offset, resolved from the branching step's index
  (`resolveNode`, same file line 40). `nextStep` is **not** an absolute index.
- `publishLessonId` overrides the R2 namespace a recorded clip publishes under
  (`resolvePublishLessonId`, `src/modules/video/video-processor-logic.js:271`).
- `{friendCode}{selfCode}` expands to `<recorder>-<inviter>` and the whole slug becomes
  `videos/<recorder>-<inviter>-<course>-<lesson>-<NN>.mp4`
  (`applyShareCodeWildcards`, `src/modules/bilingual/config-normalizer.js:32`;
  `buildUgcSegmentKey`, `src/modules/video/video-processor-logic.js:292`).
- The publish index `NN` is 1-based **per target lesson**, assigned over the clips actually
  recorded, in visit order (`assignSegmentTargets`, same file line 278). So the three
  answer lessons each publish `-<lesson>-01..03`.
- `recapSources` decides which prompt clips are stitched into the end-of-lesson recap:
  `friend` = only the friend's UGC clips, `none` = only the learner's own webcam clips
  (`resolveRecapSources`, same file line 107).
- Video precedence for a step: `interactiveVideoUrl` > `introBackgroundVideoUrl` > `simpleVideoUrl`.

## Current state (measured 2026-10-20)

| lesson | steps | shape | subtitle state | verdict |
|---|---|---|---|---|
| `a` | 16 | ASK ✓ | 12 steps, 6 locales, 1-2 cues per take | correct |
| `b` | 31 | ANSWER ✓ | 27 steps, 6 locales — but **20 of them carry the combined video's SRT** (4 or 7 cues, ~21-25 s) on takes that are 2.8-10 s long | 20 steps wrong |
| `c` | 16 | ASK ✓ | **no subtitles at all**; intro uses the combined `wouldyourather-c-01` (29.2 s) | 2 defects |
| `d` | 23 | **broken** | 16 steps, 6 locales, all with the combined 4-cue SRT | 5 defects |
| `e` | 16 | ASK ✓ | **no subtitles at all**; intro uses the combined `wouldyourather-e-01` (29.8 s) | 2 defects |
| `f` | 23 | **broken** | 16 steps, 6 locales, all with the combined 4-cue SRT | 5 defects |

Defects in `d` and `f` (identical shape):

1. Only **2 answer steps per topic** (`d-01`, `d-02`) instead of **8** (2 options × 4 phrasings);
   the branch offers 2 flat choices instead of 2 groups × 4 leaves.
2. Answer steps use the **combined** slugs (`wouldyourather-d-01`) instead of the
   **take** slugs (`wouldyourather-d-01-01` .. `wouldyourather-d-06-04`).
3. **Duplicated branching steps** — `d` step 10 repeats step 5, and steps 9/14/17 all play
   topic 3's clip; the response steps for topics 2 and 3 are duplicated (11-13 == 6-8,
   18-19 == 15-16).
4. The **republish** steps are wrong twice over: they are scattered mid-lesson (steps 4, 8, 13)
   using the combined `c-02`/`c-03` slugs, and repeated at the end (steps 20-22) using the
   combined `c-01`/`c-02`/`c-03` slugs. They belong only at the end, one per topic, using
   the ask lesson's **take-1** slugs.
5. Every subtitle track is the **combined** 4-cue SRT, not the take's own phrase.

**Why the generator produces this**: `public/wouldyourather.master.csv` has one row per
**take** (`filename` = take slug) but its `srt` / `srt_es` / … columns hold the **step
video's combined** SRT (4 cues, all four phrasings). The generator pairs the take slug with
the combined SRT, so a 2.8 s single-phrase video gets a 24 s, 7-cue subtitle track. The
correct per-take SRTs are not in the repo and not published on R2 — the pipeline measures
them at render time.

## The rewrite

### 0. Back up the current config

Copy `src/config/wouldyourather-test.json` to
`stories/075-ababab-pattern-all-lessons/wouldyourather-test.before.json` (committed, so the
"before" state is reviewable and revertible).

Notes:
- The backup must **not** live in `src/config/` under a `.json` name: the Vite glob in
  `friend-course-configs.js` loads every `src/config/*.json` as a course, and
  `friend-course-configs.test.js` asserts the exact set of loaded course ids.
- `src/modules/video/recorder-page.test.js` asserts that **every** changed file appears in
  its allowlist, and that there are no untracked files. The backup path (and this story
  file) must be added to that allowlist.

### 1. Lesson C (ASK, 16 steps)

- step 0 `introBackgroundVideoUrl`: `wouldyourather-c-01` -> `wouldyourather-c-01-01`
  (the single take, matching lesson A's `wouldyourather-a-01-01`)
- steps 2..15: add `subtitles` — 6 locales, one cue per take, text = that take's phrase
  (`srt` end time = the take's measured video duration)

### 2. Lesson E (ASK, 16 steps)

- step 0 `introBackgroundVideoUrl`: `wouldyourather-e-01` -> `wouldyourather-e-01-01`
- steps 2..15: add `subtitles` — 6 locales, one cue per take

### 3. Lesson D (ANSWER, 31 steps) — rebuild

```
0                        lessonIntro          {friendCode}{selfCode}-wouldyourather-test-c-01
1                        branching            {friendCode}{selfCode}-wouldyourather-test-c-01
                                              2 groups ("Speak every language" / "Play every instrument")
                                              x 4 leaves (nextStep 1..8)
2..9                     friendClosedResponse wouldyourather-d-01-01..04, -02-01..04   nextStep -> 10
10                       branching            {friendCode}{selfCode}-wouldyourather-test-c-02
                                              2 groups x 4 leaves (nextStep 1..8)
11..18                   friendClosedResponse wouldyourather-d-03-01..04, -04-01..04   nextStep -> 19
19                       branching            {friendCode}{selfCode}-wouldyourather-test-c-03
                                              2 groups x 4 leaves (nextStep 1..8)
20..27                   friendClosedResponse wouldyourather-d-05-01..04, -06-01..04   nextStep -> 28
28..30                   friendClosedResponse wouldyourather-c-01-01 / -02-01 / -03-01,
                                              publishLessonId = "c"
```

### 4. Lesson F (ANSWER, 31 steps) — rebuild, same as D with `e`/`f`

```
0                        lessonIntro          {friendCode}{selfCode}-wouldyourather-test-e-01
1                        branching            {friendCode}{selfCode}-wouldyourather-test-e-01
2..9                     friendClosedResponse wouldyourather-f-01-01..04, -02-01..04   nextStep -> 10
10                       branching            {friendCode}{selfCode}-wouldyourather-test-e-02
11..18                   friendClosedResponse wouldyourather-f-03-01..04, -04-01..04   nextStep -> 19
19                       branching            {friendCode}{selfCode}-wouldyourather-test-e-03
20..27                   friendClosedResponse wouldyourather-f-05-01..04, -06-01..04   nextStep -> 28
28..30                   friendClosedResponse wouldyourather-e-01-01 / -02-01 / -03-01,
                                              publishLessonId = "e"
```

### 5. Lesson B (ANSWER) — repair the 20 wrong subtitle tracks

`b-01-*`, `b-02-*`, `b-04-*`, `b-05-*`, `b-06-*` (20 steps) carry the combined 4- or 7-cue
SRT on 2.8-10 s takes. Replace each with a single-phrase track (the group+b group's
variant), 6 locales, one cue, end time = the take's measured video duration.
`b-03-*` and the three republish steps are already correct — leave them alone.

## Where the data comes from

- **Phrase text (English)**: `wouldyourather.source.txt` — the `question[]` and
  `answers[][]` arrays. It is the authoring surface and already carries the exact strings
  for the `c`/`d` and `e`/`f` pairs.
- **Translations**: `public/wouldyourather.master.csv` columns `phrase_es/pt/bn/fr/hi` and
  `cue_*`, `choose_step_text_*` (already populated for every take).
- **Choice labels** (the 2 group names per topic): the source's `choices[]`; the CSV's
  `choose_step_text` column already carries them.
- **Take SRT end time**: the take's real duration, read from the mp4 `mvhd` box on R2
  (`https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4`). Verified for all 12 `a-*`
  takes: the config's SRT end is within ~0.4 s of the video duration, except the four
  long phrases that wrap into two cues (there the second cue's end runs ~1.3 s past the
  video). A take's phrase wraps into **two** cues when it is long, split at a word
  boundary around 60-80 characters, with the split at ~52% of the duration.
- **All required videos exist on R2.** Verified by HEAD request: every `a-0X-0Y`,
  `b-0X-0Y`, `c-0X-0Y`, `d-0X-0Y`, `e-0X-0Y`, `f-0X-0Y` take returns 200. The unsuffixed
  slugs (`a-01`, `c-01`, …) are the *combined* videos (1.0-1.6 MB, 23-30 s); the takes are
  130-380 KB, 2.8-10 s.

## Tests

Extend `src/config/wouldyourather-test.test.js` (it already guards lesson B) with a
config-wide guard:

- every `friendClosedResponse` step's `simpleVideoUrl` is a **take** slug
  (`wouldyourather-[a-f]-\d\d-\d\d`), never a combined one
- every `friendClosedResponse` step carries `subtitles` in all 6 locales
- every subtitle track's cue count matches the take's phrase length rule, and its last
  cue end is within ~2 s of the take's measured duration
- every answer lesson has exactly 3 branching steps + 24 answer steps + 3 republish steps
  (31 steps), and every ask lesson has 3 branching steps + 12 take steps (16 steps)
- every branching step's leaves resolve to the intended answer steps, and each answer
  step's `nextStep` lands on the next topic's branching step
- the republish steps are the **last three** steps of each answer lesson and carry
  `publishLessonId` = that pair's ask lesson

The guard must be proven to fail: re-inject each defect class (combined slug, missing
locale, combined SRT, duplicated branching) and confirm the right test goes red.

## Out of Scope (this pass)

- **The generator.** `scripts/generate-config-from-sheet.mjs` /
  `scripts/lib/sheet-config-utils.js` still emit the combined SRT on take steps. The
  hand-written config is the *model*; the generator is fixed in a follow-up story, once
  this shape is agreed.
- `public/wouldyourather.master.csv` — its `srt` columns are the source of the defect and
  stay as they are until the generator work lands.
- `src/config/wouldyourather.json` — the generated file; it changes only when the
  generator is fixed.
- No app-code changes. The branching resolver, the publish-key builder and the recap
  planner already implement everything this config needs.

## Open questions for the user

1. **Does lesson C become an ANSWER lesson?** The prose ("in Lesson C, at the beginning,
   the user responds to the videos that the other user recorded at the end of Lesson B")
   says every lesson from B on is respond-then-record. `wouldyourather.source.txt` and the
   asset inventory say the course is three ask/answer **pairs** — `a`→`b`, `c`→`d`, `e`→`f`
   — in which `c` is an ask lesson and `d` is the answer lesson. **The plan above follows
   the source file and the assets.** The prose reading cannot be implemented as stated:
   it needs 24 *answer* videos in the `c` namespace, and `wouldyourather-c-04-01` …
   `c-06-04` return **404** (only `c-01-01` … `c-03-04` exist, and those are `c`'s
   *question* takes). Confirm: pairs (as planned), or a different reading?
2. **The republish count.** The source file's shape implies 12 republish steps per answer
   lesson (4 takes × 3 topics); the shipped lesson B has **3** (take 1 of each topic).
   The plan copies B's 3. Confirm 3, or 12?
3. **Should this pass also repair lesson B's 20 wrong SRTs?** They are the same defect
   class. The plan includes it (step 5) because it is the same bug the user hit in
   lesson B. Confirm, or leave B for a separate story?
4. **The `lessonIntro` step.** The source file's header says "every lesson opens straight
   on content (no intro step)", but both A and B ship one, and the user has run B. The
   plan keeps the intro step. Confirm.
5. **Per-take SRT timings are derived, not measured.** The authoritative per-take captions
   come from the render. This pass derives the end time from the video's `mvhd` duration
   (accurate to ~0.4 s). Acceptable for the model, or should the new steps ship with no
   subtitles until the pipeline measures them?
