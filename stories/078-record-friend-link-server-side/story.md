# The follow-up friend link is recorded server-side, so it can no longer be lost silently

## Context

A learner finished a friend lesson and sent the link to their friends. Their own
public profile (`/:shareCode`) said the opposite: **"All this user's lessons have
expired after 48 hours"**, so there was no link to click, and the link the
learner had just sent led nowhere.

The data said something different. The learner (`share_code = qm3zv`) had:

| what | value |
| --- | --- |
| `friend_links` | **one** entry, `wouldyourather:a`, `addedAt = 2026-10-18T05:50Z` — expired 48h later, at 2026-10-20T05:50Z |
| `counted_lessons` | `wouldyourather_a`, `wouldyourather-test_a`, `wouldyourather-test_b` (three lessons completed) |
| R2 clips | `qm3zv-qm3zv-wouldyourather-test-a-01..03.mp4` + `-complete.mp4` (2026-10-19 16:21) and `qm3zv-d38bj-wouldyourather-test-b-01..02.mp4` (2026-10-20 05:39) |

So the **clips were published** — the publish block ran — but **no link entry was
ever written** for either of those two completions. Another learner's map
(`d38bj`) from the same hours holds two entries written by the same code, so
this was not a global outage.

The write was a **client-side read-modify-write of a whole JSONB column**:

```js
// src/modules/api/api.js (before)
const { data: row } = await supabase.from('user_profiles').select('friend_links').eq('id', userId).single();
const merged = upsertFriendLinkMap(row?.friend_links, entry);
await supabase.from('user_profiles').update({ friend_links: merged }).eq('id', userId);
```

Two failure modes lose that link **without any error reaching the app**:

1. **A zero-row UPDATE is not an error in PostgREST.** When the row is filtered
   out (RLS, a stale id, a session that no longer carries the row), the write
   does nothing and the mutation reports success. Nothing is logged, nothing is
   shown to the learner.
2. **The read is a second round trip** that can fail on its own, and the whole
   write is then skipped.

Either way the learner's profile silently loses the link they are about to
share. The `friend_links` map is also written whole, so two lessons recorded in
parallel can overwrite each other.

The sibling write in the same flow — `record_friend_completion` (migration 007)
— is already server-side, SECURITY DEFINER, and demonstrably reaches the same
row in the same session. The link write was the odd one out.

## Out of Scope

- **The 48h window** (render-time), the link shape, and the chain rules — all
  unchanged.
- **The public profile's visitor-aware rendering** (story 064): the chain-head
  filter and the featured-first ordering stay as they are.
- **Backfilling links that were already lost.** A record is created when a
  lesson is recorded; the migration does not invent history.
- **Merging into `main`.**

## Implementation approach

### 1. Move the merge to the server (migration 011)

`record_friend_link(p_course_id, p_recorded_lesson_id, p_next_lesson_id,
p_course_name, p_lesson_title)`:

- **SECURITY DEFINER** with `set search_path = ''`, like `record_friend_completion`.
- **The owner is the caller** (`auth.uid()`): the client cannot write to another
  user's row, and it no longer has to know its own user id — the failure mode
  where the client targets the wrong (or no) row disappears with it.
- **One atomic statement**: `jsonb_set(coalesce(friend_links,'{}'), key, entry, true)`
  merges the entry in place. No read, no read-modify-write, no lost update when
  two lessons are recorded in parallel.
- **The share code is read from the caller's own row**, so a client cannot forge
  a link for somebody else.
- **The key is `courseId:recordedLessonId`** — one entry per recorded lesson,
  the same key the client used. A re-record replaces the entry and refreshes
  `addedAt`, which restarts the 48h window exactly as before.
- **A failure is an error**, never a silent no-op. An unauthenticated call
  raises (`28000`).

### 2. The client calls the RPC and retries

`useAddFriendLinkMutation` calls `supabase.rpc('record_friend_link', …)` with
the entry fields, throws on an error, and retries twice (the mutation's
`retry`/`retryDelay`). The merge is atomic and idempotent, so a retry is safe:
it refreshes `addedAt`, like a re-record does. The success screen's existing
non-fatal `try/catch` is unchanged — a failed link must never break the video
the learner just made — but the failure is now an error in the console rather
than a silent no-op.

The client no longer sends `userId`: the owner comes from the session.

### 3. The client-side merge helper is gone

`upsertFriendLinkMap` existed only for the read-modify-write. The key/merge
rule now lives in the migration and is guarded by a static test
(`friend-link-write-migration.test.js`), next to the migration guard the repo
already has for `007_friend_credit.sql`.

## Tasks

- new `supabase/migrations/011_record_friend_link.sql`
  → the SECURITY DEFINER RPC (atomic merge, owner = `auth.uid()`)
- `src/modules/api/api.js`
  → `useAddFriendLinkMutation` calls the RPC; `retry: 2`; the client-side
    merge and its import are gone
- `src/components/widgets/SuccessButtons.jsx`
  → the mutation call passes the entry only (no `userId`)
- `src/modules/user/friend-lesson-link-logic.js`
  → `upsertFriendLinkMap` removed (the merge is server-side now)
- new `src/modules/api/friend-link-write-migration.test.js`
  → static guard for the migration's security shape
- `src/modules/user/friend-lesson-link-wiring.test.js`
  → the wiring guard asserts the RPC call, the retry, and the absence of the
    client-side read-modify-write

## Acceptance criteria

1. the follow-up link is written through the server-side RPC, not a client
   read-modify-write
   → `friend-lesson-link-wiring.test.js` asserts the RPC call and that the
     client-side merge is gone
2. the write targets the CALLER's own row (the client cannot write to another
   user's row and does not have to know its own user id)
   → the migration guard asserts `auth.uid()` / `where p.id = v_actor`; the
     wiring guard asserts the call site passes no `userId`
3. the merge is atomic and idempotent (a re-record replaces the entry and
   refreshes `addedAt`; two recorded lessons keep one entry each)
   → the migration guard asserts the `jsonb_set` merge and the key rule; the
     RPC was exercised against the live database as the `authenticated` role
     (one entry per recorded lesson, `addedAt` refreshed on a repeat call, an
     unauthenticated call raising `28000`)
4. a failed write is an error the app can see and retry, not a silent no-op
   → the mutation throws on an RPC error and retries twice; the wiring guard
     asserts the retry
5. the recorded entry keeps the shape the public profile renders
   → the migration guard asserts every rendered field and the ISO `addedAt`
   format
6. `npx vitest run` reports 0 failures; `npm run build` and `npm run lint` exit
   0
   → commands and output recorded in the completion report

## Notes for reviewers

- **The migration must be applied BEFORE the client ships.** The client calls
  the RPC by name; a client deployed against a database without the function
  would fail every link write. It is applied and recorded in
  `supabase_migrations.schema_migrations` (version 011) before the branch is
  pushed.
- **The security shape mirrors `007_friend_credit.sql` on purpose**: SECURITY
  DEFINER, locked `search_path`, `auth.uid()` as the actor, execute granted to
  `authenticated` only, no new table and no new RLS policy.
- **The link's owner is the learner**, so the RPC can only ever write the
  caller's own row — the client cannot point the write at somebody else.
