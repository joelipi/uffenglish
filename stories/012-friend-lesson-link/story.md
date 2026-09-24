# Friend-challenge answer-lesson link on the public profile (48h, with countdown)

## Context

When a learner finishes a friend-challenge **ask** lesson (`a` in `src/config/friend.json`; `w` and `wf` in `src/config/model.json`) and exports the video, their recorded question clips are published to R2 under `videos/{shareCode}-{courseId}-{lessonId}-response-NN.mp4` (`src/modules/video/video-processor.web.js:1234-1365`). A friend can then open the asker's share URL (`example.com/<shareCode>`) and answer the questions in the matching **respond** lesson (`b`, `wa`, `wfa`). Today the public profile page (`/:shareCode` → `src/components/profile/PublicProfile.jsx`) shows only name, share code, and lesson stats — nothing points a friend at the respond lesson, and the R2 clips silently expire after 48h (Cloudflare lifecycle, `README.md:100`; `SHARE_WINDOW_HOURS = 48`, `src/modules/video/video-processor-logic.js:20`) with no visible deadline.

This story adds, on the **publicly facing** profile, one prominent link per exported friend-challenge ask video. The link targets the matching answer lesson:

```
<SHARE_URL_BASE>/course/<courseId>/lesson/<answerLessonId>?shareCode=<shareCode>
```

The link text is "Practice English with Me" (large), and the link is rendered only while it is within 48 hours of being added — the same window the R2 clips live — with a countdown showing how much time is left.

The answer lesson is resolved **explicitly** from a new lesson-level config field, `answerLessonId`; there is no automatic/slug-based lookup (explicitly rejected as over-engineered).

## Out of Scope

- **Automatic / slug-based answer-lesson resolution.** The mapping is authored explicitly in `src/config/*.json` via `answerLessonId`.
- **A new table or RLS policy.** The link data is one new `jsonb` column on `public.user_profiles`, made publicly readable through the existing anon column GRANT and the existing `public.public_profiles` view (migration follows `003_harden_public_read_and_view.sql`). No new table, no new policy.
- **The owner's own `/profile` page.** `src/components/profile/UserProfile.jsx` is not changed. The link renders only on the public profile (`PublicProfile.jsx`, route `/:shareCode`).
- **Any cleanup job, cron, or row/field deletion.** Expiry is a **render-time** rule: an entry is shown while `addedAt + 48h > now`. Expired entries remain in the column but are never surfaced.
- **Adding `answerLessonId` to any lesson that has no matching respond lesson** (notably `t.json` lesson `y` — see the mapping table). No link is created for such lessons.
- **Changing R2 lifecycle, `SHARE_URL_BASE`, `SHARE_WINDOW_HOURS`, `buildShareUrl`, `buildShareDeadline`, or the `share_cta_*` strings.** This story reuses `SHARE_URL_BASE` and `SHARE_WINDOW_HOURS`; it does not introduce a second constant or a second window.
- **Backfilling links for videos exported before this ships.** Only exports performed after the change create an entry.
- **The native processor** (`src/modules/video/video-processor.native.jsx`, dead-code reference) beyond keeping the `exportSegmentsToR2` return contract consistent.
- **Changing what counts as a publishable clip.** The existing `succeeded` count in `exportSegmentsToR2` (one per successfully uploaded webcam segment) is the sole "video was exported" signal.

## Implementation approach

### 1. Config: explicit `answerLessonId` (ask lesson → answer lesson)

Add one optional lesson-level string, `answerLessonId`, using the existing camelCase config convention (`lessonId`, `nextLessonId`, `recapSources`). The field lives on the **ask** lesson and names the respond lesson in the **same** config file.

| file | ask lesson | `answerLessonId` | answer lesson exists? |
|---|---|---|---|
| `src/config/friend.json` | `a` | `"b"` | yes (`b`) |
| `src/config/model.json` | `w` | `"wa"` | yes (`wa`) |
| `src/config/model.json` | `wf` | `"wfa"` | yes (`wfa`) |
| `src/config/t.json` | `y` | **absent** | — (see below) |
| every other lesson | — | absent | — |

