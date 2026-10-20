# One course path forward: retire the unused courses, test two references

## Context

Nothing has shipped yet, so the course set is a development leftover: ten configs for
two real flows. The browser suite points at all of them, and most of its failures come
from that:

- **`gt2.json`** is the only `questions`-shaped config (139 lessons, no `steps`). The
  app's lesson loader reads `steps`, so **a gt2 lesson cannot load at all** — 20 spec
  loads pointed at it, each a guaranteed 30-second timeout.
- The remaining failures are specs that load a **regular** course without dismissing the
  guest modal. The modal gates the config load (`config-normalizer.js`
  `isConfigLanguageSettled`), so a spec that waits for `configData` before confirming the
  language deadlocks.

The config set is also mostly duplication. Four friend courses are live in the listing
(`friend`, `friendchain`, `wouldrather`, `wouldyourather`) plus two fixtures and the
regular-flow course, and each of the 100+ unit-test references to them is a place the
course set can drift.

So: keep **one** path per flow, point the suite at it, and retire the rest.

## Acceptance criteria

1. **The course set is one path per flow.** `src/config/` holds `model.json` (the
   regular-flow reference), `wouldyourather.json` (the generated friend course the
   pipeline ships) and `wouldyourather-test.json` (its hand-written model, the dev twin
   the contract test guards). The listed friend courses are exactly `['wouldyourather']`.
   → `src/modules/courses/friend-course-configs.test.js`,
   `src/modules/courses/friend-courses-logic.test.js`
2. **Every spec navigates only to a reference course.** A spec that points at a retired
   config proves nothing — gt2's lessons have no `steps`, so the app could never load
   them. → `src/modules/courses/course-reference-guard.test.js`
3. **No spec names a retired course.** → `src/modules/courses/course-reference-guard.test.js`
4. **A spec that waits for the store's `configData` clears the guest gate.** Otherwise
   the config load it waits for is gated behind the modal. →
   `src/modules/courses/course-reference-guard.test.js`
5. **The unit suite is green** and **the browser suite's failures are pre-existing** —
   proven by running the same spec files before and after the change. → `npx vitest run`,
   `npx playwright test`

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
- Every spec that loads a regular course now clears the guest-language gate through the
  shared `confirmGuestLanguage` helper **before** it waits for `configData`.
  `answer-flow`, `lesson-g-video`, `playback-video`, `poster-check`, `regression-guard`
  and `whisper-page-cache-lifecycle` timed out on that wait; `landscape-warning` had the
  same bug in two of its five tests (the landscape banner only mounts once the lesson
  shell does).
- The profile-link specs (`friend-lesson-link`, `profile-visitor-lessons`) seed a
  synthetic profile but read the **real** config for the chain head, so they are
  retargeted to the twin's course id.
- The listing specs (`friend-courses`, `topic-pages`) assert the surviving course set:
  one listed friend course, and the tags the surviving courses carry.

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

### The new guard

`src/modules/courses/course-reference-guard.test.js` reads every spec in `tests/` and
holds the three rules above, so a spec that drifts back to a retired course — or that
waits for the config without clearing the gate — fails a unit test instead of a
30-second browser timeout.

## Verification

- **The unit suite is green**: 260 files, 3889 tests, 0 failures. `npm run lint` reports
  0 errors.
- **The browser suite**: the failures that remain were each run **before and after** the
  change with the same result — they are pre-existing (the absent local backend, the
  headless audio path, a layout assertion). The retargeting and the guest-gate fix
  removed the rest.
- The guard was proved able to fail: a spec that pointed at a retired course, and a spec
  that waited for `configData` without clearing the gate, each turn it red.

## Out of Scope

- The per-course *content* (the questions, the media) — only which configs exist and
  which course the suite exercises.
- The `friend` course's legacy two-lesson shape and the `wouldrather` six-lesson chain:
  both were development fixtures, and the one friend course that ships keeps the
  six-lesson a-f chain.
