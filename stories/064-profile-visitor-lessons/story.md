# Public profile prioritizes lessons shared with the visitor

## Context

The public profile (`/:shareCode`, `PublicProfile.jsx`) lists the owner's friend-challenge links through `buildFriendPracticeView`, which keeps every entry inside the 48h window with no other filter — and a link is minted for every shareCta lesson with a later shareCta lesson after it. So a visitor sees all lessons the owner completed in the last 48h, with no notion of which ones involve them. Meanwhile the notifications inbox already resolves per-visitor access (`collectFriendActorCodes` + `buildFriendLinksMaps` in `continue-logic.js`), but the profile page never uses it: `PublicProfile` reads zero viewer state.

This story makes the profile visitor-aware at read time (no write-path, expiry, or countdown changes): logged-out visitors see only the chain-head (`a`) lessons plus a login/guest banner; logged-in visitors see lessons featuring them first, then the `a` lessons, with joint completions badged.

## Out of Scope

- Write-path changes: link creation (`resolveFriendLessonLink`), the 48h expiry rule, and countdown rendering are untouched.
- Notification content, delivery, or mark-read behavior.
- Translations beyond what `strings.test.js` enforces (en + hi + bn per new key).
- `UserProfile.jsx` (private profile) and `UserProfile.native.jsx`.
- Republish cross-posting (`publishLessonId`): a visitor completion recorded under a different lesson than the owner's entry does not match (documented assumption below).

## Implementation approach

Pure logic stays in `src/modules/user/friend-lesson-link-logic.js` (fully unit-testable, no React/store); `PublicProfile.jsx` assembles viewer context; `FriendLessonLinksSection.jsx` renders banner, badge, and anchor. Key decisions:

- New `buildVisitorPracticeView({ friendLinks, nowMs, viewer, chainHeads })` returns the existing `{ mode, groups, isTicking }` shape so the component contract is unchanged; entries gain a `completedTogether` boolean. `viewer` is null for logged-out visitors. `chainHeads` is a `Map<courseId, firstLessonId>` built by the caller from `loadConfigEntries` (filtered to friend courses via `isFriendCourse`) + `firstFriendLessonId`, both already exported from `friend-courses-logic.js`. Configs load as lazy chunks (existing `import.meta.glob` pattern); only friend courses are parsed (~236KB worst case, gt2's 336KB never loads).
- Featuring-visitor set, newest-first (the existing `listActiveFriendLinks` sort is stable, so partition it, do not re-sort):
  - inbox direction: visitor inbox `friend_response` row with `normalizeShareCode(row.payload.actorShareCode) === normalizeShareCode(ownerShareCode)` (import `normalizeShareCode` from `src/modules/notifications/notification-logic.js`) and `(row.course_id, row.lesson_id) === (entry.courseId, entry.recordedLessonId)`;
  - recorder direction: visitor `counted_lessons` key `<courseId>_<lessonId>` (first-underscore split, existing convention) with `(courseId, lessonId) === (entry.courseId, entry.recordedLessonId)`.
- `completedTogether` is exactly the recorder-direction match above, applied to every listed entry regardless of group.
- `a`-lesson filter: `entry.recordedLessonId === chainHeads.get(entry.courseId)`. Missing config for a course (load failure) fails open to include. An entry that is both featuring and an `a` lesson appears once, in the featuring group.
- Banner renders only for logged-out visitors when `mode === 'active'` (there is something to anchor to and something login could reorder). Login href is `/login?redirect=${encodeURIComponent('/' + shareCode)}` (existing `?redirect=` contract). The entire guest line is one anchor to `#friend-lesson-links`; the section wrapper gains `id="friend-lesson-links"`. Copy uses the profile language (`lang` prop, existing convention).
- Viewer context in `PublicProfile.jsx`: `useAuthStatus()` for logged-in, `useUserProfile()` for `shareCode`/`counted_lessons` (guest stub has `$id: 'guest'` — treat as logged out), `useNotifications(viewerId)` for the inbox (already guest-disabled). No new fetches beyond the inbox query.
- Prop contract: `FriendLessonLinksSection` keeps `(friendLinks, lang)` and gains optional `viewer` (default null) and `chainHeads` (default empty `Map`); internally it calls `buildVisitorPracticeView({ friendLinks, nowMs: now, viewer, chainHeads })` instead of `buildFriendPracticeView`. Missing fields default inside the logic module (`countedLessons ?? []`, inbox `?? []`).

## Tasks

### Task 1 - Visitor prioritization logic

- logged-out viewer (viewer null) + mixed active entries
  - → only chain-head entries listed, newest first
  - → entries carry `completedTogether: false`
- logged-out viewer + course missing from chainHeads
  - → entry included (fail-open)
- logged-in viewer + inbox row from owner for (C, L) + owner active entry (C, recorded L)
  - → entry in featuring group, ahead of `a` lessons
- logged-in viewer + counted key `C_L` + owner active entry (C, recorded L)
  - → entry in featuring group with `completedTogether: true`
- logged-in viewer + entry both featuring and chain-head
  - → listed once, in featuring group
- logged-in viewer + no featuring entries
  - → `a` lessons only, identical to logged-out output plus `completedTogether` flags
- expired/empty input
  - → `{ mode: 'expired', groups: [], isTicking: false }`, unchanged shape

### Task 2 - Banner, badge, and anchor in the section

- logged-out visitor + active mode
  - → banner `[data-testid="visitor-login-banner"]` renders above the heading with login link `[data-testid="visitor-login-link"]` and guest anchor `[data-testid="visitor-guest-link"]`
  - → section wrapper carries `id="friend-lesson-links"`
- logged-in visitor, or expired mode
  - → no banner rendered
- entry with `completedTogether: true`
  - → badge `[data-testid="friend-lesson-link-completed"]` renders under the countdown line
- entry with `completedTogether: false` or absent
  - → no badge rendered, existing countdown markup byte-identical

### Task 3 - PublicProfile wiring and strings

- logged-in visitor on another user's `/:shareCode` with overlapping history
  - → prioritized groups render per Task 1 (Playwright: inject owner profile + viewer profile + inbox fixtures via the `friend-lesson-link.spec.js` cache-injection pattern with a fixed clock)
- logged-out visitor on `/:shareCode`
  - → banner renders; login link href starts with `/login?redirect=` and decodes to the profile path; guest anchor href is `#friend-lesson-links`
- `npx vitest run src/data/strings.test.js`
  - → passes with the three new keys (`profile_login_to_see_together`, `profile_guest_start_free`, `profile_completed_together`) carrying en + hi + bn

## Notes

- Explicit assumptions (user-approved as reviewable defaults): banner only in active mode; fail-open include on missing config; `publishLessonId` cross-posted completions do not match; the whole guest line is one anchor; no special-casing when the viewer is the owner (self-overlap badges are harmless); the expired-mode copy is unchanged even when only filtered-out non-`a` links exist.
- Banner copy (verbatim): line 1 is a single link "Log in to see lessons you've done together."; line 2 is a single anchor "No account yet? You can start practicing free."
- `hi`/`bn` translations must be added for the three keys; the suite enforces script presence, not quality.
