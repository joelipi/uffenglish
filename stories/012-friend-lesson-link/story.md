# Friend-challenge answer-lesson link on the public profile (48h, with countdown)

## Context

When a learner finishes friend-challenge **ask** lesson `a` (`src/config/friend.json`) and exports the video, their recorded question clips are published to R2 under `videos/{shareCode}-{courseId}-{lessonId}-response-NN.mp4` (`src/modules/video/video-processor.web.js:1234-1365`). A friend can then open the asker's share URL (`example.com/<shareCode>`) and answer the questions in the matching **answer** lesson `b`. Today the public profile page (`/:shareCode` → `src/components/profile/PublicProfile.jsx`) shows only name, share code, and lesson stats — nothing points a friend at lesson `b`, and the R2 clips silently expire after 48h (Cloudflare lifecycle, `README.md:100`; `SHARE_WINDOW_HOURS = 48`, `src/modules/video/video-processor-logic.js:20`) with no visible deadline.

This story adds, on the **publicly facing** profile, one prominent link per exported lesson-`a` video. The mapping is **fixed and deterministic**: ask lesson `a` → answer lesson `b` in the same course. There is no config field and no lookup. The link targets:

```
<SHARE_URL_BASE>/course/<courseId>/lesson/b?shareCode=<shareCode>
```

The link text is "Practice English with Me" (large), and the link is rendered only while it is within 48 hours of being added — the same window the R2 clips live — with a countdown showing how much time is left.

## Out of Scope

- **Any configurable or automatic answer-lesson resolution.** The mapping is hard-coded (ask `a` → answer `b`); there is no `answerLessonId` config field and no slug/lesson lookup.
- **A new table or RLS policy.** The link data is one new `jsonb` column on `public.user_profiles`, made publicly readable through the existing anon column GRANT and the existing `public.public_profiles` view (migration follows `003_harden_public_read_and_view.sql`). No new table, no new policy.
- **The owner's own `/profile` page.** `src/components/profile/UserProfile.jsx` is not changed. The link renders only on the public profile (`PublicProfile.jsx`, route `/:shareCode`).
- **Any cleanup job, cron, or row/field deletion.** Expiry is a **render-time** rule: an entry is shown while `addedAt + 48h > now`. Expired entries remain in the column but are never surfaced.
- **Courses without a lesson `b`.** `src/config/model.json` and `src/config/gt2.json` each have a lesson `a` but no `b`; completing/exporing their lesson `a` correctly produces no link (guard below).
- **Changing R2 lifecycle, `SHARE_URL_BASE`, `SHARE_WINDOW_HOURS`, `buildShareUrl`, `buildShareDeadline`, or the `share_cta_*` strings.** This story reuses `SHARE_URL_BASE` and `SHARE_WINDOW_HOURS`; it does not introduce a second constant or a second window.
- **Backfilling links for videos exported before this ships.** Only exports performed after the change create an entry.
- **The native processor** (`src/modules/video/video-processor.native.jsx`, dead-code reference) beyond keeping the `exportSegmentsToR2` return contract consistent.
- **Changing what counts as a publishable clip.** The existing `succeeded` count in `exportSegmentsToR2` (one per successfully uploaded webcam segment) is the sole "video was exported" signal.

## Implementation approach

### 1. Fixed mapping (no config, no lookup)

The ask lesson id and answer lesson id are constants:

```js
export const ASK_LESSON_ID = 'a';
export const ANSWER_LESSON_ID = 'b';
```

Trigger: the exported lesson's id is `ASK_LESSON_ID` (`'a'`) in any course. Target: lesson `ANSWER_LESSON_ID` (`'b'`) in the same course. Guard: the loaded course config must actually contain a lesson with id `'b'`, so we never link to a nonexistent lesson. Under the current configs:

| file | has lesson `a`? | has lesson `b`? | link created? |
|---|---|---|---|
| `src/config/friend.json` | yes | yes | **yes** → `/course/friend/lesson/b` |
| `src/config/model.json` | yes | no | no (guard) |
| `src/config/gt2.json` | yes | no | no (guard) |
| `src/config/t.json` | no | no | no (lesson id is never `a`) |
| `src/config/test-api.json` | no | no | no |