`t.json` lesson `y` carries `friendClosedResponse` steps but there is no respond lesson in `t.json` to answer them (`y`'s `nextLessonId` is `a`, a normal lesson). Because there is no valid target, `y` gets **no** `answerLessonId`, so exporting it creates no profile link. This is a deliberate, documented decision (the config test asserts it).

### 2. Pure link / expiry logic — `src/modules/user/friend-lesson-link-logic.js` (new)

All share constants stay single-sourced from `src/modules/video/video-processor-logic.js`; this module imports them (no new literals):

```js
import { SHARE_URL_BASE, SHARE_WINDOW_HOURS } from '../video/video-processor-logic.js';

export const FRIEND_LINK_WINDOW_MS = SHARE_WINDOW_HOURS * 60 * 60 * 1000; // 48h

// Bare host/path, matching buildShareUrl's scheme-less convention.
export function buildFriendLessonLink({ courseId, answerLessonId, shareCode, base = SHARE_URL_BASE }) {
    return `${base}/course/${courseId}/lesson/${answerLessonId}?shareCode=${shareCode}`;
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

// jsonb map key. `model.json` has TWO ask lessons (`w`, `wf`) in one course, so
// a course-only key would clobber; include the ask lesson id.
export function friendLinkKey(courseId, askLessonId) {
    return `${courseId}:${askLessonId}`;
}

// Immutable merge for the `friend_links` jsonb column.
export function upsertFriendLinkMap(existing, entry) {
    const map = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? existing : {};
    return { ...map, [friendLinkKey(entry.courseId, entry.askLessonId)]: entry };
}

// Entries that are still inside the 48h window, newest first.
export function listActiveFriendLinks(friendLinks, nowMs) {
    if (!friendLinks || typeof friendLinks !== 'object' || Array.isArray(friendLinks)) return [];
    return Object.values(friendLinks)
        .filter((e) => e && e.addedAt && isFriendLinkActive(new Date(e.addedAt).getTime(), nowMs))
        .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
}

// Gate + payload for recording a link at export time. Pure; no store/Supabase.
export function resolveFriendLessonLink({ configData, lessonId, courseId, shareCode, succeeded }) {
    if (!succeeded || !shareCode || !configData?.lessons) return null;
    const lesson = configData.lessons.find((l) => l.lessonId === lessonId);
    const answerLessonId = lesson?.answerLessonId;
    if (!answerLessonId) return null;
    if (!configData.lessons.some((l) => l.lessonId === answerLessonId)) return null; // defensive
    return { courseId, askLessonId: lessonId, answerLessonId, shareCode };
}
```

`courseId` here is the **route/store** course id (the config filename: `friend`, `model`) — **not** `configData.courseId`, which for `friend.json` is the unrelated `"20260921"`. The R2 key already uses the store course id (`video-processor.web.js:1333`), so the link and the clips share one namespace.

The stored entry shape (what `upsertFriendLinkMap` writes) is:

```json
{ "courseId": "friend", "askLessonId": "a", "answerLessonId": "b",
  "shareCode": "ab12", "addedAt": "2026-09-24T11:00:00.000Z" }
```

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

Writes need no new grant: `002` already granted table-level `update` on `user_profiles` to `authenticated` (table-level UPDATE covers later columns) and `001`'s `"owner update"` policy already scopes writes to `auth.uid() = id`. Anon can read only `friend_links` (course/lesson ids, share code, timestamp — no PII) and only on rows with a `share_code`, exactly as the existing view.

### 5. Data access — `src/modules/api/api.js` (TanStack Query, per `agents.md`)

- `fromDbRow` (line 52) adds the back-compat alias `friendLinks: row.friend_links` so `useUserByShareCode` consumers (and `appStore.userData`) see camelCase.
- `useUserByShareCode`'s `SAFE_COLS` fallback (line 296) adds `friend_links`.
- New owner-side write mutation (the public read path already exists via `useUserByShareCode`):

```js
export function useAddFriendLinkMutation() {
    const queryClientHook = useQueryClient();
    return useMutation({
        mutationFn: async ({ userId, shareCode, entry }) => {
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

`upsertFriendLinkMap` is imported from the new pure module. The read-then-write is intentionally simple (last-write-wins per entry); the column is tiny and per-user.

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
                shareCode: payload.shareCode,
                entry: { ...payload, addedAt: new Date().toISOString() },
            });
            trackEvent('friend_lesson_link_created', payload);
        } catch (e) {
            console.error('[Success] friend lesson link save failed:', e); // non-fatal
        }
    }
}
```

`publishSegments` is already `isLoggedIn && userData.auth_method === 'supabase' && userData.$id !== 'guest'` (`SuccessButtons.jsx:102-108`), so guests never reach this path; `resolveFriendLessonLink` additionally requires `shareCode`, a lesson with `answerLessonId`, and `succeeded > 0`. A DB failure is logged, never surfaced as a video-generation error.

### 7. Public-profile UI + countdown — `src/components/profile/FriendLessonLinksSection.jsx` (new)

A self-contained **presentational** section (no new dependency, pure React, no DOM APIs, no data fetching — the profile data is already loaded by `useUserByShareCode`):

- `FriendLessonLinksSection({ friendLinks, lang })` calls `listActiveFriendLinks(friendLinks, Date.now())`; returns `null` when there are no active entries (so the public layout is unchanged for users with no friend videos).
- Each active entry renders `FriendLessonLink`, which keeps its own `now` in state and refreshes it with a `setInterval(..., 1000)` (cleared on unmount), recomputes `getFriendLinkRemainingMs`, and returns `null` once the window passes — so an open public profile removes the link live at the 48h mark.
- The anchor uses `href={toFriendLessonHref(buildFriendLessonLink({ courseId: e.courseId, answerLessonId: e.answerLessonId, shareCode: e.shareCode }))}` and text `Strings.get('profile_friend_lesson_link', lang)` at `fontSize: '32px'`, `fontWeight: 800`. The countdown renders `Strings.get('profile_friend_link_available', lang, { time: formatFriendLinkRemaining(remainingMs) })`.
- Test hooks: container `data-testid="friend-lesson-links"`, anchor `data-testid="friend-lesson-link"`, countdown `data-testid="friend-lesson-link-countdown"`.
- `PublicProfile.jsx` reads `const friendLinks = profile?.friendLinks;` and renders `<FriendLessonLinksSection friendLinks={friendLinks} lang={lang} />` in the content column, before the stats card. `lang` follows the page's existing convention (the profile owner's `native_language`); no separate viewer-language lookup is added.

