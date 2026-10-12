# Friend-aware Continue on /home

## Context

The `/home` Continue button today resumes the persisted zustand tuple verbatim: `canContinue = !!courseId && !!activeLessonId` navigates to ``/course/${courseId}/lesson/${activeLessonId}`` with no `?shareCode=`, no friend-link awareness, and no expiry check (`src/components/homescreen/HomeScreen.jsx:21,190-197`). For single-user courses that link is correct and must not change. For friend (`recapOverlay: "shareCta"`) chain lessons it re-enters a response lesson solo: only the first chain lesson (`a`) is startable without `?shareCode=` (`firstFriendLessonId`, `src/modules/courses/friend-courses-logic.js`), later lessons embed `{friendCode}` clips (e.g. `{friendCode}wouldrather-a-response-01`, `src/config/wouldrather.json:109,113`) that 404 without a code, and the resume bypasses the 48-hour R2/friend-link window (`SHARE_WINDOW_HOURS = 48`, `src/modules/video/video-processor-logic.js:66`). Concrete break: finishing `b` through a friend link persists `activeLessonId = "b"` (`saveLessonProgress(courseId, nextLessonId || completedLessonId)` in `src/modules/lesson/step-loader-logic.js:183`, `appStore.setState({ activeLessonId })` in `src/modules/user/user-profile.js:95`), so Continue re-opens `b` with no asker clips. Friend mode never auto-advances and `nextLessonId` is single-user-only, so no existing progression path repairs this. This story makes Continue friend-aware: a shareCTA resume first tries the oldest still-live (< 48h) friend response lesson as a direct lesson deep-link with `?shareCode=`, falls back to a stable random unstarted friend course's `a` lesson, then to a started non-friend resume, else hides. The non-friend resume path stays byte-for-byte identical.

On friend (`shareCta`) success rows the screen is Share-only today (`SuccessScreen.jsx:85` renders `ContinueButton` only for non-friend lessons): after exporting, the learner's only onward path is leaving for `/home`. This story adds the missing onward step there and only there — on a friend row, tapping Share (share sheet displayed on mobile, download started elsewhere) starts a 3-second timer, after which the existing Continue button appears in the same row next to Share. Non-friend success rows keep today's behavior exactly (Continue revealed at video-ready, no timer).

## Out of Scope

- Changing `FriendCoursesView` cards (they already link `/course/<id>/lesson/a`, the only solo-startable friend entry), the notification bell/profile links (they link to `/<shareCode>` profiles by design), the success-screen buttons, or any lesson player behavior.
- Any new Supabase migration, table, column, RPC, RLS policy, or `wrangler.toml` var; all reads reuse permitted paths (`user_notifications` recipient-only select, `public_profiles` view exposing `friend_links`).
- Any new npm dependency or workflow change.
- Countdown display on the Continue button; expiry is a render-time filter only, matching the profile links.
- Trusting the notification row's `course_id`/`lesson_id` for the href; the href always comes from the friend's `friend_links` entry (write-time validated by `resolveFriendLessonLink`), because notification context columns are documented untrusted.
- The Continue tap destination on the success screen (existing `onLoadNextLesson`; a terminal chain lesson with no `nextLessonId` ends at the completion message via the existing `loadNextStep` path) — only the reveal timing and the friend-row rendering change.
- Non-friend success-row timing, layout, and CSS — the `.success-actions-row` already places Continue next to Share, so no layout work exists; the delayed reveal reuses it.

## Implementation approach

Add a pure, RN-safe module `src/modules/home/continue-logic.js` (no React, no DOM, no `window`/`document`, no supabase import, no recorder-page token anywhere in the new `src/**` files) plus `src/modules/home/continue-logic.test.js`. The component stays render-only: HomeScreen performs no branching, mapping, filtering, sorting, random-picking, or URL building — it calls `resolveContinueTarget({...})` inside the memoized resolution and renders the returned target or nothing. Every gate, including the legacy resume gate, lives in the resolver:

- Classify the resume `courseId` against the already-loaded config entries (`loadConfigEntries` result already in HomeScreen for the cards; `courseId` is the config file basename — `friend.json`'s inner `courseId` is `20260921`, so never use `config.courseId`): friend-type when `isFriendCourse(entry.config)` from `src/modules/courses/friend-courses-logic.js`, excluding `EXCLUDED_FRIEND_COURSE_IDS` (`test`) and the `test-api` fixture.
- Non-friend resume: the legacy `canContinue = !!courseId && !!activeLessonId` gate moves into the resolver with identical semantics — when both ids are present the target href is exactly ``/course/${courseId}/lesson/${activeLessonId}`` (legacy string preserved; no query string appended), otherwise null. The component never evaluates the gate itself.
- Friend resume resolution order:
  1. Oldest active friend response: collect candidate actors from the viewer's `user_notifications` inbox (`useNotifications`, key `['notifications', userId]`, newest first, dedupe by normalized `payload.actorShareCode`, skip self/blank, in inbox order up to the query's existing `limit(50)` rows), `fetchUserByShareCode` each actor (existing `['user','profile','shareCode', code]` cache keys), `listActiveFriendLinks(map, nowMs)` per friend (48h via `FRIEND_LINK_WINDOW_MS`, malformed entries dropped), pick the entry with the smallest `addedAt` across all friends, href via `buildFriendLessonLink({ courseId, lessonId, shareCode })`. The notification's own `lesson_id` is never used for the href.
  2. Else first lesson (`firstFriendLessonId`, always `a`) of a randomly chosen unstarted friend course: unstarted means `course_progress` (parsed fail-open; corrupt JSON counts as empty) has no key for the basename and no `counted_lessons` key starts with `<basename>_` and the basename is not the resume course. Sort candidate basenames ascending and pick with an injectable `rand` (default `Math.random`) so tests are deterministic.
  3. Else most-recent started non-friend course resume: non-friend basenames present in `course_progress`/`counted_lessons`, ordered by `course_progress[c].lesson_timestamp` descending (missing/corrupt timestamps sort last, tie-break basename ascending), href is that course's stored `current_lesson` (or its config `lessons[0].lessonId` when absent) as a solo `/course/<id>/lesson/<lesson>` link.
  4. Else null (hide Continue; cards remain).
