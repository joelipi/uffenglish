# Extend friend-challenge lessons from an `a`/`b` pair to an `a`–`h` chain

## Context

Friend Challenge courses are ping-pong conversations: one participant records prompts (lesson `a`), the other answers them (`b`), the first answers those and asks new prompts (`c`), and so on. Today the code hardcodes the pair `a`/`b` in four places, so a course cannot progress past `b`:

- `src/modules/user/friend-lesson-link-logic.js` — `ASK_LESSON_ID='a'`, `ANSWER_LESSON_ID='b'`; `resolveFriendLessonLink` only fires after lesson `a` (or `askPublished`).
- `src/components/profile/FriendLessonLinksSection.jsx` — the profile link always targets `b`.
- `src/modules/notifications/notification-logic.js` — the friend-response notification only fires for `b`.
- `src/modules/user/friend-lesson-detection.js` — `FRIEND_LESSON_IDS = ['a','b']`.

`src/config/wouldrather.json` is the canonical friend config (route course id `wouldrather` — `AppLayout.jsx:20` fetches `/src/config/${routeCourseId}.json` and `appStore.courseId` is the route param, so clips are `{friendCode}wouldrather-<lessonId>-response-NN`).

**Friend mode must never auto-advance.** Lesson X+1 depends on the other participant's clips from X, which do not exist yet, so `nextLessonId` (single-user auto-advance, `lesson-progression.js:79`) is off-limits for the chain. The follow-up is the profile **share link** only: finishing lesson X records a link that points at lesson X+1. A player can be mid-chain with several people at once, at different lessons, so the profile must hold one link per lesson, each labelled with that lesson's title.

This story generalizes the chain to an arbitrary sequence of `recapOverlay: "shareCta"` lessons in `configData.lessons` order (`a → b → c → … → h`), adds route-only detection for `c…z`, generalizes the notification, renders multiple labelled profile links, and adds a sample config.

## Out of Scope

- `nextLessonId` and single-user auto-advance — unchanged; never read for friend lessons.
- `src/config/friend.json` (legacy). It keeps its content and `publishLessonId` steps, but the shared code no longer treats `askPublished` as a reason to create a link; its `b` is the last `shareCta` lesson, so no link follows it.
- `src/config/model.json` (`w`/`wa`/`wf`/`wfa`) beyond the generic code path. It happens to contain four `shareCta` lessons, so the generic chain rule will order them `w→wa→wf→wfa`; no model-specific code is written.
- R2 publish mechanics and `exportSegmentsToR2`'s return shape (`publishLessonId`/`askPublished` stay as they are).
- Video rendering, recap composition, and `FRIEND_VIDEO_REGEX`.
- Backfilling or migrating existing `friend_links` rows. Legacy entries (no `lessonId`) are ignored at render time and expire inside the 48h window.
- Native (`video-processor.native.jsx`) — dead code.
- No new dependency.

## Implementation approach

### 1. Friend chain = `shareCta` lessons in config order

Add a pure helper to `src/modules/user/friend-lesson-link-logic.js`:

```js
// The next lesson after `lessonId` in a friend course: the first later entry in
// configData.lessons whose recapOverlay is 'shareCta'. null when lessonId is not
// a shareCta lesson or no shareCta lesson follows it.
export function nextFriendLessonId(configData, lessonId) {
    const lessons = configData?.lessons;
    if (!Array.isArray(lessons)) return null;
    const index = lessons.findIndex((l) => l?.lessonId === lessonId);
    if (index === -1 || lessons[index]?.recapOverlay !== 'shareCta') return null;
    for (let i = index + 1; i < lessons.length; i++) {
        if (lessons[i]?.recapOverlay === 'shareCta') return lessons[i].lessonId;
    }
    return null;
}
```

`resolveFriendLessonLink` becomes:

```js
export function resolveFriendLessonLink({ configData, lessonId, courseId, shareCode, succeeded } = {}) {
    if (!succeeded || !shareCode || !courseId) return null;
    const nextId = nextFriendLessonId(configData, lessonId);
    if (!nextId) return null;
    const next = configData.lessons.find((l) => l.lessonId === nextId);
    const lessonTitle = typeof next?.title === 'string' ? next.title : '';
    return { courseId, lessonId: nextId, shareCode, lessonTitle };
}
```