`courseId` is the **route/store** course id (the config filename: `friend`, `model`, …) — **not** `configData.courseId`, which for `friend.json` is the unrelated `"20260921"`. The R2 key already uses the store course id (`video-processor.web.js:1333`), so the link and the clips share one namespace.

### 2. Pure link / expiry logic — `src/modules/user/friend-lesson-link-logic.js` (new)

All share constants stay single-sourced from `src/modules/video/video-processor-logic.js`; this module imports them (no new literals):

```js
import { SHARE_URL_BASE, SHARE_WINDOW_HOURS } from '../video/video-processor-logic.js';

export const ASK_LESSON_ID = 'a';
export const ANSWER_LESSON_ID = 'b';
export const FRIEND_LINK_WINDOW_MS = SHARE_WINDOW_HOURS * 60 * 60 * 1000; // 48h

// Bare host/path, matching buildShareUrl's scheme-less convention.
export function buildFriendLessonLink({ courseId, lessonId, shareCode, base = SHARE_URL_BASE }) {
    return `${base}/course/${courseId}/lesson/${lessonId}?shareCode=${shareCode}`;
}

// A clickable anchor needs a scheme; SHARE_URL_BASE is deliberately scheme-less.
export function toFriendLessonHref(url) {
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function getFriendLinkRemainingMs(addedAtMs, nowMs) {
    return Math.max(0, addedAtMs + FRIEND_LINK_WINDOW_MS - nowMs);
}

export function isFriendLinkActive(addedAtMs, nowMs) {
    return getFriendLinkRemainingMs(addedAtMs, nowMs) > 0;
}

// null when expired (caller hides the link). Minute granularity, floor.
export function formatFriendLinkRemaining(remainingMs) {
    if (!(remainingMs > 0)) return null;
    const totalMinutes = Math.floor(remainingMs / 60000);
    if (totalMinutes >= 60) return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
    return `${totalMinutes}m`;
}

// Immutable merge for the `friend_links` jsonb column. One entry per course
// (the ask lesson is always 'a'), so the course id is the map key.
export function upsertFriendLinkMap(existing, entry) {
    const map = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? existing : {};
    return { ...map, [entry.courseId]: entry };
}

// Entries that are still inside the 48h window, newest first.
export function listActiveFriendLinks(friendLinks, nowMs) {
    if (!friendLinks || typeof friendLinks !== 'object' || Array.isArray(friendLinks)) return [];
    return Object.values(friendLinks)
        .filter((e) => e && e.addedAt && isFriendLinkActive(new Date(e.addedAt).getTime(), nowMs))
        .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
}

// Gate + payload for recording a link at export time. Pure; no store/Supabase.
// Hard-coded a -> b mapping; no config field, no lookup.
export function resolveFriendLessonLink({ configData, lessonId, courseId, shareCode, succeeded }) {
    if (!succeeded || !shareCode || !configData?.lessons) return null;
    if (lessonId !== ASK_LESSON_ID) return null;
    if (!configData.lessons.some((l) => l.lessonId === ANSWER_LESSON_ID)) return null; // guard
    return { courseId, shareCode };
}
```

The stored entry shape (what `upsertFriendLinkMap` writes) is:

```json
{ "courseId": "friend", "shareCode": "ab12",
  "addedAt": "2026-09-24T11:00:00.000Z" }
```

The target lesson id is **not** stored per entry: it is the fixed `ANSWER_LESSON_ID` (`'b'`) constant, applied by the UI when building the href.

### 3. UI copy — `src/data/strings.js`

Add two keys (six languages, en/es/pt/fr/hi/bn, matching the `share_cta_*` key style):

| key | en | es | pt | fr | hi | bn |
|---|---|---|---|---|---|---|
| `profile_friend_lesson_link` | `Practice English with Me` | `Practica inglés conmigo` | `Pratique inglês comigo` | `Pratique l'anglais avec moi` | `मेरे साथ अंग्रेज़ी का अभ्यास करें` | `আমার সাথে ইংরেজি চর্চা করুন` |
| `profile_friend_link_available` | `Available for {time}` | `Disponible por {time}` | `Disponível por {time}` | `Disponible pendant {time}` | `{time} तक उपलब्ध` | `{time} পর্যন্ত উপলব্ধ` |

`src/data/strings.test.js` auto-derives placeholder keys from the `en` value and interpolates them with a fixed map (`{ score, date, bad_intent }`). Because `profile_friend_link_available` introduces `{time}`, that test's placeholder map must add `time` (e.g. `time: '47h 0m'`) so the "replaces {placeholders} for hi and bn" case passes. The existing hi/bn script assertions then cover the two new keys automatically.