### 8. Edge cases

- **Guest / logged-out export**: `publishSegments` false → no write.
- **Logged-in but no `shareCode`**: `resolveFriendLessonLink` returns `null`.
- **Respond lesson / non-friend lesson**: no `answerLessonId` → `null`.
- **Export produced zero uploaded segments** (`succeeded === 0`): `null` → no entry.
- **Misconfigured `answerLessonId` pointing at a missing lesson**: `null` (defensive check), no link.
- **Re-export of the same ask lesson**: `upsertFriendLinkMap` replaces that key's `addedAt` → the window restarts; other entries in the map are preserved.
- **Two ask lessons in one course** (`model.json` `w` + `wf`): distinct keys (`model:w`, `model:wf`), both links render.
- **Exactly 48h old**: `remainingMs === 0` → inactive → hidden (removal boundary is inclusive at 48h).
- **Sub-minute remaining**: countdown shows `0m` but the link is still active until `remainingMs === 0`.
- **`friendLinks` missing / `{}` / non-object / array**: `listActiveFriendLinks` returns `[]` → section renders nothing.
- **Malformed entry without `addedAt`**: filtered out.

## Tasks

### Task 1 - Add `answerLessonId` to the ask lessons

- `src/config/friend.json` parsed + lesson `a` inspected
  - → `answerLessonId === 'b'`
- `src/config/model.json` parsed + lesson `w` inspected
  - → `answerLessonId === 'wa'`
- `src/config/model.json` parsed + lesson `wf` inspected
  - → `answerLessonId === 'wfa'`
