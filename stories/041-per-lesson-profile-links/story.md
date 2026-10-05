# One profile link per recorded lesson, grouped by course

## Context

The public profile (`/:shareCode` → `PublicProfile.jsx` → `FriendLessonLinksSection.jsx`) advertises friend-challenge links so a visitor can record a reply. Story 039 generalized the chain but kept the display **one link per course**, pointing at the single *first* answer lesson. That loses information: a user who has recorded several lessons in a course (Alice records `a`, later `c`, later `e`) has several distinct prompt sets a visitor might want to answer, and the visitor must be able to pick the one they remember.

This story changes the profile to render **one link per lesson whose prompts the owner recorded**, grouped under a course heading. Each link:
- is **labeled with the English title of the lesson the owner recorded** (the questions the visitor will hear), and
- **targets the follow-on lesson** the visitor records in (`next(recorded)`), carrying the owner's `?shareCode=`.

Example (canonical `wouldrather` chain `a→b→c→d→e→f`): after Alice exports `a`, her profile shows a link labeled with `a`'s title that opens lesson `b?shareCode=<alice>`. When she later exports `c`, a second link (labeled with `c`'s title, opening `d`) appears alongside it. Anyone visiting Alice's profile can answer whichever set they choose.

Two coupled corrections make the labels work:
1. **Lesson titles stop being localized.** `normalizeConfig` currently collapses `lesson.title` to the user's language; the title is a curriculum label, not learner-facing copy, so it is normalized to **English** instead. This means a plain-string `title` (as the canonical `wouldrather` configs will use) round-trips unchanged, and an object title resolves to `.en`.
2. **The canonical `wouldrather` config gains the `a`–`f` chain with English titles** (promoted from the reviewed exercise config), and `model.json`/other courses are unaffected.

## Out of Scope

- The **respond-to-friend overlay** on the end-of-lesson `shareCta` screen (a separate future feature; see Notes).
- Any server/Supabase/RLS change. `friend_links` already holds a jsonb map; this story only changes the entry shape and the render.
- Localizing lesson titles in any language other than English (deliberately dropped).
- Rewriting titles in courses other than `wouldrather` (e.g. `friendchain`, `friend`).
- R2 existence checks, TTL changes, or "already played" persistence beyond the browser cache.
- Guest/native profiles (`UserProfile.native.jsx` is dead code).

## Implementation approach

### 1. Recorded-lesson entry shape (`friend-lesson-link-logic.js`)

The entry must carry **both** the recorded lesson (label source + key) and the target lesson (href). Reuse the existing `nextFriendLessonId`; add a small pure grouping helper.

```js
// resolveFriendLessonLink — record the entry for the lesson just recorded:
//   recordedLessonId = the exported lesson (label + map key)
//   lessonId         = next(recordedLessonId) (the href target); null → no entry
//   lessonTitle      = the RECORDED lesson's English title (string), or ''
export function resolveFriendLessonLink({ configData, lessonId, courseId, courseName, shareCode, succeeded } = {}) {
    if (!succeeded || !shareCode || !courseId) return null;
    const nextId = nextFriendLessonId(configData, lessonId);   // requires `lessonId` itself be shareCta
    if (!nextId) return null;
    const recorded = configData.lessons.find((l) => l.lessonId === lessonId);
    const lessonTitle = typeof recorded?.title === 'string' ? recorded.title : '';
    return { courseId, courseName: typeof courseName === 'string' ? courseName : '',
             recordedLessonId: lessonId, lessonId: nextId, shareCode, lessonTitle };
}
```

`upsertFriendLinkMap` keys by `${courseId}:${recordedLessonId}` (fall back to `${courseId}:${lessonId}`, then `courseId`, so a concurrent write cannot clobber a 039-era entry). `listActiveFriendLinks` filters as today (requires `lessonId` + `shareCode` + active window)).

### 2. Grouping helper (`friend-lesson-link-logic.js`)

```js
// Ordered groups of active entries by course. Groups are keyed by courseId
// (two courses may share a display name) and carry the first entry's courseName
// as the heading; entries within a group keep listActiveFriendLinks order
// (newest first). Empty → [].
export function groupActiveFriendLinks(friendLinks, nowMs) {
    const active = listActiveFriendLinks(friendLinks, nowMs);
    const groups = [];
    const byCourse = new Map();
    for (const entry of active) {
        if (!byCourse.has(entry.courseId)) {
            const group = { courseId: entry.courseId, courseName: entry.courseName || entry.courseId, entries: [] };
            byCourse.set(entry.courseId, group);
            groups.push(group);
        }
        byCourse.get(entry.courseId).entries.push(entry);
    }
    return groups;
}
```