### 4. Storage — `supabase/migrations/004_add_friend_links_to_profiles.sql` (new)

One new publicly readable `jsonb` column on `user_profiles`, following `003_harden_public_read_and_view.sql`. No new table, no new RLS policy:

```sql
-- 004_add_friend_links_to_profiles.sql
-- Publicly readable friend-challenge answer-lesson links, stored as jsonb on
-- user_profiles. Follows 003: add the column to the anon column GRANT and the
-- public_profiles view. No new table, no new RLS policy.
alter table public.user_profiles
  add column if not exists friend_links jsonb not null default '{}'::jsonb;

-- 003 revoked anon's table-level SELECT and re-granted a fixed column list;
-- extend it with the new column.
grant select (friend_links) on table public.user_profiles to anon;

-- Refresh the safe public view (append the new column at the end, which
-- CREATE OR REPLACE allows) and keep the existing anon/authenticated read.
create or replace view public.public_profiles as
select
  id, first_name, last_name, native_language, english_level, join_date,
  share_code, profile_picture_url, completed_dates, lessons_completed,
  counted_lessons, total_fluency_sum, recent_fluency_avgs, created_at,
  account_status,
  friend_links
from public.user_profiles
where share_code is not null;

grant select on public.public_profiles to anon, authenticated;
```

Writes need no new grant: `002` already granted table-level `update` on `user_profiles` to `authenticated` (table-level UPDATE covers later columns) and `001`'s `"owner update"` policy already scopes writes to `auth.uid() = id`. Anon can read only `friend_links` (course/answer ids, share code, timestamp — no PII) and only on rows with a `share_code`, exactly as the existing view.

### 5. Data access — `src/modules/api/api.js` (TanStack Query, per `agents.md`)

- `fromDbRow` (line 52) adds the back-compat alias `friendLinks: row.friend_links` so `useUserByShareCode` consumers (and `appStore.userData`) see camelCase.
- `useUserByShareCode`'s `SAFE_COLS` fallback (line 296) adds `friend_links`.
- New owner-side write mutation (the public read path already exists via `useUserByShareCode`):

```js
export function useAddFriendLinkMutation() {
    const queryClientHook = useQueryClient();
    return useMutation({
        mutationFn: async ({ userId, entry }) => {
            // Read the current map, merge, then persist the whole map (jsonb).
            const { data: row, error: readError } = await supabase
                .from('user_profiles').select('friend_links').eq('id', userId).single();
            if (readError) throw readError;
            const merged = upsertFriendLinkMap(row?.friend_links, entry);
            const { error } = await supabase
                .from('user_profiles').update({ friend_links: merged }).eq('id', userId);
            if (error) throw error;
            console.log('[friendLessonLink] saved', entry);
            return merged;
        },
        onSuccess: () => {
            // Prefix-matches both ['user','profile'] and ['user','profile','shareCode', code].
            queryClientHook.invalidateQueries({ queryKey: ['user', 'profile'] });
        },
        onError: (error) => console.error('🚨 useAddFriendLinkMutation error:', error),
    });
}
```

`upsertFriendLinkMap` is imported from the new pure module. The read-then-write is intentionally simple (last-write-wins per course); the column is tiny and per-user.

### 6. Record the link on export

`exportSegmentsToR2` (`src/modules/video/video-processor.web.js:1234`) returns a result so the caller can gate on real success:

- Early returns (not logged in, no `shareCode`, no publishable segments) → `return { count: 0, succeeded: 0 };`
- Final line → `return { count: publishable.length, succeeded };`

In `src/components/widgets/SuccessButtons.jsx`:

- Import `useAddFriendLinkMutation` from `../../modules/api/api.js` and `resolveFriendLessonLink` from `../../modules/user/friend-lesson-link-logic.js`.
- In `VideoButton`, call `const friendLinkMutation = useAddFriendLinkMutation();` at the top (hooks rule) and add it to `runProcessing`'s `useCallback` deps.
- Replace the fire-and-forget publish (`SuccessButtons.jsx:83-85`) with an awaited call + write:

```js
if (publishSegments) {
    const exportResult = await exportSegmentsToR2(lessonId);
    const { configData, courseId, userData } = appStore.getState();
    const payload = resolveFriendLessonLink({
        configData, lessonId, courseId, shareCode: userData?.shareCode, succeeded: exportResult?.succeeded,
    });
    if (payload) {
        try {
            await friendLinkMutation.mutateAsync({
                userId: userData.$id,
                entry: { ...payload, addedAt: new Date().toISOString() },
            });
            trackEvent('friend_lesson_link_created', payload);
        } catch (e) {
            console.error('[Success] friend lesson link save failed:', e); // non-fatal
        }
    }
}
```

`publishSegments` is already `isLoggedIn && userData.auth_method === 'supabase' && userData.$id !== 'guest'` (`SuccessButtons.jsx:102-108`), so guests never reach this path; `resolveFriendLessonLink` additionally requires `lessonId === 'a'`, a `shareCode`, a course that contains lesson `b`, and `succeeded > 0`. A DB failure is logged, never surfaced as a video-generation error.

### 7. Public-profile UI + countdown — `src/components/profile/FriendLessonLinksSection.jsx` (new)

A self-contained **presentational** section (no new dependency, pure React, no DOM APIs, no data fetching — the profile data is already loaded by `useUserByShareCode`):

- `FriendLessonLinksSection({ friendLinks, lang })` calls `listActiveFriendLinks(friendLinks, Date.now())`; returns `null` when there are no active entries (so the public layout is unchanged for users with no friend videos).
- Each active entry renders `FriendLessonLink`, which keeps its own `now` in state and refreshes it with a `setInterval(..., 1000)` (cleared on unmount), recomputes `getFriendLinkRemainingMs`, and returns `null` once the window passes — so an open public profile removes the link live at the 48h mark.
- The anchor uses `href={toFriendLessonHref(buildFriendLessonLink({ courseId: e.courseId, lessonId: ANSWER_LESSON_ID, shareCode: e.shareCode }))}` (the section imports `ANSWER_LESSON_ID`) and text `Strings.get('profile_friend_lesson_link', lang)` at `fontSize: '32px'`, `fontWeight: 800`. The countdown renders `Strings.get('profile_friend_link_available', lang, { time: formatFriendLinkRemaining(remainingMs) })`.
- Test hooks: container `data-testid="friend-lesson-links"`, anchor `data-testid="friend-lesson-link"`, countdown `data-testid="friend-lesson-link-countdown"`.
- `PublicProfile.jsx` reads `const friendLinks = profile?.friendLinks;` and renders `<FriendLessonLinksSection friendLinks={friendLinks} lang={lang} />` in the content column, before the stats card. `lang` follows the page's existing convention (the profile owner's `native_language`); no separate viewer-language lookup is added.

### 8. Edge cases

- **Exported lesson id is not `'a'`** (e.g. the answer lesson `b`, or any other lesson): `resolveFriendLessonLink` returns `null`.
- **Course has no lesson `b`** (`model.json`, `gt2.json`): guard returns `null` → no link, even though they have a lesson `a`.
- **Guest / logged-out export**: `publishSegments` false → no write.
- **Logged-in but no `shareCode`**: `null`.
- **Export produced zero uploaded segments** (`succeeded === 0`): `null` → no entry.
- **Re-export of lesson `a` in the same course**: `upsertFriendLinkMap` replaces that course's `addedAt` → the window restarts; other courses' entries are preserved.
- **Multiple courses**: one entry per course, keyed by `courseId`; both links render.
- **Exactly 48h old**: `remainingMs === 0` → inactive → hidden (removal boundary is inclusive at 48h).
- **Sub-minute remaining**: countdown shows `0m` but the link is still active until `remainingMs === 0`.
- **`friendLinks` missing / `{}` / non-object / array**: `listActiveFriendLinks` returns `[]` → section renders nothing.
- **Malformed entry without `addedAt`**: filtered out.

## Tasks

### Task 1 - Fixed mapping premise + pure link/expiry/merge logic (`src/config/friend-lesson-link-config.test.js` and `src/modules/user/friend-lesson-link-logic.test.js`, both new)

- `src/config/friend.json` parsed
  - → contains a lesson with `lessonId === 'a'` and a lesson with `lessonId === 'b'`
- `src/config/model.json` parsed
  - → contains a lesson `'a'` and no lesson `'b'` (guard would suppress)
