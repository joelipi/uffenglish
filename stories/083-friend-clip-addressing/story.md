# A chain clip is addressed by its recorder (every hop of the friend chain resolves)

## Context

The ABABAB friend chain (`stories/075-ababab-pattern-all-lessons`) has six lessons and
**every lesson after the first plays a friend's clip**: lesson `b` and `c` play the
`a` namespace, `d` and `e` the `c` namespace, `f` the `e` namespace. The learner's own
contribution to that namespace is what the next learner in the chain watches.

A user-reported symptom: **lesson C's friend videos do not show.** The teacher's clips
play, the friend's clip 404s.

### The addressing

A UGC clip is addressed `videos/<recorder>-<inviter>-<course>-<lesson>-<NN>.mp4`
(`buildUgcSegmentKey`, `src/modules/video/video-processor-logic.js:292`):

- the **recorder** is whoever recorded the clip;
- the **inviter** is the person whose link the recorder was answering (the recorder
  themselves when they started the chain).

The **publish** side wrote the inviter as the link owner (`resolveInviterCode`, same
file:309) — the ask lesson excepted, where the inviter is the recorder themselves
(story 079).

The **read** side resolves the config's `{friendCode}{selfCode}-…` references
(`resolveShareCodes`, `src/modules/bilingual/config-normalizer.js:57`):

- a reference to the course's **ask** lesson's namespace asks for `<friend>-<friend>`
  (story 079: the asker published their own clip under their own name);
- every other reference asks for `<friend>-<viewer>`.

### The defect

The reader wants **the friend's own clip** — the one the friend contributed to that
namespace. The friend published it as `<friend>-<the person the friend was answering>`,
and **the reader cannot compute that code**: it knows the friend's code and its own, but
not the inviter the friend was answering. So the reader asks for a key that was never
written:

| reader | asks for | published | result |
| --- | --- | --- | --- |
| the chain's originator's invitee (lesson `b`) | `<friend>-<friend>` | `<friend>-<friend>` | plays ✓ |
| the next learner in the chain (lesson `c`) | `<friend>-<friend>` | `<friend>-<the friend's inviter>` | **404** ✗ |
| a stranger (lesson `c`) | `<friend>-<friend>` | `<friend>-<the friend's inviter>` | **404** ✗ |

Live R2 objects (bucket `uff`, prefix `videos/`, 2026-10-20) make it concrete:

```
k9gyi-d38bj-wouldyourather-a-01..03.mp4     <- k9gyi's contribution to the `a` namespace
d38bj-d38bj-wouldyourather-a-01..03.mp4     <- d38bj's own ask clip
```

A learner who opens **k9gyi's** link and reaches lesson `c` is sent to
`videos/k9gyi-k9gyi-wouldyourather-a-01.mp4` (or `k9gyi-<viewer>-…` under the pre-079
rule) — neither exists. The clip that exists is `k9gyi-d38bj-…`, whose second code is
the inviter k9gyi was answering. **The friend is the previous learner in the chain, and
the previous learner's clip is addressed with a code the reader cannot derive.**

The abort case is worse: the run `qm3zv` answering `d38bj` published
`qm3zv-d38bj-wouldyourather-test-b-01/02.mp4` (the answer set) but never reached the
`a` namespace, so the clip the next learner needs was never written at all.

### Why the chain breaks here and not earlier

In the **old** config shape the `a` namespace was read by lesson `b` only, and the clip
published there was the **asker's own** clip (`<asker>-<asker>`) — the one key the
reader *can* compute. The ABABAB shape added a second reader of the same namespace
(lesson `c`), and that reader wants the **previous learner's** copy.

## The fix

**A chain clip is addressed by its recorder alone.** The inviter slot of a UGC clip is
the recorder's own code, and a friend reference asks for `<friend>-<friend>`:

- **publish** (`resolveInviterCode`): the inviter slot is the recorder's own code — the
  ask-lesson exception disappears, because it is now the general rule;
- **read** (`resolveShareCodes`): the inviter slot resolves to the **recorder** of the
  clip the reference points at — the friend code for a friend reference, the viewer's own
  code for a self reference. The ask-side exception disappears too.

The two sides now agree for every hop:

```
F plays a  ->  F-F-…-a-01..03          (the `a` namespace)
V opens F's link, plays b  ->  reads F-F-…-a-01  ✓  (F's contribution)
V publishes              ->  V-V-…-a-01..03  (V's contribution to the same namespace)
W opens V's link, plays c  ->  reads V-V-…-a-01  ✓  (V's contribution)
```

The reader computes the key from the friend's code alone, so it works for a signed-in
viewer, an anonymous viewer and a stranger — no database round trip, no extra request,
and the friend clip is the one the learner actually watched in the previous lesson.

The **recap** is unaffected: it stitches the same config references, and the recap's own
key (`<self>-<asker>-…-complete.mp4`, `resolveCompletePairCode`) is a different key
family that still carries the pair.

### The cost

The key's second slot no longer carries the inviter, so a clip no longer records *who
invited the recorder*. The only place that distinction was readable was the reader's
own request, and the reader could not compute it anyway. Clips published under the old
rule (`<recorder>-<inviter>`) do not answer the new request (`<recorder>-<recorder>`)
and have to be re-recorded; the asker's own clip (`<asker>-<asker>`) is unchanged by
the rule and keeps working.

## Tasks

- `src/modules/bilingual/config-normalizer.js`
  → `resolveShareCodes` resolves the inviter slot to the reference's recorder; the
    ask-side special case (`isAskSideReference`, the `askLessonId` argument) goes.
- `src/modules/video/video-processor-logic.js`
  → `resolveInviterCode` returns the recorder's own code; the ask-lesson argument goes.
- `src/modules/video/video-processor.web.js`
  → the publish call drops the ask-lesson flag.
- `src/modules/courses/friend-courses-logic.js`
  → `findAskLessonId` / `isAskLesson` become dead code and go with it.
- tests
  → the normalizer's UGC contract (every hop), the publisher's key, and a new
    **chain guard**: walk the generated config's friend references and the app's own
    publish logic and assert that every clip a lesson asks for is a clip somebody
    publishes.
- docs
  → `AGENTS.md` (the UGC key rule), `docs/product.md` (the product rule) and
    `docs/learnings.md` (the incident).

## Acceptance criteria

1. a friend reference resolves to the friend's own clip key — `<friend>-<friend>-…` —
   not to a key built from the viewer's code
   → the normalizer contract test resolves a real `wouldyourather-test` reference for a
     signed-in viewer and asserts the resolved slug
2. the publisher writes the same key it is asked to read: the inviter slot is the
   recorder's own code
   → the publisher's test asserts the key for a clip recorded while answering a friend's
     link
3. every hop of the chain resolves: the clip lesson `c` asks for is the clip the
   previous learner published
   → the chain guard walks the generated config with the app's own logic (visit path,
     `assignSegmentTargets`, `buildUgcSegmentKey`, `resolveShareCodes`) and asserts that
     every friend reference addresses a published key
4. the guard can fail: a reference that resolves with the viewer's code (the old rule)
   makes it red
   → proved by mutation before the commit
5. `npx vitest run` reports 0 failures; `npm run lint` and `npm run build` exit 0
   → commands and output recorded in the completion report

## Out of scope

- **The key format.** The shape stays `<recorder>-<inviter>-<course>-<lesson>-<NN>.mp4`;
  only the second slot's value changes.
- **The recap's pair key** (`<self>-<asker>-…-complete.mp4`) — a different key family
  that keeps the inviter, because it names the pair the recap is made of.
- **Already-published clips.** They expire after 48h; the asker's own clip keeps
  working, the republished ones have to be re-recorded.
- **The alternative fix**: teaching the app the friend's inviter (the friend owner's
  `friend_owners`, or the inviter code on the friend-link entry) would address the
  published keys exactly, but it needs a database round trip before the lesson's first
  clip plays, it only works while the friend is signed in to a profile, and it keeps a
  slot in the key that the reader cannot derive on its own.

## Notes for reviewers

- The bug is invisible to a logged-out browser: an anonymous viewer has no code of its
  own and falls back to the friend's, which is why the manual checks passed.
- The first hop always worked — the asker's own clip is addressed `<asker>-<asker>`.
  The ABABAB shape added a **second** reader of the same namespace (lesson `c`), and
  that reader wants the previous learner's copy, which the old rules could not address.
- The chain guard is the test that should have existed: it walks the config with the
  app's own visit path and publish logic, so a shape change that breaks the addressing
  fails a unit test instead of a 404 in production.