- `src/config/t.json` parsed + lesson `y` inspected
  - → `answerLessonId` is `undefined` (no respond lesson exists; documented decision)
- Every config file in `src/config/` parsed + every lesson inspected
  - → each lesson that has `answerLessonId` names a lesson that exists in the same file
  - → no lesson outside `friend.a`, `model.w`, `model.wf` has `answerLessonId`

### Task 2 - Pure link/expiry/merge logic (`src/modules/user/friend-lesson-link-logic.test.js`, new)

- `buildFriendLessonLink({ courseId: 'friend', answerLessonId: 'b', shareCode: 'ab12' })`
  - → `'example.com/course/friend/lesson/b?shareCode=ab12'`
- `buildFriendLessonLink` called with an explicit `base`
  - → the returned string uses that base and still contains `/course/<courseId>/lesson/<answerLessonId>?shareCode=<shareCode>`
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
- `friendLinkKey('model', 'w')` / `friendLinkKey('model', 'wf')` / `friendLinkKey('friend', 'a')`
  - → `'model:w'` / `'model:wf'` / `'friend:a'` (distinct)
- `upsertFriendLinkMap(null, entryA)` and `upsertFriendLinkMap({}, entryA)`
  - → `{ 'friend:a': entryA }` for each (non-object/absent input treated as empty)
- `upsertFriendLinkMap({ 'model:w': entryW }, entryWf)` where `entryWf.courseId === 'model'` and `entryWf.askLessonId === 'wf'`
  - → both `'model:w'` and `'model:wf'` keys present (no clobber)
- `upsertFriendLinkMap({ 'model:w': oldEntryW }, newEntryW)` with the same key
  - → the key maps to `newEntryW` (addedAt replaced)
- `upsertFriendLinkMap({ 'x:y': entry }, entry)` called twice
  - → the first input object is not mutated
- `listActiveFriendLinks(map, now)` where the map has one entry added 1h ago and one added 48h ago
  - → only the 1h-ago entry, and only one element
- `listActiveFriendLinks(null, now)`, `({}, now)`, `('x', now)`, `([entry], now)`
  - → `[]` for each
- `listActiveFriendLinks` with entries whose `addedAt` is missing/invalid
  - → those entries are excluded
- `resolveFriendLessonLink` with a valid config (lesson `a` has `answerLessonId: 'b'`, `b` exists), `lessonId: 'a'`, `succeeded: 3`, `shareCode: 'ab12'`
  - → `{ courseId, askLessonId: 'a', answerLessonId: 'b', shareCode: 'ab12' }`
- `resolveFriendLessonLink` with `succeeded: 0`, with `shareCode: ''`, with an unknown `lessonId`, with a lesson that has no `answerLessonId`, and with an `answerLessonId` that names a missing lesson
  - → `null` for each
- `resolveFriendLessonLink` called with `configData: null` / `undefined`
  - → `null` for each

### Task 3 - UI strings (`src/data/strings.test.js` updated)

- `Strings.get('profile_friend_lesson_link', lang)` for `lang` in `en/es/pt/fr/hi/bn`
  - → the exact copy from the §3 table
- `Strings.get('profile_friend_link_available', lang, { time: '47h 0m' })` for `lang` in `en/es/pt/fr/hi/bn`
  - → the localized label with `{time}` replaced and no `{`/`}` remaining
- `get('profile_friend_lesson_link', 'hi')` / `('bn')`
  - → matches Devanagari / Bengali script (existing hi/bn coverage test still passes)
- `src/data/strings.test.js` placeholder map includes `time`
  - → the auto-derived placeholder test passes for `profile_friend_link_available` in hi and bn

### Task 4 - Migration (`supabase/migrations/004_add_friend_links_to_profiles.sql`, new; static guard test `src/modules/api/friend-links-migration.test.js`)

- `004_add_friend_links_to_profiles.sql` read as text
  - → contains `alter table public.user_profiles` and `add column if not exists friend_links jsonb`
  - → contains `grant select (friend_links) on table public.user_profiles to anon`
  - → the `create or replace view public.public_profiles` body contains `friend_links`
  - → contains `grant select on public.public_profiles to anon, authenticated`
  - → contains no `create table` (no new table)
  - → contains no `create policy` (no new RLS policy)

