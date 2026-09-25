# Remove the hardcoded caller name/title from the lesson-intro overlay

## Context

The lesson-intro overlay (`IncomingVideoWidget`) renders a bottom caption block
with a caller name and title, falling back to hardcoded values:

```jsx
// src/components/IncomingVideoWidget.jsx:313-316
<div className="intro-notification-bottom">
    <div className="intro-caller-name">{config?.name || 'Joe Walsh'}</div>
    <div className="intro-caller-title">{config?.role || 'English Coach, UFF'}</div>
</div>
```

`src/modules/video/video-loader.web.js:65-66` also hardcodes
`name: 'Joe Walsh'` / `role: 'English Coach, UFF'` into the intro `config`.

That is wrong once the intro video belongs to a friend (the `friend`/UGC
courses): the caller is the friend, not the coach, so the overlay asserts
something false. The right long-term behaviour is: the system/coach intro keeps
its default identity, and a friend/UGC intro shows **the friend's name**; if no
name is known it shows nothing rather than a wrong name. The friend's name is
captured at signup (`first_name` / `display_name` on `user_profiles`,
`SignupForm.jsx:48,78`), so it is a database lookup keyed by the friend's
share code — real plumbing (resolve the share code → profile → name → into the
intro config) that is not worth building now.

Decision (per the product owner): for now, **remove the caller name/title
entirely** — comment it out so nothing false is shown — and leave the
friend-name feature for later. The "INCOMING VIDEO" label and the localized
subtitle stay.

## Out of Scope

- **No friend-name resolution.** No share-code → `user_profiles` lookup, no
  profile/API changes, no per-course name in `src/config/*.json`.
- **No changes to the tutor/feedback identity.** `bot-identity.js`,
  `tutor-config.js`, `PraiseBubble.jsx`, and the `botName: 'Joe Walsh'` values in
  `answer-pipeline.js` are the AI coach/feedback bot, unrelated to the intro
  overlay.
- **No change to the intro's top label or subtitle** (`config.title` /
  `config.subtitle`, `INCOMING VIDEO`). Only the bottom caller name/title block
  is removed.
- **No translation work.** The removed strings were hardcoded English; the
  `english_coach` string in `src/data/strings.js:1441` is left in place (it is a
  general string, not deleted here).
- **No CSS deletion.** `.intro-caller-name` / `.intro-caller-title`
  (`app.css:1317-1327`) are left in place (purgecss may drop them at build).
- **No new dependencies.**

## Implementation approach

**1. `src/components/IncomingVideoWidget.jsx`** — replace the
`intro-notification-bottom` block with a JSX comment that preserves the original
markup and explains why, so nothing renders at the bottom of the overlay. Keep
the top block (`intro-call-title` = `INCOMING VIDEO` + the localized
`intro-call-subtitle`) unchanged.

**2. `src/modules/video/video-loader.web.js`** — remove `name: 'Joe Walsh'` and
`role: 'English Coach, UFF'` from the intro `currentVideo.config` (they become
dead once the overlay stops reading them). Leave a comment pointing at the
deferred friend-name work. `title` and `subtitle` stay.

**3. Regression guard** — new `src/components/intro-caller-name.test.js`, a
source-level guard in the style of `src/modules/video/poster-runtime-wiring.test.js`:
strip comments from both files, then assert the stripped source contains neither
`Joe Walsh` nor `English Coach, UFF`, and that `IncomingVideoWidget.jsx` still
contains `INCOMING VIDEO` (so the top label is not accidentally removed). The
comment-strip step is required because the removed markup is intentionally left
as a comment; the guard must fail if someone re-enables it. (Comment-stripping
must not be used for URL assertions — `docs/learnings.md` — but these are bare
identifiers, which is exactly the documented safe use.)

Verification: `npm test -- --run` (the guard runs under vitest), plus a visual
check of `/course/model/lesson/t` (no name/title at the bottom) and
`/course/friend/lesson/a` (same, no "Joe Walsh / English Coach, UFF").