The `askPublished` parameter is removed. Remove `ASK_LESSON_ID`/`ANSWER_LESSON_ID` exports (and their importers).

### 2. `friend_links` holds one entry per course+lesson

Entry shape: `{ courseId, lessonId, shareCode, addedAt, lessonTitle }`.

- `upsertFriendLinkMap(existing, entry)` keys by `${entry.courseId}:${entry.lessonId}` (fallback to `entry.courseId` when `lessonId` is absent, preserving any in-flight legacy entry until it expires). Same immutable-merge / non-object semantics as today.
- `listActiveFriendLinks(friendLinks, nowMs)` additionally drops entries with no non-empty `lessonId` or `shareCode`; the 48h `addedAt` window and newest-first sort are unchanged.
- `buildFriendLessonLink` / `toFriendLessonHref` / window helpers are unchanged.

### 3. Route-only detection covers `a`–`z`

`src/modules/user/friend-lesson-detection.js`: `FRIEND_LESSON_IDS = [...'abcdefghijklmnopqrstuvwxyz']`. `isFriendLesson` keeps its current shape (`?shareCode` or lesson id ∈ `FRIEND_LESSON_IDS`). This is deliberately route-only (per product decision) and extends the already-documented false positive for single-letter lesson ids in other courses (e.g. `gt2`, `t`) to all letters — record it in the Known Limitations.

### 4. Notification fires for every chain lesson that has a predecessor

`src/modules/notifications/notification-logic.js` `resolveFriendResponseNotification` keeps its guards (`succeeded`, `courseId`, config contains the lesson, recipient ≠ actor) and replaces the `lessonId === 'b'` gate with: an earlier `shareCta` lesson exists before `lessonId`. Extract a small pure predicate reusing the chain rule (e.g. `hasEarlierShareCtaLesson(configData, lessonId)`) so the answer lesson is "any chain lesson except the first".

### 5. Profile renders every active link, labelled

`src/components/profile/FriendLessonLinksSection.jsx` already maps `listActiveFriendLinks`. Change each link to use `entry.lessonId`, and label it with the lesson title:

- Add string key `profile_friend_lesson_link_titled` with the same locale set as `profile_friend_lesson_link` (en/es/pt/fr/hi/bn), e.g. en `"Practice English with Me — {title}"`. `Strings.get` already supports `{param}` interpolation (`profile_friend_link_available` uses `{time}`).
- Render `Strings.get('profile_friend_lesson_link_titled', lang, { title: entry.lessonTitle })`, falling back to the existing `profile_friend_lesson_link` when `lessonTitle` is empty.
- Keep the existing font/colour/underline styling and the `friend-lesson-link` / `friend-lesson-link-countdown` test ids (now possibly multiple per page).

### 6. Export wiring

`src/components/widgets/SuccessButtons.jsx` `runProcessing`: call `resolveFriendLessonLink({ configData, lessonId, courseId, shareCode: userData?.shareCode, succeeded: exportResult?.succeeded })` (drop `askPublished`). The returned `{ courseId, lessonId, shareCode, lessonTitle }` flows through `useAddFriendLinkMutation` which already merges with `upsertFriendLinkMap` and adds `addedAt` at the call site. Publish/link failures stay non-fatal.

## Tasks

### Task 1 - Pure friend-chain logic (`src/modules/user/friend-lesson-link-logic.js`)