### 3. De-localize lesson titles (`config-normalizer.js`)

Line 82: `lesson.title = getLocalizedTranslation(lesson.title, userLang)` → `getLocalizedTranslation(lesson.title, 'en')`. `getLocalizedTranslation` already returns a plain string unchanged and resolves an object to its `.en`. Downstream consumers (`lesson-loader.js:72` already tolerates both shapes; the snapshot reads a string) are unaffected.

### 4. Render groups (`FriendLessonLinksSection.jsx`)

- Replace `listActiveFriendLinks` with `groupActiveFriendLinks`.
- Render, per group: a heading with the **course name** (`courseName`), then one link per entry.
- Each link label = `entry.lessonTitle` (English, from the recorded lesson). **No** `Strings.get` titled wrapper — the title is already the label. Keep the `profile_friend_link_available` countdown line per link.
- Each link `href` = `buildFriendLessonLink({ courseId: entry.courseId, lessonId: entry.lessonId, shareCode: entry.shareCode })` (unchanged builder; targets the follow-on lesson).
- Remove the now-unused `profile_friend_lesson_link_titled` string usage. The label is `entry.lessonTitle`; an entry with an empty non-string `lessonTitle` falls back to the generic `profile_friend_lesson_link` copy so the anchor keeps a visible, clickable label (see Task 4).

### 5. Snapshot the course name at export (`SuccessButtons.jsx`)

Pass `courseName: configData?.courseName` into `resolveFriendLessonLink` so the group heading needs no per-course config fetch. The existing `mutateAsync({ userId, entry: { ...payload, addedAt } })` is unchanged.

### 6. Promote the canonical `wouldrather` config

Replace `src/config/wouldrather.json` with the reviewed `a`–`f` English-title chain (from `src/config/wouldrather-exercise.json`), and delete the exercise file. Keep `courseId: "wouldrather"`, `courseName: "Friend Challenge"`.

## Tasks

### Task 1 - Entry shape and resolver (`friend-lesson-link-logic.js`)

- Exporting a `shareCta` lesson `a` in a chain `a..f` with `succeeded>0`, a `shareCode`, `courseId`, `courseName`, `title: "Make 3 questions…"` → returns `{ courseId, courseName, recordedLessonId: 'a', lessonId: 'b', shareCode, lessonTitle: 'Make 3 questions…' }`.
- Exporting the last chain lesson `f` (no next) → `null`.
- Exporting a non-`shareCta` lesson → `null`.
- Missing/falsy `succeeded`, empty `shareCode`, or empty `courseId` → `null`.
- `lessonTitle` is `''` when the recorded lesson's `title` is not a string (e.g. an object survives unnormalized in a raw-fixture call).
- `courseName` is `''` when omitted or non-string.
- Update the existing `resolveFriendLessonLink` cases in `friend-lesson-link-logic.test.js` (added by story 039) to the new payload shape: `lessonTitle` now comes from the **recorded** lesson and the payload carries `recordedLessonId` + `courseName`.

### Task 2 - Map key and grouping (`friend-lesson-link-logic.js`)

- `upsertFriendLinkMap` on `{}` with an entry `{courseId:'wouldrather', recordedLessonId:'a', lessonId:'b', ...}` → key `'wouldrather:a'`; a second entry `recordedLessonId:'c'` → both keys present.
- An entry with the same `courseId:recordedLessonId` replaces the prior one; a legacy entry with no `recordedLessonId` falls back to `${courseId}:${lessonId}`.
- Input map is not mutated; non-object input treated as `{}`.
- `groupActiveFriendLinks`: two active entries in the same course → one group with two entries, order newest-first; entries in two courses → two groups in first-seen order of `listActiveFriendLinks`; the group's `courseName` is the entry's `courseName`, defaulting to the `courseId` when absent (so a legacy entry without `courseName` still yields a non-empty heading).
- Expired-only / no entries / junk input → `[]`.
- Groups for two different `courseId`s that share a display `courseName` stay separate (keyed by `courseId`).

### Task 3 - English lesson titles (`config-normalizer.js`)

- `normalizeConfig` on a config with a lesson whose `title` is `{en:'A', es:'B'}`, called with `lang='es'` → `lesson.title === 'A'`.
- `normalizeConfig` on a lesson whose `title` is the plain string `'Make 3 questions…'` → unchanged.
- The canonical `wouldrather.json` lesson `a.title` is a plain English string (config assertion).

