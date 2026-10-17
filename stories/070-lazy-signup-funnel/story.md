# Lazy signup: create the account at the end of the first lesson

## Context

Signup currently has a front door that anyone can walk through: a standalone
`/signup` form, linked from the guest modal, the login page, the public landing
page and the guest profile. Signing up creates an `auth.users` account with no
lesson behind it, which is cheap to automate and produced the account population
this branch's neighbours had to clean up (see
[069-zero-cost-email-validation](069-zero-cost-email-validation/story.md) — 99
accounts, 92 of them with no usable profile).

The back door **already exists and already works**. A guest who presses the
create-video button on the success screen gets the signup form inline, with no
navigation: `SuccessButtons.jsx:277-281` sets `saveClipsModalOpen`, `RootLayout`
renders `SaveClipsModal`, and `SaveClipsModal` renders `SaveClipsSignupForm`
directly. It already runs with `captcha: false` (`SaveClipsSignupForm.jsx:45`).

So this story does not build a funnel. It **closes the front door, promotes the
back one, and tells people the back one exists.**

### Why the back door is a real barrier

The post-lesson signup is not merely later in the flow — it sits behind a
hardware requirement. `IntroChoices.jsx:22-33` withholds the text-only option on
friend lessons:

```js
const textOnlyBtn = friendLesson ? null : ( … keyboard button … );
```

and the friend branch also drops audio-only, so a friend lesson offers **video
only**. `friendClosedResponse` steps therefore cannot be completed without a
camera and microphone stream. A spammer must drive a real browser through a real
`getUserMedia` + speech loop rather than POST three fields.

**Correction to the standing rule.** `AGENTS.md` (Playbook §4) states the
keyboard icon is "always visible and usable" with no exception. That is wrong —
`IntroChoices.jsx` is the mode chooser and it withholds text on friend lessons.
This story fixes the rule, because it is exactly the fact a future agent would
reason from when judging this funnel's strength.

### Why `/courses` is the right landing

It already carries the copy that makes lazy signup unalarming.
`FriendCoursesView.jsx:22,29-30` renders:

> **Courses** — Choose a conversation to have with your friends and practice
> English with them free.
> 1. Complete the first mini lesson in under five minutes.
> 2. Share your special link with friends, family, and colleagues so that they
>    can reply to you and continue the conversation.

Step 1 already promises the short lesson and already implies "start here". The
only missing piece is that **no step says an account appears at the end.** So the
change is one amended string, not a new intermediary page.

## Out of Scope

- **Deleting the `/signup` route or its components.** The route is redirected,
  not removed. This is an experiment with a plausible near-term reversal (a
  pre-launch push, a campaign, a support need), so the code stays and stays
  tested; only reachability changes.
- **Turning on Turnstile for the modal signup form.** Worth doing, but it is a
  separate story (see *Follow-up* below). It is a real engineering task, not a
  flag: `SignupForm.jsx:17-20` records why `captcha` is off for this form — the
  widget would have to run inside a native `<dialog>` that is already open, which
  needs explicit rendering at the right lifecycle moment.
- **Any change to `useSignupForm`, the email screen, or profile creation.** The
  lazy form uses the same hook and the same email gate.
- **Reworking the success-screen modal**, its copy, or the create-video trigger.
- **Blocking the non-friend courses.** They stay reachable by URL; only the
  signup *form* becomes unreachable.
- **Merging into `main`.**

## Implementation approach

### 1. Tell people what already happens — one amended string

`friend_courses_step_1` gains the account step. Current: *"Complete the first
mini lesson in under five minutes."* New copy keeps the time promise (it is the
reason lazy signup is unalarming) and names the outcome, e.g. *"Complete the
first mini lesson in under five minutes — you'll create your free account at the
end."* All six locales (`en/es/pt/fr/hi/bn`); `strings.test.js` enforces real
Devanagari/Bengali.

### 2. A guest notice at the top of `/courses`

Signed-out visitors get a banner above the course list. Signed-in visitors get
nothing — the page is for both, and the notice must not imply otherwise.

- It states they are not signed in, links to sign in, and says a new learner
  completes a lesson and signs up at the end.
- Sign-in link is `/login?redirect=/courses`, matching the existing
  `?redirect=` convention (`LoginRoute.jsx:8,13`) so they return here.
- Placement: inside `CourseListings.jsx`, **above** the `friend-courses-scroll`
  container so it does not scroll away, and **outside** the
  `userId && userId !== 'guest'` block that gates the install banner and the
  notification prompt (`CourseListings.jsx:54-58`) — a guest must see neither of
  those, and must still see this.
- Guest detection reuses what the page already has: `userId` is `'guest'` from
  `useUserProfile`'s core-data fallback, the same sentinel
  `CourseListings.jsx:54` already tests.
- New `strings.js` keys in all six locales. The sign-in link label reuses the
  existing auth copy rather than inventing a new string.

### 3. Make `/signup` unreachable, keep the code

`routes.jsx:37` keeps the path and its component, but the element redirects to
`/courses` instead of rendering `AuthLayout`.

**Why a redirect and not deleting the route:** dropping the path would let
`/signup` fall through to the `/:shareCode` catch-all (`routes.jsx:56`) and
render a profile-not-found page — genuinely dead to bots, but confusing to a human
who types the URL. The redirect is equally unreachable *for signup purposes*
(there is no form to submit) without stranding anyone.

`/signup` **must be declared before the `/:shareCode` catch-all** or
`signup` is read as a share code (`routes.jsx:48-49` carries this warning for the
other static pages).