- Guests (`viewerId` missing/`guest`): inbox query stays disabled (existing `useNotifications` enabled gate); every friend course counts as unstarted; steps 1 and 3 yield nothing, so guests resolve via step 2 only.
- Stability: HomeScreen memoizes the resolution (`useMemo` on `[courseId, activeLessonId, notifications, friendLinksByCode, profileProgress]`) so the button never changes targets across re-renders with identical inputs; re-resolution happens only when an input changes (notifications refetch at 30s staleTime refreshes expiry). All fetches are fail-open: a single friend lookup failure skips that friend and never breaks the button.
- Tests follow the repo recipes: pure-logic vitest unit tests with injected `rand` and fixed `nowMs`; HomeScreen tests inject fixtures via `queryClient.setQueryData(['user','profile','shareCode', code], fixture)` and fix the clock with `page.clock.setFixedTime` / `vi.setSystemTime` for the 48h boundary; raw-source guards (`readFileSync`, never comment-stripped) cover the intact legacy href and the logic/presentation split.
- Delayed Continue on friend success rows (new pure module `src/modules/lesson/success-continue-logic.js` — no React, DOM, `window`/`document`, supabase import, or recorder-page token): `SUCCESS_CONTINUE_REVEAL_DELAY_MS = 3000`; `isSuccessContinueDelayed(lesson)` reusing `resolveRecapOverlay(lesson) === 'shareCta'` (null/undefined lesson → false, so unflagged lessons keep today's reveal); `scheduleSuccessContinueReveal({ lessonId, delayMs, reveal, getActiveLessonId })` returning a cancel function, stale-guarded (reveals only when the active lesson still matches the scheduled one, so a fired timer can never reveal Continue on a later lesson).
- `VideoButton` (render-only) wires the pure helpers: the ready-path `setContinueVisible(true)` (`SuccessButtons.jsx:133`) becomes conditional on `!isSuccessContinueDelayed(readyLesson)` (lesson resolved with the existing `shareConfig?.lessons?.find` pattern; non-friend identical to today); `handleShare` starts the 3s schedule after the share handler settles — success or throw (fail-open) — but only for a delayed lesson whose Continue is not already visible; the cancel handle lives in a ref (matching `shareHandlerRef`/`audioContextRef`), cancelled on unmount by extending the existing cleanup effect and whenever a new schedule supersedes it.
- `SuccessScreen` drops the `!isFriendLesson` guard on `ContinueButton` only (Repeat keeps its guard, CTA copy/layout/CSS untouched): on friend rows Continue lands in the existing `.success-actions-row` next to `#createVideoButton` with zero layout work. `ContinueButton` itself is unchanged.
- Success-screen tests: vitest fake-timer unit tests for the predicate + scheduler (reveal, cancel, stale-lesson, abort-still-reveals at the `handleShare` call-site level); Playwright on a real `wouldrather` lesson-`a` success state (store-injected like the existing `setupSuccessScreen`, no voice): Share-only with the CTA at ready, real tap on `#createVideoButton` (fail-open covers abort/transcode failure, so no delivery stubbing needed), real-timer wait for `#continueButtonSuccess` in the same row, and a no-tap absence hold. The model-based friend-row test in `success-concat-button.spec.js` is rewritten to this flow: it derives its shareCta index from the model config, which contains no `shareCta` lesson (`grep -c` is 0), so verify its baseline on main before editing.

## Tasks

### Task 1 - Pure continue-target resolver

- Non-friend resume (`courseId=model`, `activeLessonId=m-g`) + any friend data present
  - → returns exactly `/course/model/lesson/m-g` with no query string
- Non-friend resume with missing `courseId` or missing `activeLessonId`
  - → returns null (legacy gate semantics: no Continue without both)
- Friend resume (`courseId=wouldrather`, `activeLessonId=b`) + one active friend entry (`addedAt` 5h ago, `lessonId=c`, `shareCode=ab12`)
  - → returns `/course/wouldrather/lesson/c?shareCode=ab12`
  - → returned `lessonId`/`shareCode` equal the friend_links entry, not the notification row's `lesson_id`
- Friend resume + two active entries from different friends (`addedAt` 2h and 20h ago)
  - → returns the 20h (oldest) entry's href
- Friend resume + only expired entries (`addedAt` 49h ago)
  - → ignores them and falls through to random-unstarted / started-non-friend / null
- Friend resume + no links + unstarted friend courses `[friendchain, wouldrather]` + `rand=() => 0`
  - → returns `/course/friendchain/lesson/a`
- Friend resume + every friend course started + `course_progress` has `model` with `current_lesson=m-g`
  - → returns `/course/model/lesson/m-g`
- Friend resume + every friend course started + no started non-friend course
  - → returns null
- Corrupt `course_progress` (`"{oops"`) + any other input
  - → parses as empty, resolver never throws
- Candidate pool containing `test` / `test-api` basenames
  - → neither is ever returned
- Resume `courseId=friend` (whose `friend.json` inner `courseId` is `20260921`)
  - → all hrefs use the `friend` basename, never `20260921`
- Identical inputs + identical `rand` across two calls
  - → identical output object
- Raw `continue-logic.js` source inspected
  - → contains no `from 'react'`, `require('react')`, `window`, `document`, or `supabase` token

### Task 2 - HomeScreen wiring

- Non-friend resume in store (`courseId=model`, `activeLessonId=m-g`) + active friend links present in cache
  - → Continue renders with `data-testid="home-continue"` and `href` (navigation target) exactly `/course/model/lesson/m-g`
- Friend resume + mocked actor profile with one active entry
  - → Continue `data-testid="home-continue"` target is the entry's direct lesson URL including `?shareCode=<actorCode>`
- Resolver returns null (all friends exhausted, no started non-friend)
  - → no `[data-testid="home-continue"]` element in the DOM and course cards still render
- Guest session (no `viewerId`) + friend resume in store
  - → Continue renders a `/course/<friendCourse>/lesson/a` fallback without crashing and performs no inbox fetch
- Same query-cache data rendered twice without cache changes
  - → Continue target identical on both renders
- Raw `HomeScreen.jsx` source inspected
  - → calls the resolver from `continue-logic` (inside `useMemo`) and renders `FriendCoursesView` unchanged
  - → contains no `/course/${` URL template, no `isFriendCourse`, no `.filter`, no `.sort`, and no `Math.random` token (every branch, mapping, and URL build lives in the resolver; the pre-existing card query's `.map` is untouched and out of scope)

### Task 3 - Expiry boundary and regression

- Fixed clock + entry with `addedAt = now - (48h - 60s)`
  - → entry is used as the Continue target
- Fixed clock + entry with `addedAt = now - (48h + 60s)`
  - → entry is ignored
- Friend entry missing `lessonId` or `shareCode`
  - → entry is dropped and the next candidate is tried
- Actor profile fetch rejects (network error)
  - → that friend is skipped, resolution continues, Continue still renders from remaining candidates or fallback
- Existing `HomeScreen` suite (logo, course-listings headline/steps, per-course cards, course-listings wiring guards) + `home-navigation-wiring` suite
  - → all pass unmodified

### Task 4 - Delayed Continue on friend success rows

- Friend (`shareCta`) lesson success, video ready, Share not tapped (store flag false)
  - → `#createVideoButton` visible, `#continueButtonSuccess` absent, 48h CTA visible
- Non-friend lesson success, video ready, Share not tapped
  - → `#continueButtonSuccess` visible immediately (today's timing byte-identical)
- Friend lesson + `#createVideoButton` tapped (delivery settles, any outcome) + 3s elapsed
  - → `#continueButtonSuccess` appears in the same `.success-actions-row` as `#createVideoButton`
- Friend lesson + `#createVideoButton` tapped + under 3s elapsed
  - → `#continueButtonSuccess` still absent
- Friend lesson + Share tap whose delivery rejects (sheet aborted / transcode failed)
  - → `#continueButtonSuccess` still appears after 3s (fail-open; the learner is never stranded)
- Reveal timer pending for one lesson + active lesson changes (Repeat / onward navigation) before it fires
  - → `setSuccessContinueVisible` is not called (stale-lesson guard)
- Success flow unmounts with a reveal timer pending
  - → the setter is not called when the timer fires (cleanup)
- `SUCCESS_CONTINUE_REVEAL_DELAY_MS` inspected
  - → equals 3000
- `isSuccessContinueDelayed` unit cases: `shareCta` lesson / `fluency` lesson / `none` overlay / null / undefined
  - → true / false / false / false / false
- Raw `SuccessButtons.jsx` source inspected
  - → contains no `setTimeout` token (timers live in the logic module) and no `recapOverlay ===` comparison (uses `isSuccessContinueDelayed`)
- Raw `success-continue-logic.js` source inspected
  - → contains no `react`, `window`, `document`, or `supabase` token
- Raw `SuccessScreen.jsx` source inspected
  - → still contains `!isFriendLesson && <RepeatButton` and no longer contains `!isFriendLesson && <ContinueButton`
- Rewritten friend-row E2E in `success-concat-button.spec.js` (genuine `wouldrather` shareCta lesson) plus untouched suites (`success-screen`, `after-video-loop`, `regression-guard`, `unified-buttons`, non-friend concat tests)
  - → all pass

## Technical Context

No new dependencies. Relevant pinned versions from `package.json` (unchanged by this story): `react 19.2.0`, `react-dom 19.2.0`, `react-router-dom 7.15.1`, `@tanstack/react-query 5.100.14`, `@supabase/supabase-js 2.112.4`, `zustand 5.0.13`, `vite 8.0.10`, `vitest 4.1.6`. Key contracts reused verbatim: `isFriendCourse` / `firstFriendLessonId` / `EXCLUDED_FRIEND_COURSE_IDS` / `buildCourseStartHref` (`src/modules/courses/friend-courses-logic.js`), `listActiveFriendLinks` / `buildFriendLessonLink` / `FRIEND_LINK_WINDOW_MS` (`src/modules/user/friend-lesson-link-logic.js`), `useNotifications` key `['notifications', userId]` with 30s staleTime and guest-disabled gate plus `fetchUserByShareCode` / `useUserByShareCode` key `['user','profile','shareCode', code]` (`src/modules/api/api.js`), `SHARE_WINDOW_HOURS = 48` (`src/modules/video/video-processor-logic.js:66`), `record_friend_response` dedupe per `(recipient, actor, type)` with untrusted context columns and payload `{actorShareCode, actorName}` (`supabase/migrations/005_add_user_notifications.sql:25-26,91-99`), `friends`/`friend_owners` storing user-ids not share codes (`supabase/migrations/007_friend_credit.sql:6-14,99-116`), `course_progress` text-map + `counted_lessons` `<courseId>_<lessonId>` keys (`src/modules/user/user-profile.js:115-119`, `src/modules/user/lesson-count-logic.js`), persisted `uff-lesson-storage` keys `courseId`/`activeLessonId` (`src/modules/store/store.js:710-742`), route `/home` → `HomeRoute` → `HomeScreen` (`src/routes/routes.jsx:34`), localized label `home_continue` (`src/data/strings.js:1049`). Success-screen delay reuses: `resolveRecapOverlay` (`src/modules/video/video-processor-logic.js:117-120`, unknown/missing → `'fluency'`); ready-path reveal at `SuccessButtons.jsx:133` with lesson lookup via `shareConfig?.lessons?.find` (`:143`); `handleShare` invoking `shareHandlerRef.current()` which awaits `deliverVideo` → `{ delivered: 'download' }` after anchor `click()` / `{ delivered: 'shared' }` after `navigator.share()` settles (`src/modules/video/video-share.web.js:140-146`); friend-row exclusion `{!isFriendLesson && <ContinueButton onLoadNextLesson={onLoadNextLesson} />}` (`SuccessScreen.jsx:85`); tap destination `onLoadNextLesson` → `loadNextStep` → terminal chain lesson (no `nextLessonId`) → completion message (`LessonContainer.jsx:115-121`, `lesson-progression.js:67-72`); existing specs `success-concat-button.spec.js` (model/m-g; friend-row test derives its shareCta index from the model config), `after-video-loop.spec.js` (model/m-g), `regression-guard.spec.js` + `success-screen.spec.js` (gt2/g-a) — all non-friend except the one concat friend-row test.

## Notes

- Explicit assumption resolving contradictory fallback instructions (earlier "exclude friend courses" vs later "ONLY friend courses", which would be incoherent combined with the finding that only lesson `a` is solo-startable): "exclude" is scoped to broken solo resumes (a bare `/course/<friend>/lesson/<b+>` with no `?shareCode=`, which this story never emits); the recommendation pool itself is friend-first per the later authoritative answers — oldest live friend response, then random unstarted friend `a`, then a started non-friend resume, else hidden. Correct this assumption instead of the implementation if the intent was different.
- Button visuals, placement, label, and the course cards are unchanged; only the Continue href (and its hide condition) changes, and only when the resume course is friend-type.
- `friend.json`'s inner `courseId` (`20260921`) must never appear in a href; basenames only, matching `buildCourseStartHref`.
- Logic stays in `src/modules/home/` (new directory; no existing home-logic module to extend) with rendering only in `HomeScreen.jsx`, per the logic-in-modules rule; presentational testids added (`home-continue`) must be mirrored if a `.native.jsx` port is later built.
- Explicit trigger interpretation for the 3s timer: "clicked + displayed/started" is observed at the settle point of the share handler (the tap invoked it, so the sheet displayed on mobile / the download `click()` fired) — not by awaiting sheet close separately. A rejected delivery still starts the timer (fail-open): the learner engaged Share, and Continue must never be withheld because sharing failed. Adjust the trigger point instead of the implementation if a stricter "displayed" signal is wanted.
- The success-screen Continue reuses the existing tap action unchanged; on a terminal chain lesson that ends at the completion message through the pre-existing `loadNextStep` path — no new destination, no auto-advance of the friend chain (story 043 intact).
