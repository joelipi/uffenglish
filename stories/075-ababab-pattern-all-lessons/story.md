# ABABAB pattern through every lesson (wouldyourather-test config)

## Context

`src/config/wouldyourather-test.json` is the hand-maintained "model" config for the
would-you-rather friend course. It is **not** machine-generated: `scripts/lib/generated-configs.json`
lists only `wouldyourather`, so `wouldyourather.json` is the generator's output and
`wouldyourather-test.json` is written by hand. That is deliberate for now — we need a
working model of the config we *want* before we can fix the generator, which today
emits incorrect configs.

The course is three ask/answer **pairs** of video sets:

| set | questions | answers | topics |
|---|---|---|---|
| 1 | `a-01` … `a-03` (4 takes each) | `b-01` … `b-06` (4 takes each) | money/food/vacations |
| 2 | `c-01` … `c-03` | `d-01` … `d-06` | languages/city/friends |
| 3 | `e-01` … `e-03` | `f-01` … `f-06` | job-pay/privacy/phone-music |

Per topic the source (`wouldyourather.source.txt`) declares **4 question variants**,
**2 choice labels**, and **2 options × 4 answer variants**. The 4 takes of a question
video are the 4 phrasings; the 4 takes of an answer group are the 4 ways to say that
answer.

### The lesson chain

```
A (16)  records the set-1 questions              -> publishes into a
B (43)  answers the friend's set-1 clip           -> records the set-1 questions
C (43)  answers the friend's set-1 clip           -> records the set-2 questions
D (43)  answers the friend's set-2 clip           -> records the set-2 questions
E (43)  answers the friend's set-2 clip           -> records the set-3 questions
F (43)  answers the friend's set-3 clip           -> records the set-3 questions
```

Every lesson after A is **respond-then-record**: the friend's clip opens the lesson, the
learner answers it, then the learner records the next set's question videos. C reuses B's
answer videos and E reuses D's — there is only one answer video set per topic set, so
each set is drilled twice, once by each user. A is the seed: it records the set-1
questions and has no friend clip.

### Rules the config must respect (verified in code)

- `nextStep` is a **forward-only 1-based offset** from the step's own index
  (`resolveNextStepIndex`, `src/modules/lesson/branch-choice-logic.js:106`). A branching
  leaf's `nextStep` is the same offset, resolved from the branching step's index
  (`resolveNode`, same file line 40). `nextStep` is **not** an absolute index.
- `publishLessonId` overrides the R2 namespace a recorded clip publishes under
  (`resolvePublishLessonId`, `src/modules/video/video-processor-logic.js:271`). The
  namespace is the **video set** the clip plays, so a step publishes into its own
  lesson's namespace unless it plays another set's videos.
- `{friendCode}{selfCode}` expands to `<recorder>-<inviter>` and the whole slug becomes
  `videos/<recorder>-<inviter>-<course>-<lesson>-<NN>.mp4`
  (`applyShareCodeWildcards`, `src/modules/bilingual/config-normalizer.js:32`;
  `buildUgcSegmentKey`, `src/modules/video/video-processor-logic.js:292`).
- The publish index `NN` is 1-based **per target lesson**, assigned over the clips
  actually recorded, in visit order (`assignSegmentTargets`, same file line 278). Every
  lesson therefore publishes `-<set>-01..03`, and the recorder code in the slug picks
  whose copy the viewer sees.
- `recapSources` decides which prompt clips are stitched into the end-of-lesson recap:
  `friend` = only the friend's UGC clips, `none` = only the learner's own webcam clips
  (`resolveRecapSources`, same file line 107). Every lesson but A now answers a friend
  clip, so every lesson but A is `friend`.
- Video precedence for a step: `interactiveVideoUrl` > `introBackgroundVideoUrl` > `simpleVideoUrl`.

## What was wrong before

| lesson | before | after |
|---|---|---|
| `a` | 16 steps, 1-2-cue SRT subtitles | 16 steps, plain-phrase subtitles |
| `b` | 31 steps; the record phase was 3 bare steps; 20 answer tracks carried the combined video's 4/7-cue SRT | 43 steps, branched record phase, plain-phrase subtitles |
| `c` | 16 steps, an ask lesson, no subtitles | 43 steps, respond-then-record |
| `d` | 23 steps; 2 answer steps per topic instead of 8; combined slugs; duplicated branching steps; republish steps scattered mid-lesson *and* at the end | 43 steps, respond-then-record |
| `e` | 16 steps, an ask lesson, no subtitles | 43 steps, respond-then-record |
| `f` | 23 steps; same defects as `d` | 43 steps, respond-then-record |

**Why the generator produces the broken shape**: `public/wouldyourather.master.csv` has
one row per **take** (`filename` = take slug) but its `srt` / `srt_*` columns hold the
**step video's combined** SRT (4 cues, all four phrasings). The generator pairs the take
slug with the combined SRT, so a 2.8 s single-phrase video gets a 24 s, 7-cue subtitle
track. The per-take SRTs are not in the repo and not published on R2 — the pipeline
measures them at render time.

## The rewrite

### 0. Back up the current config

`stories/075-ababab-pattern-all-lessons/wouldyourather-test.before.json` holds the
pre-rewrite config (committed).

Notes:
- The backup must **not** live in `src/config/` under a `.json` name: the Vite glob in
  `friend-course-configs.js` loads every `src/config/*.json` as a course, and
  `friend-course-configs.test.js` asserts the exact set of loaded course ids.
