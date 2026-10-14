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

- New `buildVisitorPracticeView({ friendLinks, nowMs, viewer, chainHeads })` returns the existing `{ mode, groups, isTicking }` shape so the component contract is unchanged; entries gain a `completedTogether` boolean. `viewer` is null for logged-out visitors.
- `chainHeads` is a `Map<courseId, firstLessonId>`, built by fetching ONLY the courses present in the owner's `friendLinks` (`fetch('/src/config/<courseId>.json')` — the same single fetch `AppLayout.jsx` performs per course) and applying `firstFriendLessonId(config)` (already exported from `friend-courses-logic.js`). Do NOT use `loadConfigEntries`: it `await`s every module loader in the glob before the caller can filter (`friend-course-configs.js:52`), so it would fetch and parse all 572KB of configs (gt2 alone is 336KB) on a public page.
- Shapes, exactly as the code exposes them (the naming mix is deliberate — `fromDbRow` maps `share_code`→`shareCode` but leaves `counted_lessons` snake):
  - owner (from `useUserByShareCode`): `{ friendLinks, share_code }` (entry: `{ courseId, courseName, recordedLessonId, lessonId, shareCode, addedAt, lessonTitle }`);
  - viewer: `{ shareCode, counted_lessons }` (camel `shareCode`, snake `counted_lessons` — do not confuse them) plus the inbox rows;
  - inbox row (from `useNotifications`): `{ course_id, lesson_id, payload: { actorShareCode }, created_at }`.
- Featuring-visitor set, newest-first (the existing `listActiveFriendLinks` sort is stable, so partition it, do not re-sort):
  - inbox direction: visitor inbox `friend_response` row with `normalizeShareCode(row.payload.actorShareCode) === normalizeShareCode(ownerShareCode)` (import `normalizeShareCode` from `src/modules/notifications/notification-logic.js`) and `(row.course_id, row.lesson_id) === (entry.courseId, entry.recordedLessonId)`;
  - recorder direction: visitor `counted_lessons` key `${entry.courseId}_${entry.recordedLessonId}` (first-underscore split, existing convention).
- Both directions key on `entry.recordedLessonId` — the lesson the OWNER completed — deliberately, NOT `entry.lessonId` (the follow-on the visitor plays). The friend's link points at the follow-on (`buildFriendLessonLink` uses `entry.lessonId`), so the owner completes `entry.lessonId` and both their notification row and their `counted_lessons` key record THAT lesson, which they then store as their own `recordedLessonId`. Walk (friendchain a→b→c): the viewer (owner of the link) records lesson `a` → their entry is `{recordedLessonId:'a', lessonId:'b'}`; the owner opens that link, plays `b`, records → the viewer's inbox gets `{course, lesson_id:'b'}` and the owner's own entry becomes `{recordedLessonId:'b', lessonId:'c'}`. So the viewer's row `lesson_id:'b'` matches the owner's `recordedLessonId:'b'`. Matching on `entry.lessonId` would compare `'b'` to `'c'` and find nothing.
- `completedTogether` is exactly the recorder-direction match above, applied to every listed entry regardless of group.
- `a`-lesson filter, literally: keep an entry when `chainHeads.has(entry.courseId) ? entry.recordedLessonId === chainHeads.get(entry.courseId) : true` (a course absent from the map — config fetch failed — fails open to include). An entry that is both featuring and an `a` lesson appears once, in the featuring group.
- `buildFriendPracticeView` is kept unchanged (it still backs the existing unit tests) and `buildVisitorPracticeView` delegates to it when `viewer` is null and `chainHeads` is empty.
- Banner renders only for logged-out visitors when `mode === 'active'` (there is something to anchor to and something login could reorder). Login href is `/login?redirect=${encodeURIComponent('/' + shareCode)}` (existing `?redirect=` contract). The entire guest line is one anchor to `#friend-lesson-links`; the section wrapper gains `id="friend-lesson-links"`. Copy uses the profile language (`lang` prop, existing convention).
- Viewer context in `PublicProfile.jsx`: `useAuthStatus()` for logged-in, `useUserProfile()` for `shareCode`/`counted_lessons` (guest stub has `$id: 'guest'` — treat as logged out), `useNotifications(viewerId)` for the inbox (already guest-disabled). No new fetches beyond the inbox query.
- Prop contract: `FriendLessonLinksSection` keeps `(friendLinks, lang)` and gains `shareCode` (the owner's, from `PublicProfile`'s route param — it drives the banner's login redirect) plus optional `viewer` (default null) and `chainHeads` (default empty `Map`); internally it calls `buildVisitorPracticeView({ friendLinks, nowMs: now, viewer, chainHeads })` instead of `buildFriendPracticeView`. Missing fields default inside the logic module (`viewer.counted_lessons ?? []`, inbox `?? []`, `chainHeads ?? new Map()`).

## Tasks

### Task 1 - Visitor prioritization logic

- logged-out viewer (viewer null) + mixed active entries
  - → only chain-head entries listed, newest first
  - → entries carry `completedTogether: false`
- logged-out viewer + course missing from chainHeads
  - → entry included (fail-open)
- logged-in viewer + inbox row `(course C, lesson_id M)` + owner active entry `(courseId C, recordedLessonId M)`
  - → entry in featuring group, ahead of `a` lessons
- logged-in viewer + counted key `C_M` + owner active entry `(courseId C, recordedLessonId M)`
  - → entry in featuring group with `completedTogether: true`
- logged-in viewer + owner entry `(courseId C, recordedLessonId R)` where the viewer's inbox/counts only mention `entry.lessonId` (the follow-on)
  - → entry is NOT featuring (the join is on `recordedLessonId`, never `lessonId`)
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
  - → prioritized groups render per Task 1 (Playwright, following `tests/friend-lesson-link.spec.js`: fixed clock, owner profile injected at `['user','profile','shareCode', code]`, viewer injected at `['user','profile']`, logged-in at `['auth','status']` → true, inbox at `['notifications', viewerId]`)
- logged-out visitor on `/:shareCode`
  - → banner renders; login link href starts with `/login?redirect=` and decodes to the profile path; guest anchor href is `#friend-lesson-links`
- `npx vitest run src/data/strings.test.js`
  - → passes with the three new keys (`profile_login_to_see_together`, `profile_guest_start_free`, `profile_completed_together`) carrying en + hi + bn

## Notes

- Explicit assumptions (user-approved as reviewable defaults): banner only in active mode; fail-open include on missing config; `publishLessonId` cross-posted completions do not match; the whole guest line is one anchor; no special-casing when the viewer is the owner (self-overlap badges are harmless); the expired-mode copy is unchanged even when only filtered-out non-`a` links exist.
- Banner copy (verbatim): line 1 is a single link "Log in to see lessons you've done together."; line 2 is a single anchor "No account yet? You can start practicing free."
- `hi`/`bn` translations must be added for the three keys; the suite enforces script presence, not quality.