- `src/config/gt2.json` parsed
  - → contains a lesson `'a'` and no lesson `'b'` (guard would suppress)
- `buildFriendLessonLink({ courseId: 'friend', lessonId: 'b', shareCode: 'ab12' })`
  - → `'example.com/course/friend/lesson/b?shareCode=ab12'`
- `buildFriendLessonLink` called with an explicit `base`
  - → the returned string uses that base and still contains `/course/<courseId>/lesson/<lessonId>?shareCode=<shareCode>`
- `toFriendLessonHref('example.com/course/friend/lesson/b?shareCode=ab12')`
  - → `'https://example.com/course/friend/lesson/b?shareCode=ab12'`
- `toFriendLessonHref('https://x/y')` and `toFriendLessonHref('http://x/y')`
  - → returned unchanged
- `getFriendLinkRemainingMs(addedAt, addedAt)` / `(addedAt, addedAt + 48h)` / `(addedAt, addedAt + 49h)`
  - → `172800000` / `0` / `0` (clamped, never negative)
- `isFriendLinkActive(addedAt, addedAt + 48h - 1)` / `(addedAt, addedAt + 48h)`
  - → `true` / `false`
- `formatFriendLinkRemaining(48h)` / `(47h)` / `(90m)` / `(59m)` / `(30s)`
  - → `'48h 0m'` / `'47h 0m'` / `'1h 30m'` / `'59m'` / `'0m'`
- `formatFriendLinkRemaining(0)`, `(-1)`, `(null)`, `(undefined)`
  - → `null` for each
- `upsertFriendLinkMap(null, entryFriend)` and `upsertFriendLinkMap({}, entryFriend)`
  - → `{ friend: entryFriend }` for each (non-object/absent input treated as empty)
- `upsertFriendLinkMap({ friend: entryFriend }, entryOther)` where `entryOther.courseId === 'other'`
  - → both `friend` and `other` keys present (no clobber)
- `upsertFriendLinkMap({ friend: oldEntry }, newEntryFriend)` with the same course key
  - → the key maps to `newEntryFriend` (addedAt replaced)
- `upsertFriendLinkMap` called with an input map
  - → the input object is not mutated
- `listActiveFriendLinks(map, now)` where the map has one entry added 1h ago and one added 48h ago
  - → only the 1h-ago entry, and only one element
- `listActiveFriendLinks(null, now)`, `({}, now)`, `('x', now)`, `([entry], now)`
  - → `[]` for each
- `listActiveFriendLinks` with entries whose `addedAt` is missing/invalid
  - → those entries are excluded
- `resolveFriendLessonLink` with `lessonId: 'a'`, a config containing a lesson `'b'`, `succeeded: 3`, `shareCode: 'ab12'`, `courseId: 'friend'`
  - → `{ courseId: 'friend', shareCode: 'ab12' }`
- `resolveFriendLessonLink` with a config that has lesson `'a'` but no `'b'` (`succeeded: 3`, `shareCode: 'ab12'`, `lessonId: 'a'`)
  - → `null` (guard)
- `resolveFriendLessonLink` with `lessonId: 'b'`, `lessonId: 'w'`, and `lessonId: ''`
  - → `null` for each (ask lesson must be `'a'`)
- `resolveFriendLessonLink` with `succeeded: 0` and with `shareCode: ''`
  - → `null` for each
- `resolveFriendLessonLink` called with `configData: null` / `undefined`
  - → `null` for each

### Task 2 - UI strings (`src/data/strings.test.js` updated)

- `Strings.get('profile_friend_lesson_link', lang)` for `lang` in `en/es/pt/fr/hi/bn`
  - → the exact copy from the §3 table
- `Strings.get('profile_friend_link_available', lang, { time: '47h 0m' })` for `lang` in `en/es/pt/fr/hi/bn`
  - → the localized label with `{time}` replaced and no `{`/`}` remaining
- `get('profile_friend_lesson_link', 'hi')` / `('bn')`
  - → matches Devanagari / Bengali script (existing hi/bn coverage test still passes)
- `src/data/strings.test.js` placeholder map includes `time`
  - → the auto-derived placeholder test passes for `profile_friend_link_available` in hi and bn

### Task 3 - Migration (`supabase/migrations/004_add_friend_links_to_profiles.sql`, new; static guard test `src/modules/api/friend-links-migration.test.js`)

