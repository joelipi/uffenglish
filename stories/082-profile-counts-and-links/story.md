# A finished lesson is counted on the profile, and the profile shows every link the learner recorded

## Context

A learner finished a lesson (their clips were published to R2 and the follow-up
link was written to their profile) and their own public profile said they had
**completed nothing** and offered **no link** for their friends to practise
along with.

Two separate defects, both visible on `/:shareCode`:

### 1. The profile hid the links it had

The learner's `friend_links` map held a **fresh** entry — `wouldyourather:b`,
written at the moment their clip was published (2026-10-20T17:08:02Z, half an
hour before the report) — and the profile still rendered **"All this user's
lessons have expired after 48 hours"**.

The reason is the chain-head filter in `buildVisitorPracticeView`: an entry was
listed only when its `recordedLessonId` was the course's **first** shareCta
lesson. A learner who recorded the *follow-up* lesson (`b`, `c`, …) — which is
exactly what the ping-pong chain produces — had every one of their links
filtered out, and the section then reported "expired" because it had nothing
left to show.

That also breaks the chain itself: the partner who opens the profile to find
the next lesson cannot see it, so the chain stops there. The profile holds one
link per recorded lesson (stories 043/044); the filter narrowed that back to one
link per course.

### 2. The completion counters were never written

The same learner's row had `lessons_completed = 0`, `counted_lessons = []` and
`completed_dates = []` — and so did every other learner's row whose counters
were written by the client. The write was a **client-side read-modify-write of
the whole row**:

```js
const baseline = Math.max(userData.lessons_completed, store.lessonsCompleted);
const completion = nextLessonCompletion({ ... baseline ... });
metaToUpdate.lessons_completed = completion.lessonsCompleted;
await supabase.from('user_profiles').upsert({ id: userId, ...metaToUpdate });
```

Three ways to lose it, none of them visible to the learner:

- the whole write sat behind `if (updateUserMetaFlag && userData)` — with no
  profile copy in the store yet, the completion was **skipped entirely** (no
  count, no completion day);
- the baseline came from a **store copy** that may not match the row, so the
  increment could be lost or could go backwards;
- a zero-row upsert is **not an error in PostgREST** — the write can do nothing
  and still report success.

The learner only learns about it by looking at their own profile, which says
they finished nothing.

## Out of Scope

- **The 48h window** and the link's shape — unchanged.
- **The phantom guard**: landing on the success step directly (a page load, a
  reload, a signup redirect) is still not a completion ✓.
- **The fluency average** — still admits only a lesson's first completion ✓ (the
  server now answers that).
- **The guest flow**: a guest has no session, so its completion stays local
  until the signup credit applies it ✓ (unchanged).
- **Merging into `main`.**

## Implementation approach

### 1. The counters are written server-side (migration 012)

`record_lesson_completion(p_course_id, p_completed_lesson_id)` — SECURITY
DEFINER, `set search_path = ''`, the learner is `auth.uid()`:

- **one statement**: the pre-update state and the update share a snapshot, so
  the increment is atomic and the **row is the baseline** (no client baseline,
  no lost update between two completions);
- `counted_lessons` stays the **unique** set of completed lessons and
  `completed_dates` the unique set of active days;
- it returns the resulting counters (`lessons_completed`, `counted_lessons`,
  `completed_dates`, `is_first_completion`, `day_added`) so the client updates
  its store from the server's answer instead of guessing;
- a failure is an **error** the caller sees, never a silent no-op.

The client's own write keeps the resume state, the lesson scores and the
fluency average — and no longer carries the counters, so a stale client copy
can never overwrite the server's row. The completion is recorded **before** the
`updateUserMetaFlag && userData` gate, so it no longer depends on the store
holding a profile copy.

### 2. The profile lists every link the learner recorded

`buildVisitorPracticeView` drops the chain-head filter: **every active link**
is listed (newest first), and the links the visitor took part in still come
first, with the "completed together" badge. The chain-head machinery goes with
it (`useFriendChainHeads` and the per-course config fetch it triggered are
gone — a public page no longer pulls course configs it does not need).

## Tasks

- new `supabase/migrations/012_record_lesson_completion.sql` (applied to the
  live database and recorded as version 012)
- `src/modules/api/api.js` → `recordLessonCompletion({ courseId, completedLessonId })`
- `src/modules/user/user-profile.js` → the counters come from the RPC; the
  client's write no longer carries them
- `src/modules/user/friend-lesson-link-logic.js` → the chain-head filter is
  gone from the visitor view
- `src/components/profile/FriendLessonLinksSection.jsx` +
  `src/components/profile/PublicProfile.jsx` → the `chainHeads` prop and the
  hook that fed it are gone (`src/hooks/useFriendChainHeads.js` deleted)
- tests: the migration guard, the write-shape guard, the visitor view, the
  completion counts

## Acceptance criteria

1. the profile lists EVERY link the learner recorded, not only the course's
   first lesson
   → the visitor-view test asserts a link for a non-first lesson is listed, and
     the component no longer takes a `chainHeads` prop
2. a finished lesson is counted on the learner's own profile
   → the completion test asserts the RPC is called with the course and the
     COMPLETED lesson, and the client's write carries no counters
3. the counters are written server-side, off the row's own values
   → the migration guard asserts the atomic single-statement increment, the
     unique sets and the `auth.uid()` actor; the RPC was exercised against the
     live database (a repeat completion counts again, the counted set and the
     day ledger stay unique)
4. the completion is recorded even when the store has no profile copy
   → the write guard asserts the RPC call sits BEFORE the
     `updateUserMetaFlag && userData` gate
5. a phantom completion is still not counted
   → the write guard asserts the `incrementCount` guard is still applied
6. `npx vitest run` reports 0 failures; `npm run build` and `npm run lint` exit
   0
   → commands and output recorded in the completion report

## Notes for reviewers

- **The two defects are independent**: the link was written and then hidden; the
  counters were never written. Fixing only the render would still leave the
  profile saying "0 lessons completed".
- **The migration must be applied BEFORE the client ships** (the client calls
  the RPC by name). It is applied and recorded as version 012.
- **A guest still counts nothing until it signs up** — that is the existing
  signup-credit path, unchanged.