- Given a config whose `lessons` are `[a(shareCta), b(shareCta), c(shareCta), d(shareCta)]`, `nextFriendLessonId(config, 'a')` → `'b'`; `'b'` → `'c'`; `'c'` → `'d'`; `'d'` → `null`.
- Given a config where a middle lesson is not `shareCta`, `nextFriendLessonId` skips it.
- Given `configData` null/undefined, a missing `lessonId`, or a `lessonId` that is itself not `shareCta`, `nextFriendLessonId` → `null`.
- `resolveFriendLessonLink` with `succeeded>0`, a `shareCode`, a `courseId`, and a next lesson → `{ courseId, lessonId: <next>, shareCode, lessonTitle }` where `lessonTitle` is the next lesson's string `title` (or `''` when it is not a string).
- `resolveFriendLessonLink` → `null` when `succeeded` is 0/falsy, `shareCode`/`courseId` is empty, the lesson has no next, or `configData` is missing.
- `upsertFriendLinkMap` keys by `courseId:lessonId`: two entries with the same `courseId` and different `lessonId` both survive; a second entry with the same `courseId:lessonId` replaces the first; a `null`/`{}` map yields a one-key map; input is not mutated.
- `listActiveFriendLinks` excludes entries with no `lessonId` and with no `shareCode`, keeps entries inside the 48h window, drops entries at/after the boundary, and sorts newest-first.

### Task 2 - Route-only detection (`src/modules/user/friend-lesson-detection.js`)

- `FRIEND_LESSON_IDS` equals `['a','b','c',…,'z']`.
- `isFriendLesson({ pathname: '/course/wouldrather/lesson/c' })` → `true`; `…/lesson/h` → `true`; `…/lesson/z` → `true`.
- `isFriendLesson({ pathname: '/course/model/lesson/test' })` → `false` (multi-char id).
- `isFriendLesson({ search: '?shareCode=x', pathname: '/course/anything/lesson/zz' })` → `true`.
- `isFriendLesson` for `/`, `{}`, and `undefined` → `false`.

### Task 3 - Notification generalization (`src/modules/notifications/notification-logic.js`)

- Config `[a(shareCta), b(shareCta), c(shareCta)]` + `lessonId: 'c'`, distinct recipient/actor, `succeeded>0` → `{ recipientShareCode, courseId, lessonId: 'c' }`.
- Same config + `lessonId: 'a'` (first chain lesson) → `null`.
- `lessonId` not in the config, or the config has no earlier `shareCta` lesson before it → `null`.
- Existing guards still hold: `succeeded` falsy, missing `recipientShareCode`, self-notification (case-insensitive), missing `courseId`, missing config → `null`.
- `normalizeShareCode` lowercases/trims the recipient in the returned payload.

### Task 4 - Export wiring (`src/components/widgets/SuccessButtons.jsx`)

- Source guard (block-scoped, not whole-file): the `resolveFriendLessonLink({ … })` call passes `configData`, `lessonId`, `courseId`, `shareCode: userData?.shareCode`, `succeeded: exportResult?.succeeded`, and no longer passes `askPublished`.
- The resolver's result is still recorded through `friendLinkMutation.mutateAsync({ userId, entry: { ...payload, addedAt } })`, and the whole publish/link block remains wrapped so a failure is non-fatal (`'R2 publish / friend link failed (non-fatal)'` stays).

### Task 5 - Multiple labelled profile links (`src/components/profile/FriendLessonLinksSection.jsx`)

Add `src/components/profile/FriendLessonLinksSection.test.jsx` rendered with `react-dom/client` `createRoot` + `act` (the existing convention — see `src/components/modals/GuestLoginModal.web.test.jsx`), passing a `friendLinks` fixture via props; no data-layer or router needed.

- Given two active entries (different `lessonId`, distinct `lessonTitle`), the section renders two `data-testid="friend-lesson-link"` anchors, each `href` pointing at its own `entry.lessonId` (`https://ultrafastfluency.com/course/<courseId>/lesson/<lessonId>?shareCode=<shareCode>`), and each label containing its own title.
- Given an entry with an empty `lessonTitle`, that link's label equals `Strings.get('profile_friend_lesson_link', lang)` (no title).
- Given only expired entries, no `friend-lesson-link` renders; given no entries, the section returns null.
- Each link still shows its own countdown element (`friend-lesson-link-countdown`) derived from `entry.addedAt`.

### Task 6 - Sample config `src/config/friendchain.json` (+ `src/config/friendchain.test.js`)

