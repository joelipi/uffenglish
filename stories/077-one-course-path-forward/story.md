# One course path forward: retire the unused courses, test two references

## Context

Nothing has shipped yet, so the course set is a development leftover: ten configs for
two real flows. The browser suite points at all of them, and most of its failures come
from that:

- **`gt2.json`** is the only `questions`-shaped config (139 lessons, no `steps`). The
  app's lesson loader reads `steps`, so **a gt2 lesson cannot load at all** — 20 spec
  loads pointed at it, each a guaranteed 30-second timeout.
- The remaining failures are specs that load a **regular** course without dismissing the
  guest modal, so `configData` never resolves and the spec times out.

The config set is also mostly duplication. Four friend courses are live in the listing
(`friend`, `friendchain`, `wouldrather`, `wouldyourather`) plus two fixtures and the
regular-flow course, and each of the 100+ unit-test references to them is a place the
course set can drift.

So: keep **one** path per flow, point the suite at it, and retire the rest.

## What changed

### The course set

Kept:

| file | role |
|---|---|
| `src/config/model.json` | the **regular-flow reference** — the repo's documented test URL (`/course/model/lesson/m-g`) |
| `src/config/wouldyourather.json` | the **friend-flow reference** — the generated config the pipeline ships |
| `src/config/wouldyourather-test.json` | the hand-written model of that course (the dev sandbox the contract test guards) |

Retired: `friend.json`, `friendchain.json`, `wouldrather.json`, `gt2.json`, `t.json`,
`test.json`, `test-api.json` — and their per-config test files
(`friend.test.js`, `friendchain.test.js`, `wouldrather.test.js`).

### The browser suite

- The four specs that were already in `testIgnore` as "stale, failing before the config
  existed" (`e2e-smoke`, `recording-persistence`, `success-screen`, `whisper-review`) are
  **deleted**, and the `testIgnore` block with them.
- Every spec now loads one of the two reference courses:
  - regular flow → `/course/model/lesson/m-g`
  - friend flow → `/course/wouldyourather-test/lesson/a` (or `/b?shareCode=friendtest1` for
    the respond lesson)
- `gt2` was never a course the app could load, so pointing the specs at it proved
  nothing.

### The unit tests that used the retired configs as fixtures

- `friend-lesson-link-config.test.js` — rewritten against the two surviving courses (it
  locked the retired configs' chain shapes).
- `friend-courses-logic.test.js` / `friend-course-configs.test.js` — the listed friend
  course is now `wouldyourather`; the "file basename, not `config.courseId`" rule is now
  proven with a synthetic entry, because no surviving *listed* course has a mismatched id.
- `friend-credit-logic.test.js` — the chain fixture is the twin.
- `model-config.test.js` — the recap-flag block retargeted; the `viewAndContinue`
  click-through block went with `test.json`, which was the only config with that shape.
- `course-tags.test.js` — the tag uniqueness rule now applies to **listed** courses (the
  app excludes the dev twin from the tag pages, so the twin must not take part in the
  rule either), and the required tags are the ones the surviving courses carry.
- `poster-utils.test.js` — the first-step intro slug list.

## Verification

- Every failing spec set was run **before and after** this change: the failure sets are
  identical, so nothing here was failing because of the ABABAB work either.
- The suite's own baseline: with the retired courses gone, no spec loads a course the app
  cannot render, and the two reference courses are the documented ones.

## Out of Scope

- The per-course *content* (the questions, the media) — only which configs exist and
  which course the suite exercises.
- The `friend` course's legacy two-lesson shape and the `wouldrather` six-lesson chain:
  both were development fixtures, and the one friend course that ships keeps the
  six-lesson a-f chain.