### Task 5 - Record the link on export + public read plumbing (config-gated; logic covered by Task 2)

- `exportSegmentsToR2` source inspected (`src/modules/video/video-processor.web.js`)
  - → each early return yields `{ count: 0, succeeded: 0 }`
  - → the final return yields `{ count: publishable.length, succeeded }`
- `src/components/widgets/SuccessButtons.jsx` source inspected
  - → imports and calls `useAddFriendLinkMutation` and `resolveFriendLessonLink`
  - → awaits `exportSegmentsToR2` and passes `exportResult?.succeeded` into `resolveFriendLessonLink`
  - → calls the mutation with `{ userId, shareCode, entry: { ...payload, addedAt } }` only when `resolveFriendLessonLink` returns non-null
  - → the write failure path is caught and logged (does not alert / abort the success screen)
- `src/modules/api/api.js` source inspected
  - → `fromDbRow` exposes `friendLinks: row.friend_links`
  - → `useUserByShareCode`'s `SAFE_COLS` fallback includes `friend_links`
  - → `useAddFriendLinkMutation` imports and uses `upsertFriendLinkMap`
- `src/modules/video/video-processor.native.jsx` source inspected
  - → the native `exportSegmentsToR2` stub returns `{ count: 0, succeeded: 0 }` (contract kept)

### Task 6 - Public-profile link + countdown UI (`tests/friend-lesson-link.spec.js`, new Playwright)

- `/friendtest1` loaded, then `queryClient.setQueryData(['user','profile','shareCode','friendtest1'], <profile with friendLinks entry added 1h ago>)` injected
  - → an element `[data-testid="friend-lesson-link"]` is visible
  - → its text is `Practice English with Me`
  - → its computed `font-size` is at least `24px`
  - → its `href` is `https://example.com/course/friend/lesson/b?shareCode=friendtest1`
  - → `[data-testid="friend-lesson-link-countdown"]` is visible and reads `Available for 47h 0m`
- `/friendtest1` loaded + a `friendLinks` entry whose `addedAt` is exactly 48h before the fixed clock injected
  - → `[data-testid="friend-lesson-link"]` has count `0` (link removed)
- `/friendtest1` loaded + `friendLinks: {}` injected
  - → `[data-testid="friend-lesson-links"]` has count `0` (no empty section)
- `/friendtest1` loaded with no injected data (unresolved share code)
  - → `[data-testid="friend-lesson-link"]` has count `0`
- `/friendtest1` loaded + two active entries (`model:w` and `model:wf`) injected
  - → `[data-testid="friend-lesson-link"]` has count `2`

## Technical Context