- `004_add_friend_links_to_profiles.sql` read as text
  - → contains `alter table public.user_profiles` and `add column if not exists friend_links jsonb`
  - → contains `grant select (friend_links) on table public.user_profiles to anon`
  - → the `create or replace view public.public_profiles` body contains `friend_links`
  - → contains `grant select on public.public_profiles to anon, authenticated`
  - → contains no `create table` (no new table)
  - → contains no `create policy` (no new RLS policy)

### Task 4 - Record the link on export + public read plumbing (config-gated; logic covered by Task 1)

- `exportSegmentsToR2` source inspected (`src/modules/video/video-processor.web.js`)
  - → each early return yields `{ count: 0, succeeded: 0 }`
  - → the final return yields `{ count: publishable.length, succeeded }`
- `src/components/widgets/SuccessButtons.jsx` source inspected
  - → imports and calls `useAddFriendLinkMutation` and `resolveFriendLessonLink`
  - → awaits `exportSegmentsToR2` and passes `exportResult?.succeeded` into `resolveFriendLessonLink`
  - → calls the mutation with `{ userId, entry: { ...payload, addedAt } }` only when `resolveFriendLessonLink` returns non-null
  - → the write failure path is caught and logged (does not alert / abort the success screen)
- `src/modules/api/api.js` source inspected
  - → `fromDbRow` exposes `friendLinks: row.friend_links`
  - → `useUserByShareCode`'s `SAFE_COLS` fallback includes `friend_links`
  - → `useAddFriendLinkMutation` imports and uses `upsertFriendLinkMap`
- `src/modules/video/video-processor.native.jsx` source inspected
  - → the native `exportSegmentsToR2` stub returns `{ count: 0, succeeded: 0 }` (contract kept)

### Task 5 - Public-profile link + countdown UI (`tests/friend-lesson-link.spec.js`, new Playwright)

- `/friendtest1` loaded, then `queryClient.setQueryData(['user','profile','shareCode','friendtest1'], <profile with a `friend` entry added 1h ago>)` injected
  - → an element `[data-testid="friend-lesson-link"]` is visible
  - → its text is `Practice English with Me`
  - → its computed `font-size` is at least `24px`
  - → its `href` is `https://example.com/course/friend/lesson/b?shareCode=friendtest1`
  - → `[data-testid="friend-lesson-link-countdown"]` is visible and reads `Available for 47h 0m`
- `/friendtest1` loaded + a `friend` entry whose `addedAt` is exactly 48h before the fixed clock injected
  - → `[data-testid="friend-lesson-link"]` has count `0` (link removed)
- `/friendtest1` loaded + `friendLinks: {}` injected
  - → `[data-testid="friend-lesson-links"]` has count `0` (no empty section)
- `/friendtest1` loaded with no injected data (unresolved share code)
  - → `[data-testid="friend-lesson-link"]` has count `0`
- `/friendtest1` loaded + two active entries (`friend` and `other`) injected
  - → `[data-testid="friend-lesson-link"]` has count `2`

## Technical Context