Copy `wouldrather.json` to `src/config/friendchain.json`, set `"courseId": "friendchain"`, and extend the chain to `a`–`h`. Mirror `wouldrather`'s step shapes and reuse its system-video slugs (`testvideointro`, `testvideoa01-03`, `wouldratherb01-03`, `enda`) rather than inventing media. Every lesson is `recapOverlay: "shareCta"`; `a` is `recapSources: "none"`, `b`–`h` are `recapSources: "friend"`.

Publish indices (position-based, `assignSegmentTargets`): a lesson's recorded clips are numbered `-response-01..NN` in step order, so answers come first and prompts second.

- Lesson `a`: 3 prompt recording steps → clips `friendchain-a-response-01..03`.
- Lesson `b`: plays `{friendCode}friendchain-a-response-01..03`; records 3 answers (`friendchain-b-response-01..03`); re-records the SAME prompts as `a` (`friendchain-b-response-04..06`); `success`.
- Lessons `c`–`h`: play the previous lesson's prompt clips `{friendCode}friendchain-<prevLessonId>-response-04..06`; record 3 answers (`<lessonId>-response-01..03`); record 3 brand-new prompts (`<lessonId>-response-04..06`); `success`.
- Test: `friendchain.json` has lessons `['a',…,'h']` in that order; every lesson is `shareCta`; `a` has `recapSources: 'none'` and `b`–`h` have `'friend'`; `b` has `viewAndContinue` steps referencing `friendchain-a-response-01..03`; each of `c`–`h` references `friendchain-<prev>-response-04..06`; every `viewAndContinue` in `b`–`h` uses a `{friendCode}` slug; each lesson `b`–`h` has exactly 3 answer steps and 3 prompt steps.
- The generic guards in `src/modules/video/model-config.test.js` (recap-flag validity, friend-slug ⇒ `recapSources: 'friend'`) pass for the new file.

### Task 7 - Update tests that assert the old `a`/`b` contract

- `src/modules/user/friend-lesson-link-logic.test.js`: drop `ASK_LESSON_ID`/`ANSWER_LESSON_ID`, the "fixed mapping constants" block, and `askPublished` cases; add the Task 1 cases.
- `src/modules/user/friend-lesson-detection.test.js`: import nothing from link-logic for the id list; assert `a`–`z` (Task 2).
- `src/config/friend-lesson-link-config.test.js`: replace the fixed `a→b` premise with the `shareCta`-order rule; assert `wouldrather`/`friend` chain `a→b→(null)` and that a config with no `shareCta` lessons yields no next.
- `src/modules/user/friend-lesson-link-wiring.test.js` and `src/modules/notifications/notification-wiring.test.js`: update the `askPublished` assertions to the new `resolveFriendLessonLink` call shape.
- `tests/friend-lesson-link.spec.js`: fixtures gain `lessonId`/`lessonTitle`; assert the link `href` targets the entry's `lessonId` and the label includes the title; add a two-entry case.

## Notes

- **Chain rule relies on `recapOverlay: "shareCta"`.** Every friend lesson in the canonical configs already carries it (`wouldrather`, `friendchain`, `friend`, `test`: 2 each). A friend lesson without it will not chain; document this in the config contract.
- **`lessonTitle` is captured at export time (a string).** `normalizeConfig` collapses `lesson.title` to a string in the exporter's language, and `PublicProfile` renders with the profile owner's language, so storing the string keeps the label in the right language without a per-link config fetch.
- **Detection is intentionally route-only** (product decision). Extending `FRIEND_LESSON_IDS` to `a`–`z` widens the existing false positive: single-letter lessons in other courses (`gt2` `a`/`x`/`s`/`t`, `t` `t`/`y`) are now treated as friend lessons (video-only, low-friction guest flow). Add this to `docs/product.md` Known Limitations.
- **Legacy `friend_links` entries** (no `lessonId`) disappear from the profile and expire within 48h; no migration is written.
- **No new dependency**; tests use the existing vitest + jsdom setup. Playwright specs use real Chrome (see `agents.md` §5).
- **Preview/verify:** after implementing, open `/course/friendchain/lesson/a`, complete it, and confirm the profile link records `friendchain`/`b` with the lesson title; then open lesson `b` via that link and confirm its follow-up link points at `c`.