## Tasks

### Task 1 - Remove the caller name/title block

- `IncomingVideoWidget.jsx` rendered with an intro video that has `config.name`/`config.role`
  - → no `.intro-caller-name` or `.intro-caller-title` element is rendered
  - → the `.intro-call-title` ("INCOMING VIDEO") and localized `.intro-call-subtitle` still render
- `IncomingVideoWidget.jsx` rendered with an intro video whose `config` omits `name`/`role`
  - → no caller name/title is rendered (and no fallback text `Joe Walsh` / `English Coach, UFF` appears anywhere)
- source of `IncomingVideoWidget.jsx` with comments stripped
  - → contains neither `Joe Walsh` nor `English Coach, UFF`
  - → still contains `INCOMING VIDEO`
- source of `src/modules/video/video-loader.web.js` with comments stripped
  - → contains neither `Joe Walsh` nor `English Coach, UFF`
  - → the intro config still sets `title` and `subtitle`
- `src/components/intro-caller-name.test.js` exists and asserts the four points above
  - → `npm test -- --run` includes and passes it

### Task 2 - Documentation

- `docs/product.md` read
  - → Known Limitations notes that the lesson-intro overlay no longer shows a caller name/title, pending surfacing the friend's name from their profile
  - → Features mentions the poster/intro overlay behavior only if already describing it
- `agents.md` read
  - → no rule instructs showing a hardcoded caller name on the intro (no change required unless such a rule exists)

## Technical Context

- **No new packages.**
- **Overlay markup:** `src/components/IncomingVideoWidget.jsx:301-318` — top block
  (`intro-call-title`, `intro-call-subtitle`) then the bottom
  `intro-notification-bottom` block to remove.
- **Intro config source:** `src/modules/video/video-loader.web.js:52-70`
  (`loadVideoForStep`, `step.introBackgroundVideoUrl` branch) sets the `config`
  the overlay reads, including `name`/`role` at lines 65-66.
- **Friend name exists but is unplumbed:** signup stores `first_name`/`display_name`
  (`src/components/auth/SignupForm.jsx:48,78`), surfaced in profiles
  (`src/components/profile/PublicProfile.jsx:67`,
  `src/modules/api/api.js:13,59`). The share-code ↔ profile link exists for UGC
  auth (`functions/api/upload-segment.js`), but not as a name the intro can read.
- **Guard-test pattern:** `src/modules/video/poster-runtime-wiring.test.js` and
  `src/modules/video/video-processor-web-guard.test.js` read source text and
  assert presence/absence; `docs/learnings.md` documents the comment-stripping
  caveat (safe for bare identifiers, not for URL/scheme assertions).
- **vitest discovery:** `vitest.config.js` has no `include`, so `**/*.test.js`
  runs; `**/tests/**` and `**/*.spec.js` are excluded. Gate: `npm test -- --run`.

## Notes

- **Why remove rather than hide for friends only.** The simple conditional
  (hide the block only when the intro slug is a friend/UGC video via
  `isFriendVideoSlug`) would keep the coach default for system intros, but the
  product owner chose the simplest option for now: remove the block entirely
  (commented out). If the coach default should be preserved, that conditional is
  a one-line substitute.
- **Future feature (deferred):** show the friend's name on a UGC intro. Requires
  resolving the friend's share code to their `user_profiles.display_name`
  (`first_name`) and passing it into the intro config — likely a TanStack Query
  read keyed by the `?sharecode=`, then `name` on the intro config. Re-enable the
  commented block at that point.
- **Manual visual check:** `/course/model/lesson/t` and
  `/course/friend/lesson/a` — the bottom of the intro overlay should be empty
  (the video/poster and the "INCOMING VIDEO" label remain).
- **`docs/product.md`** is updated in this planning commit.