All signup entry points are then unreachable: the guest modal
(`GuestLoginModal.web.jsx:227`), the login page's sign-up link
(`LoginRoute.jsx:13`), and the guest profile button (`UserProfile.jsx:374`).
Whether those links are also repointed at `/courses` rather than left to bounce
is an implementation detail of the redirect; the redirect covers them either way,
and repointing them avoids a visible no-op hop.

### 4. Correct the standing rule

`AGENTS.md` §4 "Voice-first, text available (product rule)" gains the exception:
text is withheld on friend lessons (`IntroChoices.jsx:22-33`), which is what makes
the post-lesson signup a hardware gate.

## Tasks

### Task 1 — Copy

- `friend_courses_step_1` amended in `src/data/strings.js` (6 locales)
  → keeps "under five minutes"; names account creation at the end of the lesson
- new guest-notice strings in `src/data/strings.js` (6 locales)
  → headline, body, and a sign-in label reusing existing auth copy
- `src/data/strings.test.js` green (raw-table `hi` Devanagari / `bn` Bengali)

### Task 2 — Guest notice on `/courses`

- `src/components/courses/CourseListings.jsx` renders the banner from `userId`
  → hidden when `userId` is truthy and not `'guest'`; shown to guests
- the banner sits above `friend-courses-scroll`
  → a raw-source guard asserts its index precedes `friend-courses-scroll`
- the sign-in link targets `/login?redirect=%2Fcourses`
- it is outside the `userId !== 'guest'` banner block
  → a guard asserts the install/notification banners are still guest-gated and
    the new one is not nested inside them

### Task 3 — Close the front door

- `routes.jsx` `/signup` element redirects to `/courses`
  → the component and route are still present; a guard asserts `SignupRoute` is
    still imported and still referenced in the file (the code is parked, not deleted)
- `/signup` is declared before the `/:shareCode` catch-all
- no entry point renders the signup form any more
  → a source guard greps the guest modal, `LoginRoute` and `UserProfile` and
    asserts each link resolves to `/courses` (or to the redirect), never to a
    reachable form

### Task 4 — Guard hygiene + docs

- guard tests assert on raw source, scoped slices bounded at a real marker, and
  are each proven failable by mutation before being trusted (AGENTS.md)
- `AGENTS.md` §4 gains the friend-lesson text-mode exception
- `docs/product.md` records the lazy-signup funnel

### Task 5 — Full local verification

- `npx vitest run`, `npm run build`, `npm run lint` all green
- no GitHub workflow dispatched "to check" (AGENTS.md)

## Acceptance criteria

1. `friend_courses_step_1` tells the learner an account is created at the end of
   the lesson, in all six locales, and still states the under-five-minutes
   promise → `src/data/strings.test.js` (raw table) + a spot assertion in a
   course-copy test
2. `/courses` shows a signed-out notice containing a sign-in link to
   `/login?redirect=/courses` and the "complete a lesson, sign up at the end"
   instruction → `CourseListings` render test
3. the notice is hidden for a signed-in viewer
   → same test, with a non-guest `userId`
4. the notice is rendered above the scrolling course list, not inside it
   → raw-source index-order guard
5. the notice is not nested inside the guest-gated install/notification banners
   → raw-source guard
6. guest detection uses the existing `'guest'` sentinel rather than a new one
   → guard asserts `CourseListings` still gates on `userId !== 'guest'`
7. `/signup` redirects to `/courses` and renders no form
   → route/render test
8. the `/signup` route and `SignupRoute` component still exist in the codebase
   → raw-source guard asserting the import and JSX reference are present
9. `/signup` is declared before the `/:shareCode` catch-all
   → raw-source index-order guard
10. no signup entry point resolves to a reachable form
    → source guard over `GuestLoginModal.web.jsx`, `LoginRoute.jsx`,
      `UserProfile.jsx`
11. the friend-lesson text-mode exception is documented in `AGENTS.md`
    → guard asserting `AGENTS.md` mentions the exception alongside the rule
12. `docs/product.md` records the funnel
13. `npx vitest run` reports 0 failures and `npm run build` + `npm run lint`
    exit 0, verified locally, no workflow dispatched
    → commands and output recorded in the completion report

## Follow-up (separate story)

**Add Turnstile to the lazy signup form.** `SaveClipsSignupForm` currently opts
out (`captcha: false`), so the post-lesson path has the camera gate but not the
bot gate. Turning it on is defence in depth: the two layers are independent, so a
spammer must defeat both. The obstacle is real and documented in
`SignupForm.jsx:17-20` — the widget must render inside a native `<dialog>` that is
already open, which needs Turnstile's explicit-rendering path rather than the
auto widget. Land this after the funnel has been measured; it is worth doing
regardless of whether the experiment succeeds.

## Notes for reviewers

- **The claim this rests on**: friend lessons cannot be completed without camera
  and mic. Verified at `IntroChoices.jsx:22-33` (`textOnlyBtn` is null when
  `friendLesson`) and the friend branch dropping audio-only. `AGENTS.md` said
  otherwise and was wrong; Task 4 fixes it. If a future change re-exposes text on
  friend lessons, this story's spam argument collapses and the funnel should be
  re-examined.
- **Conversion cost is a guess, not a measurement.** "Under five minutes" is in
  the existing copy and lazy signup is standard on iOS, so the friction is
  probably small — but the current account population (99 accounts, 10 non-test)
  is far too small to price this. Measure before strengthening the gate.
- **Fake camera streams exist.** `--use-fake-device-for-media-stream` satisfies
  `getUserMedia`, so the barrier is "a browser willing to lie", not "a human".
  That is why the Turnstile follow-up is worth doing rather than optional.
- **Test caveat**: `playwright.config.js` `testIgnore` silently skips four stale
  specs; cite only specs the config runs.