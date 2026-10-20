# A signed-in visitor sees the friend's recorded question again (the ask-side UGC key)

## Context

Opening a friend's link — `https://ultrafastfluency.com/course/wouldyourather-test/lesson/b?shareCode=qm3zv` — played the teacher's clips but **not the friend's recorded question**. The friend had published their questions (`videos/qm3zv-qm3zv-wouldyourather-test-a-01..03.mp4`), the clips exist, and R2 serves them (200).

The reason is an addressing mismatch between the two sides of the UGC key.

A UGC clip is addressed `<recorder>-<inviter>-<course>-<lesson>-<NN>`: the
**recorder** is whoever recorded the clip, the **inviter** is the person whose
link they were answering (or themselves when they started the chain).

The **publish** side (`resolveInviterCode`, `video-processor-logic.js`) writes the
link's owner as the inviter, falling back to the recorder.

The **read** side resolves the config's friend references
(`{friendCode}{selfCode}-…`, `config-normalizer.js`) as
`<friend code>-<VIEWER's own code>-…` — the viewer's code, because for an
answer-side clip the viewer *is* the inviter: they asked the question the
recorder answered.

That holds for the answer-side clips and breaks for the **ask-side** ones. The
chain's ask lesson (the first shareCta lesson, `recapSources !== 'friend'`) is
recorded by the asker **themselves** — they start the chain, there is no
inviter — so their clip is published `<owner>-<owner>`. A signed-in viewer
resolved the reference to `<owner>-<viewer>`, which was never published:

| visitor | reference resolved | published | result |
| --- | --- | --- | --- |
| anonymous | `qm3zv-qm3zv-…-a-01` | `qm3zv-qm3zv-…-a-01` | plays ✓ |
| signed in (`d38bj`) | `qm3zv-d38bj-…-a-01` | `qm3zv-qm3zv-…-a-01` | **404 — nothing plays** ✗ |

The anonymous case only worked by accident: a visitor with no share code of
their own falls back to the friend's code (`bd7446bc`, "default selfCode to
friendCode"), which happens to be the asker's own code. Every friend course in
the repo has the same shape (`friend`, `friendchain`, `wouldrather`,
`wouldyourather`, `wouldyourather-test`): the references to the ask lesson are
the broken ones, the references to the later (answer-side) lessons are correct.

## Out of Scope

- **The key format** (`<recorder>-<inviter>-…`) and the 48h R2 lifecycle.
- **Already-published clips.** The fix makes the app ask for the key the asker
  actually published, so the clips that exist today start playing — nothing has
  to be re-recorded or re-uploaded.
- **The config format.** The fix is in the app's resolution, so the generated
  configs (and the master CSV behind them) stay as they are.
- **Merging into `main`.**

## Implementation approach

### 1. The ask-side reference resolves the inviter to the owner

`resolveShareCodes` now takes the course's **ask lesson id** and decides the
inviter per reference:

- a reference to the ask lesson → the inviter is the **friend** (the asker
  published it under their own name);
- every other reference → the inviter stays the **viewer's** code (they are the
  inviter of that answer-side clip).

The ask lesson is found with `findAskLessonId` (`friend-courses-logic.js`, pure):
the first shareCta lesson whose `recapSources` is not `'friend'`. The reference
is recognised by its tail (`-<askLessonId>-<NN>`) **and** by carrying the
`{friendCode}` placeholder, so a system slug that merely ends in the same
characters is untouched.

### 2. The publish side matches it

`resolveInviterCode` takes `isAskLesson` and then uses the **recorder's** code,
ignoring a stale persisted `friendCode` (the learner opened somebody's link
earlier). Without this the two sides could still disagree: the asker's clip
would be published `<owner>-<stale friend>` while the reader asks for
`<owner>-<owner>`. This is the counterpart of `resolveCompletePairCode`, which
already gates on `recapSources === 'friend'` — the comment on
`resolveInviterCode` said the two "must stay in sync if that ever changes",
and this is that change.

## Tasks

- `src/modules/courses/friend-courses-logic.js`
  → `findAskLessonId(config)` + `isAskLesson(config, lessonId)` (pure)
- `src/modules/bilingual/config-normalizer.js`
  → `resolveShareCodes` decides the inviter per reference; `normalizeConfig`
    passes the course's ask lesson id
- `src/modules/video/video-processor-logic.js` + `video-processor.web.js`
  → `resolveInviterCode` publishes the ask lesson's clips under the recorder's
    own name
- tests: the normalizer's UGC contract (ask-side vs answer-side, plus a real
  course config end to end) and `resolveInviterCode`'s ask-lesson gate

## Acceptance criteria

1. a signed-in visitor's ask-side reference resolves to the owner's own key
   (`<owner>-<owner>-…`), so the friend's recorded question plays
   → the normalizer contract test (a real `wouldyourather-test` config with a
     signed-in viewer) asserts the resolved slug, and the browser check (the
     R2 URL the lesson requests) was red before the fix and green after
2. an answer-side reference keeps the viewer's code (the viewer is the inviter
   of that clip)
   → the same contract test asserts the `-c-01` reference in lesson `d`
3. a reference that is not a friend reference is untouched
   → the contract test asserts a plain slug is unchanged
4. the asker's ask-lesson clips are published under their own name, even with a
   stale persisted friend code
   → `resolveInviterCode`'s test asserts the ask-lesson gate
5. `npx vitest run` reports 0 failures; `npm run build` and `npm run lint` exit
   0
   → commands and output recorded in the completion report

## Superseded

Story [083-friend-clip-addressing](../083-friend-clip-addressing/story.md) replaced
the rule this story introduced. The ask-side rule below ("a reference to the
ask lesson resolves the inviter to the owner") was a special case of a general
one: **a chain clip is addressed by its RECORDER alone**
(`<recorder>-<recorder>-…`), because the reader of a friend reference is the
only party that can compute the key and it knows just the friend's code and its
own. Both sides now use that rule, and the chain guard
(`src/modules/courses/friend-clip-chain.test.js`) walks a whole chain with the
app's own logic.

## Notes for reviewers

- **The anonymous case was never broken**, so the symptom only appears for a
  signed-in visitor — which is why it survived: every manual check of a shared
  link was done in a logged-out browser.
- **The rule is about the inviter, not the viewer.** A clip's inviter is the
  person whose link the recorder answered. For the ask-side clip there is no
  such person — the asker started the chain — so the inviter IS the asker.
- **The published clips are unchanged**, so the fix takes effect for every
  recording that is still inside its 48h window.