- **No new dependencies.** Reuses React 19.2.0, `@tanstack/react-query` 5.100.14, `zustand` 5.0.13, `@supabase/supabase-js` 2.112.4, `react-router-dom` 7.15.1. Unit tests: vitest 4.1.6 + jsdom 29.1.1 (colocated `*.test.js`; `vitest.config.js` excludes `tests/**` and `*.spec.js`). Browser tests: `@playwright/test` 1.60.0 (`tests/*.spec.js`, `playwright.config.js`, `webServer: npx vite --port 5173`).
- **`SHARE_URL_BASE` is scheme-less** (`'example.com'`, `video-processor-logic.js:15`) by design — the recap CTA shows a bare host/path to be typed manually. For a clickable public-profile anchor the component prepends `https://` via `toFriendLessonHref`; the canonical link value returned by `buildFriendLessonLink` matches the brief exactly (`example.com/course/...`). If the base later becomes a real domain, only `SHARE_URL_BASE` changes.
- **`courseId` source of truth:** use `appStore.getState().courseId` (route param / config filename: `friend`, `model`) — **not** `configData.courseId` (`friend.json`'s is `"20260921"`). `AppLayout.jsx:31` sets the store course id from `useParams`, and `exportSegmentsToR2` already uses it for the R2 key (`video-processor.web.js:1333`).
- **Guard data:** only `friend.json` contains both `a` and `b`; `model.json` and `gt2.json` have `a` but no `b` (`grep '"lessonId": "b"' src/config/*.json` → only `friend.json:117`). The `configData.lessons.some(l => l.lessonId === 'b')` guard therefore suppresses those courses.
- **Public read path:** `useUserByShareCode` (`api.js:289-317`) queries the `public_profiles` view with `select('*')` when unauthenticated and falls back to `user_profiles` with `SAFE_COLS` on pre-migration deploys. Adding `friend_links` to the view + anon grant + `SAFE_COLS` keeps both branches working. `fromDbRow` (`api.js:52`) provides the `friendLinks` camelCase alias.
- **Route works with the query param:** `/course/:courseId/lesson/:lessonId` (`src/routes/routes.jsx:34`) and `App.jsx:19-37` reads the friend code case-insensitively (`sharecode`), so `?shareCode=` is captured.
- **Playwright determinism:** use `page.clock.setFixedTime(<ISO>)` before `page.goto('/<shareCode>')` (Playwright 1.60 supports `page.clock`), and stub Supabase REST (`page.route('**/rest/v1/**', ...)`) so the not-found state settles immediately. Then inject the fixture through the app's own singleton: `const { queryClient } = await import('/src/modules/api/api.js')` inside `page.evaluate` (same pattern as `tests/answer-flow.spec.js` importing `/src/modules/answer/answer-pipeline.js`). `main.jsx:15` passes that exact `queryClient` to `QueryClientProvider`, so `setQueryData(['user','profile','shareCode', code], profile)` drives the real `useUserByShareCode` hook. Its default `staleTime: Infinity` means injected data is not refetched.
- **Existing config tests are unaffected:** `src/config/friend.test.js` walks translation objects (locale keys) and `src/config/model.test.js` asserts step sequences only; no config field is added by this story. `src/modules/video/model-config.test.js` iterates all configs for recap flags and is unaffected.
- **`strings.test.js` coupling:** its placeholder test auto-derives keys from `en` and interpolates a fixed object; the new `{time}` key requires adding `time` to that object.

## Notes

- **Assumption (stated, not guessed silently):** the anchor `href` prepends `https://` because `SHARE_URL_BASE` is intentionally scheme-less; the link **text** is the localized "Practice English with Me" (the URL is never displayed). If the desired `href` must be the bare `example.com/...` string, only `toFriendLessonHref` and its two unit assertions change.
- **Assumption:** the `friend_links` map is keyed by `courseId` (one ask lesson `a` per course), so at most one entry per course; re-exporting lesson `a` resets that course's entry. Each entry stores `{ courseId, shareCode, addedAt }`; the target lesson is the fixed `ANSWER_LESSON_ID` constant, not stored. If more than one entry per course is ever needed, only `upsertFriendLinkMap` and its assertions change.
- **Assumption:** the countdown label is a localized string with a `{time}` placeholder rendered as `47h 0m` (minute granularity), and `lang` is the profile owner's `native_language`, matching how `PublicProfile.jsx` already localizes all its copy. If a different granularity or the viewer's language is wanted, only `formatFriendLinkRemaining` / the section's `lang` prop change.
- **Manual verification** (Supabase RLS + real export cannot be exercised headlessly; the logic is covered by Tasks 1-4):
  1. Apply `004_add_friend_links_to_profiles.sql` to the Supabase project (or local stack).
  2. `npm run dev`, log in, open `/course/friend/lesson/a`, complete it, click the process/generate button; confirm `user_profiles.friend_links` gains a `"friend"` entry with `shareCode` and a fresh `addedAt`.
  3. Open the owner's public profile `/<shareCode>` (logged out, to exercise the anon view): the large "Practice English with Me" link and countdown appear; clicking it lands on `/course/friend/lesson/b?shareCode=<code>`.
  4. Re-export lesson `a`: the `"friend"` entry's `addedAt` resets.
  5. Confirm the guard: complete and export `/course/model/lesson/a` (model has no lesson `b`) → no entry, no link.
  6. Repeat as a guest: no write, no link.
- **Console discipline (`agents.md`):** the new success path logs on failure (`console.error`) and success (`console.log` in the mutation, `trackEvent('friend_lesson_link_created')`). Do not remove existing logs.