- **No new dependencies.** Reuses React 19.2.0, `@tanstack/react-query` 5.100.14, `zustand` 5.0.13, `@supabase/supabase-js` 2.112.4, `react-router-dom` 7.15.1. Unit tests: vitest 4.1.6 + jsdom 29.1.1 (colocated `*.test.js`; `vitest.config.js` excludes `tests/**` and `*.spec.js`). Browser tests: `@playwright/test` 1.60.0 (`tests/*.spec.js`, `playwright.config.js`, `webServer: npx vite --port 5173`).
- **`SHARE_URL_BASE` is scheme-less** (`'example.com'`, `video-processor-logic.js:15`) by design — the recap CTA shows a bare host/path to be typed manually. For a clickable public-profile anchor the component prepends `https://` via `toFriendLessonHref`; the canonical link value returned by `buildFriendLessonLink` matches the brief exactly (`example.com/course/...`). If the base later becomes a real domain, only `SHARE_URL_BASE` changes.
- **`courseId` source of truth:** use `appStore.getState().courseId` (route param / config filename: `friend`, `model`) — **not** `configData.courseId` (`friend.json`'s is `"20260921"`). `AppLayout.jsx:31` sets the store course id from `useParams`, and `exportSegmentsToR2` already uses it for the R2 key (`video-processor.web.js:1333`).
- **Public read path:** `useUserByShareCode` (`api.js:289-317`) queries the `public_profiles` view with `select('*')` when unauthenticated and falls back to `user_profiles` with `SAFE_COLS` on pre-migration deploys. Adding `friend_links` to the view + anon grant + `SAFE_COLS` keeps both branches working. `fromDbRow` (`api.js:52`) provides the `friendLinks` camelCase alias.
- **Answer-lesson route works with the query param:** `/course/:courseId/lesson/:lessonId` (`src/routes/routes.jsx:34`) and `App.jsx:19-37` reads the friend code case-insensitively (`sharecode`), so `?shareCode=` is captured.
- **Playwright determinism:** use `page.clock.setFixedTime(<ISO>)` before `page.goto('/<shareCode>')` (Playwright 1.60 supports `page.clock`), and stub Supabase REST (`page.route('**/rest/v1/**', ...)`) so the not-found state settles immediately. Then inject the fixture through the app's own singleton: `const { queryClient } = await import('/src/modules/api/api.js')` inside `page.evaluate` (same pattern as `tests/answer-flow.spec.js` importing `/src/modules/answer/answer-pipeline.js`). `main.jsx:15` passes that exact `queryClient` to `QueryClientProvider`, so `setQueryData(['user','profile','shareCode', code], profile)` drives the real `useUserByShareCode` hook. Its default `staleTime: Infinity` means injected data is not refetched.
- **Config tests:** `src/config/friend.test.js` walks translation objects (locale keys) and is unaffected by a new scalar field; `src/config/model.test.js` asserts step sequences only. The new field belongs in a dedicated config test (Task 1). `src/modules/video/model-config.test.js` iterates all configs for recap flags and is unaffected.
- **`strings.test.js` coupling:** its placeholder test auto-derives keys from `en` and interpolates a fixed object; the new `{time}` key requires adding `time` to that object.

## Notes

- **Assumption (stated, not guessed silently):** the anchor `href` prepends `https://` because `SHARE_URL_BASE` is intentionally scheme-less; the link **text** is the localized "Practice English with Me" (the URL is never displayed). If the desired `href` must be the bare `example.com/...` string, only `toFriendLessonHref` and its two unit assertions change.
- **Assumption:** the `friend_links` map is keyed `${courseId}:${askLessonId}` rather than by course, because `model.json` has two ask lessons (`w`, `wf`) in one course; a course-only key would clobber one. If a single object is preferred instead, only `friendLinkKey`/`upsertFriendLinkMap` and their assertions change.
- **Assumption:** the countdown label is a localized string with a `{time}` placeholder rendered as `47h 0m` (minute granularity), and `lang` is the profile owner's `native_language`, matching how `PublicProfile.jsx` already localizes all its copy. If a different granularity or the viewer's language is wanted, only `formatFriendLinkRemaining` / the section's `lang` prop change.
- **Manual verification** (Supabase RLS + real export cannot be exercised headlessly; the logic is covered by Tasks 1-5):
  1. Apply `004_add_friend_links_to_profiles.sql` to the Supabase project (or local stack).
  2. `npm run dev`, log in, open `/course/model/lesson/w` (or `wf`), complete it, click the process/generate button; confirm `user_profiles.friend_links` gains `"model:w"` with `answerLessonId: "wa"` and a fresh `addedAt`.
  3. Open the owner's public profile `/<shareCode>` (logged out, to exercise the anon view): the large "Practice English with Me" link and countdown appear; clicking it lands on `/course/model/lesson/wa?shareCode=<code>`.
  4. Re-export the same lesson: the `model:w` entry's `addedAt` resets, `model:wf` (if present) is untouched.
  5. Repeat as a guest: no write, no link.
- **Working-tree caveat:** this story touches `src/config/friend.json` (adds `answerLessonId` to `a`) and `src/config/model.json` (adds it to `w`/`wf`). Review the config diff with `git diff` before staging so unrelated edits are not swept in.
- **Console discipline (`agents.md`):** the new success path logs on failure (`console.error`) and success (`console.log` in the mutation, `trackEvent('friend_lesson_link_created')`). Do not remove existing logs.