### Task 4 - Profile render (`FriendLessonLinksSection.jsx` + `.test.jsx`)

- Given a profile with two active entries (same course, distinct `lessonTitle`/`recordedLessonId`, targets `b` and `d`), the section renders a course-name heading and two `friend-lesson-link` anchors; each `href` points at its own target lesson (`/course/<courseId>/lesson/<lessonId>?shareCode=<shareCode>`) and each label equals its own `lessonTitle`.
- Given entries across two courses, two headings render (grouped, not interleaved); a group whose entries lack `courseName` shows the `courseId` as its heading (never blank).
- Given an entry with an empty `lessonTitle`, its anchor falls back to the generic `profile_friend_lesson_link` copy (a visible, clickable label) and still links correctly — it never renders an empty/zero-width anchor.
- Only-expired entries → section renders nothing (`friend-lesson-links` absent); no entries → `null`.
- Each link still renders its own `profile_friend_link_available` countdown from `addedAt`.
- Update the existing `FriendLessonLinksSection.test.jsx` (story 039) to the grouped, per-lesson shape; update `tests/friend-lesson-link.spec.js` fixtures to include `recordedLessonId`/`courseName` and assert the grouped render (Playwright run is environment-gated, see Notes).

### Task 5 - Export wiring (`SuccessButtons.jsx`)

- Block-scoped source guard: the `resolveFriendLessonLink({ … })` call passes `courseName: configData?.courseName` (and still passes `configData`, `lessonId`, `courseId`, `shareCode`, `succeeded`), records via `friendLinkMutation.mutateAsync({ userId, entry: { ...payload, addedAt } })`, and stays inside the non-fatal block.

### Task 6 - Promote the canonical config

- `src/config/wouldrather.json` = the reviewed `a`–`f` chain: lessons `['a'..'f']` in order, every lesson `recapOverlay:'shareCta'`, `a` `recapSources:'none'` and `b`–`f` `'friend'`, all `title`s plain English strings.
- Each `c`–`e` plays `{friendCode}wouldrather-<prev>-response-04..06` as `viewAndContinue` and records its own answers `<lessonId>-01..03` then new asks `-04..06`; `b` plays the first ask set `{friendCode}wouldrather-a-response-01..03`; `a` records asks `-01..03`; `f` plays `{friendCode}wouldrather-e-response-04..06` and is terminal (no new asks).
- Lesson `a`'s `viewAndContinue` (`testvideointro`) and `success` (`enda`) steps each carry **all four locales** (`en`,`es`,`pt`,`bn`) of non-empty timed SRT (contains `-->`), so the existing `wouldrather.test.js` caption assertions pass unchanged. (The reviewed exercise config was missing `pt`/`bn` on `testvideointro` — restore them.)
- `src/config/wouldrather-exercise.json` is deleted.
- Update `friend-lesson-link-config.test.js`'s `wouldrather` case to expect the chain over `a..f`: `nextFriendLessonId(a)='b'` … `nextFriendLessonId(e)='f'`, `nextFriendLessonId(f)=null`.
- Full `npx vitest run` passes with the promoted config.

## Notes

- **Course heading from `courseName`, grouping key from `courseId`.** Two courses can share a display name (an accident to avoid, but the code must not merge them); grouping is by `courseId`, the heading shows `courseName`.
- **Label is the recorded lesson's English title.** `normalizeConfig` normalizes the title to English before export, so the stored `lessonTitle` is English without extra work; the visitor reading English is the cue they asked for.
- **No "already played" indicator is built.** Reuse relies on the browser's own cache of the R2 clips within 48h. No new storage, no R2 polling.
- **Future: respond-to-friend overlay.** The end-of-lesson `shareCta` overlay (`SuccessScreen.jsx`/`SuccessButtons.jsx`) is the intended future home of a second line — "your other friend has recorded videos, go respond" — linking the user to a lesson they have not answered. That feature needs a *different* data source than this story provides: this story's entries live on **other people's** profiles (they point at lessons **you** answer), and there is no index of "profiles that reference me". Groundwork kept here: keep the entry/target/label rules in the pure `friend-lesson-link-logic.js` so a future "open links for viewer" lookup can reuse `buildFriendLessonLink`/`nextFriendLessonId` without reworking the profile component. Do not build the overlay now.
- **Build/test:** no new dependency; `npx vitest run` (vitest + jsdom). Playwright specs need real Chrome (`agents.md` §5).