- `src/modules/video/recorder-page.test.js` asserts that **every** changed file appears in
  its allowlist, and that there are no untracked files. The backup path, this story file
  and the guard test are all on that allowlist.

### 1. The lesson shape

**ASK / seed lesson** (A) — 16 steps:

```
0                        lessonIntro          introBackgroundVideoUrl = wouldyourather-a-01-01
1                        branching            (no video) 4 leaf choices = the 4 question variants
2..5                     friendClosedResponse takes 1..4 of the topic-1 question video, nextStep -> 6
6                        branching            4 leaf choices = the 4 question variants of topic 2
7..10                    friendClosedResponse takes of topic 2, nextStep -> 11
11                       branching            topic 3
12..15                   friendClosedResponse takes of topic 3, nextStep -> end
```

**RESPOND-then-RECORD lesson** (B…F) — 43 steps:

```
0                        lessonIntro          {friendCode}{selfCode}-wouldyourather-test-<friendSet>-01
1                        branching            same friend clip; 2 choice groups x 4 leaves (nextStep 1..8)
2..9                     friendClosedResponse answer takes <answerSet>-01-01..04, -02-01..04, nextStep -> 10
10                       branching            friend clip for topic 2; 2 groups x 4 leaves
11..18                   friendClosedResponse answer takes -03-01..04, -04-01..04, nextStep -> 19
19                       branching            friend clip for topic 3; 2 groups x 4 leaves
20..27                   friendClosedResponse answer takes -05-01..04, -06-01..04, nextStep -> 28
28                       branching            (no video) 4 leaves = the 4 phrasings of the topic-1 question
29..32                   friendClosedResponse question takes <recordSet>-01-01..04, nextStep -> 33
33                       branching            topic 2
34..37                   friendClosedResponse question takes <recordSet>-02-01..04, nextStep -> 38
38                       branching            topic 3
39..42                   friendClosedResponse question takes <recordSet>-03-01..04, nextStep -> end
```

The record phase mirrors an ask lesson exactly: a branching step that offers the 4
phrasings, then one `friendClosedResponse` step per take, each advancing past its group
to the next branching. The learner chooses *which phrasing* to record.

Per lesson the three sets are:

| lesson | friendSet (answered) | answerSet (repeated) | recordSet (recorded) |
|---|---|---|---|
| b | a | b | a |
| c | a | b | c |
| d | c | d | c |
| e | c | d | e |
| f | e | f | e |

### 2. Subtitles

A take speaks **one** phrase, so its subtitle is that phrase — **no timings**, in all
six locales. The player supports it: `initSubtitles`
(`src/modules/video/simple-video-controller.js:59`) checks for `-->`; with no timings it
sets `activeSubtitleText` to the whole string and shows it for the video's length.

```json
"subtitles": {
  "en": "A million dollars today.",
  "es": "Un millón de dólares hoy.",
  "pt": "Um milhão de dólares hoje.",
  "bn": "আজ এক মিলিয়ন ডলার।",
  "fr": "Un million de dollars aujourd'hui.",
  "hi": "आज दस लाख डॉलर।"
}
```

Every cue, group label and leaf label carries the same six locales.

### 3. Where the data came from

- **Answer phrases + translations**: `public/wouldyourather.master.csv` columns
  `phrase` / `phrase_es/pt/bn/fr/hi` (one row per take).
- **Choice labels**: the same CSV's `choose_step_text` / `_es/pt/bn/fr/hi` (the two
  labels of a topic, newline separated).
- **Question phrasings and their translations**: the existing config's lesson A / C / E
  steps (the take cues and the branching leaves).
- **Video slugs**: all 108 server videos the config references were verified to return
  HTTP 200 on R2 (`https://r2.ultrafastfluency.com/assets/videos/<slug>.mp4`).

## Tests

`src/config/wouldyourather-test.test.js` guards the shape with the app's **own**
resolvers (`resolveNextStepIndex`, `resolveBranchChoices`) so the checks are behavioural,
not textual:

- each lesson's step/branching/response counts
- every response step uses a single-take slug, has one cue in 6 locales, and a
  plain-phrase subtitle in 6 locales equal to its cue
- every response step publishes into the namespace of the video set it plays
- each lesson repeats the answer set and records the question set it is meant to
- every branch leaf targets a response step; every label is localized
- every response step advances to a branching or the end; every step is reachable
- the friend-clip chain: B/C answer the `a` clip, D/E the `c` clip, F the `e` clip,
  always indices `01..03`

The guards were mutation-tested: 12 injected defect classes (combined slug, dropped
locale, leftover timings, subtitle/cue mismatch, wrong/missing `publishLessonId`, removed
record step, response→response advance, leaf pointing at a branching, unlocalized label,
rewired friend chain, wrong answer set) each turned the right guard red.

## Out of Scope (this pass)

- **The generator.** `scripts/generate-config-from-sheet.mjs` /
  `scripts/lib/sheet-config-utils.js` still emit the combined SRT on take steps. The
  hand-written config is the *model*; the generator is fixed in a follow-up story.
- `public/wouldyourather.master.csv` — its `srt` columns are the source of the defect and
  stay as they are until the generator work lands.
- `src/config/wouldyourather.json` — the generated file; it changes only when the
  generator is fixed.
- No app-code changes. The branching resolver, the publish-key builder and the recap
  planner already implement everything this config needs.
- The naming convention (`a` = questions, `b` = answers, one pair per letter) is
  unchanged; it is not ideal but it is the convention the video files on R2 already use.
