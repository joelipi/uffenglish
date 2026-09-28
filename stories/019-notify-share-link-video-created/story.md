# Friend-response notifications — tell the asker when a friend creates a video from their share link

## Context

The friend-challenge loop has two halves. An asker (user A) completes lesson `a` in `src/config/friend.json` (also `newtest.json`, `test.json`), which publishes their question clips to R2 and records a friend link on their public profile (story 012). A friend (user B) opens `A`'s share URL, answers in lesson `b` (the answer lesson, `recapSources: "friend"`, so the exported recap concatenates `A`'s clips with `B`'s answers), and — once logged in — `exportSegmentsToR2('b')` publishes `B`'s own clips under `videos/{B.shareCode}-{courseId}-b-response-NN.mp4` (`src/modules/video/video-processor.web.js:1252-1381`).

Today `A` has no signal that anyone answered: nothing is written anywhere when `B` creates that video, and there is no notification surface in the app (the only "notification" in the repo is unrelated video-overlay CSS). This story adds an in-app notification to `A`, linking to `B`'s public profile (`/<B.shareCode>`, `src/components/profile/PublicProfile.jsx`). Each notification shows a **timestamp** (when it arrived) plus a **static** reminder line, "You only have 48 hours to respond" — so a user returning after 48 hours can see the elapsed time themselves from the timestamp; the app does not compute or conditionally hide the 48h text.

Delivery is **in-app only**. The repo has no email/SMTP/push provider and no runtime dependency will be added: the notification inbox lives in Supabase (already the app's backend) and is created server-side by a `SECURITY DEFINER` RPC so a client can never forge the actor or recipient. The schema is deliberately provider-ready — a single `user_notifications` table with `type` + `payload` is the one write point, so a future third-party channel (email/push) can subscribe to `INSERT` via a Supabase Database Webhook / Edge Function without touching the feature (documented under Technical Context; not implemented here).

**Architectural constraint (applies to all files in this story):** strict logic/presentation separation so the feature can be reused by a React Native monorepo. Domain rules, gates, URL building, and date formatting live in a pure `*-logic.js` module with no React, no DOM, and no React Native imports. Rendering lives in platform-tagged `.web.jsx` components that the bundlers swap for `.native.jsx` counterparts (`vite.config.js` `resolve.extensions` prefers `.web.jsx`; Metro prefers `.native.jsx`). The web list component is split out from the data container so a native list only has to re-implement rendering, not the rules. No native files are added in this story (the repo treats them as future reference, not speculative code — `docs/learnings.md:27-31`).

## Out of Scope

- **Email, push, SMS, and any third-party provider integration.** No new dependency and no provider SDK. The extensibility seam is the `user_notifications` table + its `type`/`payload` contract (see Implementation approach §8), not a client-side dispatcher.
- **Anonymous/guest `B`.** `exportSegmentsToR2` is login-gated and requires a `shareCode`, so a guest never publishes; with no `shareCode` there is no profile to link to, hence no notification. This is inherent, not an extra guard.
- **Notifications for lessons other than the answer lesson `b`.** Exporting ask lesson `a` continues to only record the friend link (story 012) and does not notify anyone.
- **A notifications page/route, deletion, dismiss UI, or notification preferences.** The bell panel is the only surface; "read" is the only state.
- **Real-time delivery (Supabase Realtime/websockets).** The inbox is fetched on mount by TanStack Query; no subscription is added.
- **Changing `SHARE_URL_BASE`, `SHARE_WINDOW_HOURS`, `friend_links`, `exportSegmentsToR2`'s return contract, or the R2 lifecycle.** The profile link reuses the canonical `buildShareUrl`.
- **The owner's `/profile` page (`UserProfile.jsx`)** and the public profile's data fetch (`useUserByShareCode`). The notification link points at the existing public profile route; that page is not changed.
- **The native stub** (`video-processor.native.jsx`) beyond leaving its existing `exportSegmentsToR2` contract untouched.

## Implementation approach

### 1. Why a new table + RPC, not another `jsonb` column

Story 012 could store `friend_links` on `A`'s own row because `A` writes it about themselves. Here `B` must write a record **for `A`**, which the existing RLS (`owner update`: `auth.uid() = id`) forbids. Rather than loosen RLS on `user_profiles`, introduce one purpose-built table and a `SECURITY DEFINER` RPC that derives **both** identities server-side:

- actor = `auth.uid()` (the caller's JWT — unforgeable);
- recipient = resolved from the share code the caller passes;
- actor display name = read from the actor's own `user_profiles` row (not client-supplied).

The client therefore sends only `(recipientShareCode, courseId, lessonId)`. This is the industry-standard boundary for cross-user writes: the client cannot choose the actor, the recipient id, or the rendered actor name.

### 2. Migration — `supabase/migrations/005_add_user_notifications.sql` (new)

Follows `003`/`004` conventions. One new table, RLS enabled, recipient-only read + read-at update; **no insert policy/grant** (writes go only through the definer RPC).

```sql
-- 005_add_user_notifications.sql
-- In-app notification inbox. Created server-side by record_friend_response();
-- the recipient reads and marks-read their own rows via RLS. No insert grant,
-- so a client cannot forge a notification.

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  course_id text not null default '',
  lesson_id text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint user_notifications_no_self check (recipient_id <> actor_id)
);

-- One notification per (recipient, actor, type); a re-answer refreshes the
-- existing row instead of stacking duplicates. Deliberately NOT keyed on
-- course_id/lesson_id: those are caller-supplied, so including them would let
-- any authenticated caller flood a victim's inbox with one row per made-up
-- course. The unique key contains no attacker-controlled text.
create unique index if not exists uq_user_notifications_dedupe
  on public.user_notifications (recipient_id, actor_id, type);

-- Inbox query: recipient's rows, newest first.
create index if not exists idx_user_notifications_recipient_created
  on public.user_notifications (recipient_id, created_at desc);

alter table public.user_notifications enable row level security;

drop policy if exists "recipient read" on public.user_notifications;
create policy "recipient read"
  on public.user_notifications for select
  to authenticated
  using (auth.uid() = recipient_id);

drop policy if exists "recipient update" on public.user_notifications;
create policy "recipient update"
  on public.user_notifications for update
  to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

grant select on table public.user_notifications to authenticated;
-- Least privilege: the recipient may only clear read_at, never edit the payload.
grant update (read_at) on table public.user_notifications to authenticated;

-- SECURITY DEFINER: derives actor from auth.uid(), recipient from the share
-- code, and the actor display name from the actor's own profile.
create or replace function public.record_friend_response(
  p_recipient_share_code text,
  p_course_id text,
  p_lesson_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_recipient uuid;
  v_actor_code text;
  v_actor_name text;
begin
  if v_actor is null then
    raise exception 'record_friend_response: not authenticated' using errcode = '28000';
  end if;
  if p_recipient_share_code is null or btrim(p_recipient_share_code) = '' then
    return;
  end if;

  select p.id into v_recipient
  from public.user_profiles p
  where lower(p.share_code) = lower(btrim(p_recipient_share_code))
  limit 1;

  -- Unknown recipient or self-notification: no-op, never an error to the caller.
  if v_recipient is null or v_recipient = v_actor then
    return;
  end if;

  select p.share_code,
         nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
    into v_actor_code, v_actor_name
  from public.user_profiles p
  where p.id = v_actor;

  insert into public.user_notifications
    (recipient_id, actor_id, type, course_id, lesson_id, payload)
  values
    (v_recipient, v_actor, 'friend_response',
     coalesce(p_course_id, ''), coalesce(p_lesson_id, ''),
     jsonb_build_object(
       'actorShareCode', coalesce(v_actor_code, ''),
       'actorName', coalesce(v_actor_name, '')
     ))
  on conflict (recipient_id, actor_id, type)
  do update set
    created_at = now(),
    read_at = null,
    course_id = excluded.course_id,
    lesson_id = excluded.lesson_id,
    payload = excluded.payload;
end;
$$;

revoke all on function public.record_friend_response(text, text, text) from public, anon;
grant execute on function public.record_friend_response(text, text, text) to authenticated;
```

`payload` shape (what the UI reads):

```json
{ "actorShareCode": "sam123", "actorName": "Sam Lee" }
```

### 3. Pure logic — `src/modules/notifications/notification-logic.js` (new)

No DOM, no data access; single-sources lesson id and share host from existing modules.

```js
// modules/notifications/notification-logic.js
// Pure domain logic for friend-response notifications. No DOM, no data access.

import { ANSWER_LESSON_ID } from '../user/friend-lesson-link-logic.js';
import { buildShareUrl } from '../video/video-processor-logic.js';
import { LOCALE_MAP } from '../../data/languages.js';

export const NOTIFICATION_TYPE_FRIEND_RESPONSE = 'friend_response';

// Localized, human-readable timestamp for the notification row. Pure and
// platform-agnostic (works in browser and Hermes). Invalid/missing dates → ''.
// `lang` may be any case/locale ('EN', 'en-US'); LOCALE_MAP is keyed by the
// uppercase base code, so normalize for the lookup and fall back to English.
export function formatNotificationDate(createdAt, lang = 'en') {
    const t = new Date(createdAt).getTime();
    if (!Number.isFinite(t)) return '';
    const base = String(lang || 'en').split('-')[0].toUpperCase();
    const locale = LOCALE_MAP[base] || 'en';
    return new Date(t).toLocaleString(locale, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
    });
}

// Trim + lowercase; '' and non-strings become null.
export function normalizeShareCode(code) {
    return (typeof code === 'string' ? code.trim().toLowerCase() : '') || null;
}

// Public profile URL for a share code: https://<host>/<code>.
// buildShareUrl is the canonical '<host>/<code>' builder; add the scheme for a
// clickable anchor (SHARE_URL_BASE is deliberately scheme-less).
export function buildProfileHref(shareCode) {
    const url = buildShareUrl(normalizeShareCode(shareCode));
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function getUnreadCount(notifications) {
    if (!Array.isArray(notifications)) return 0;
    return notifications.reduce((count, n) => count + (n && !n.read_at ? 1 : 0), 0);
}

// Newest first; non-array / junk entries are ignored.
export function listNotifications(notifications) {
    if (!Array.isArray(notifications)) return [];
    return notifications
        .filter((n) => n && typeof n === 'object' && n.id)
        .slice()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function getNotificationActorName(notification) {
    const name = notification?.payload?.actorName;
    return typeof name === 'string' ? name.trim() : '';
}

export function getNotificationActorShareCode(notification) {
    return normalizeShareCode(notification?.payload?.actorShareCode);
}

/**
 * Gate + RPC payload for recording a friend-response notification. Pure.
 * Fires only when a real publish happened for the ANSWER lesson, in a course
 * that actually contains that lesson, with a recipient code that is not the
 * actor's own. Returns null otherwise.
 */
export function resolveFriendResponseNotification({
    configData, lessonId, courseId, recipientShareCode, actorShareCode, succeeded,
} = {}) {
    if (!succeeded || !courseId) return null;
    if (lessonId !== ANSWER_LESSON_ID) return null;
    if (!configData?.lessons?.some((l) => l?.lessonId === ANSWER_LESSON_ID)) return null;
    const recipient = normalizeShareCode(recipientShareCode);
    const actor = normalizeShareCode(actorShareCode);
    if (!recipient || !actor || recipient === actor) return null;
    return { recipientShareCode: recipient, courseId, lessonId };
}
```

### 4. Data access — `src/modules/api/api.js` (append)

All fetching/mutation goes through TanStack Query per `agents.md`.

```js
// ── Notifications ──────────────────────────────────────────────────
// Inbox is created server-side by the record_friend_response RPC; the recipient
// reads and marks-read their own rows through RLS-scoped queries.
export function useNotifications(userId) {
  return useQuery({
    queryKey: ['notifications', userId],
    enabled: !!userId && userId !== 'guest',
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_notifications')
        .select('id,type,course_id,lesson_id,payload,created_at,read_at')
        .eq('recipient_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      console.log('[notifications] fetched', data?.length ?? 0);
      return data || [];
    },
  });
}

export function useMarkNotificationsRead() {
  const queryClientHook = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, ids }) => {
      let query = supabase
        .from('user_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('recipient_id', userId);
      query = ids && ids.length ? query.in('id', ids) : query.is('read_at', null);
      const { error } = await query;
      if (error) throw error;
      console.log('[notifications] marked read', ids?.length ?? 'all');
    },
    onSuccess: (_data, variables) => {
      queryClientHook.invalidateQueries({ queryKey: ['notifications', variables.userId] });
    },
    onError: (error) => console.error('🚨 useMarkNotificationsRead error:', error),
  });
}

export function useRecordFriendResponseMutation() {
  return useMutation({
    mutationFn: async ({ recipientShareCode, courseId, lessonId }) => {
      const { error } = await supabase.rpc('record_friend_response', {
        p_recipient_share_code: recipientShareCode,
        p_course_id: courseId,
        p_lesson_id: lessonId,
      });
      if (error) throw error;
      console.log('[notifications] friend response recorded for', recipientShareCode);
    },
    onError: (error) => console.error('🚨 useRecordFriendResponseMutation error:', error),
  });
}
```

### 5. Record the notification on publish — `src/components/widgets/SuccessButtons.jsx`

Reuse the existing publish block (`SuccessButtons.jsx:93-116`); it is already login-gated (`publishSegments`) and already awaits the export. The actor is the current user; the recipient is the share code captured from the URL into `appStore.friendCode` by `App.jsx:19-37`.

- `import { useAddFriendLinkMutation, useRecordFriendResponseMutation } from '../../modules/api/api.js';`
- `import { resolveFriendResponseNotification } from '../../modules/notifications/notification-logic.js';`
- `const friendResponseMutation = useRecordFriendResponseMutation();` at the top; add it to `runProcessing`'s `useCallback` deps.
- Inside the existing `try`, after the friend-link block:

```js
const responsePayload = resolveFriendResponseNotification({
  configData,
  lessonId,
  courseId,
  recipientShareCode: appStore.getState().friendCode,
  actorShareCode: userData?.shareCode,
  succeeded: exportResult?.succeeded,
});
if (responsePayload) {
  await friendResponseMutation.mutateAsync(responsePayload);
  trackEvent('friend_response_notified', { courseId, lessonId });
}
```

The whole block stays inside the existing `try/catch`, so a notification failure is logged as non-fatal and never fails video generation. Guests never reach it (`publishSegments` is false), and a logged-in user without a `shareCode` gets `{ count: 0, succeeded: 0 }` from the export.

### 6. UI copy — `src/data/strings.js` (5 new keys, six languages)

| key | en | es | pt | fr | hi | bn |
|---|---|---|---|---|---|---|
| `notifications_title` | `Notifications` | `Notificaciones` | `Notificações` | `Notifications` | `सूचनाएँ` | `বিজ্ঞপ্তি` |
| `notifications_empty` | `No notifications yet` | `Aún no hay notificaciones` | `Ainda não há notificações` | `Aucune notification pour l'instant` | `अभी कोई सूचना नहीं` | `এখনও কোনো বিজ্ঞপ্তি নেই` |
| `notifications_friend_response` | `{name} created a video with your questions` | `{name} creó un video con tus preguntas` | `{name} criou um vídeo com as suas perguntas` | `{name} a créé une vidéo avec vos questions` | `{name} ने आपके सवालों के साथ एक वीडियो बनाया` | `{name} আপনার প্রশ্নগুলো নিয়ে একটি ভিডিও তৈরি করেছে` |
| `notifications_respond_deadline` | `You only have 48 hours to respond` | `Solo tienes 48 horas para responder` | `Você só tem 48 horas para responder` | `Vous n'avez que 48 heures pour répondre` | `आपके पास जवाब देने के लिए केवल 48 घंटे हैं` | `আপনার কাছে উত্তর দেওয়ার জন্য মাত্র 48 ঘণ্টা আছে` |
| `notifications_someone` | `A friend` | `Un amigo` | `Um amigo` | `Un ami` | `एक मित्र` | `একজন বন্ধু` |

`notifications_friend_response` carries `{name}`; `src/data/strings.test.js`'s placeholder map (line 64) must add `name: 'Sam'` so the auto-derived hi/bn interpolation test passes. The existing "every key carries hi/bn" test then covers all five new keys automatically. `notifications_respond_deadline` carries no placeholder and is rendered statically (never hidden based on elapsed time).

### 7. Bell UI — `NotificationList.web.jsx` + `NotificationsBell.web.jsx` (both new) + `HomeScreen.jsx`

Platform-tagged presentation, split from the container and from all rules:

- **Rules** stay in `notification-logic.js` (pure, no React/DOM/RN).
- **`src/components/homescreen/NotificationList.web.jsx`** is the web render only (default export; imports React, `Strings`, and `notification-logic.js`). It contains no business rules beyond calling the pure helpers.
- **`src/components/homescreen/NotificationsBell.web.jsx`** is the web container (imports React/`useState`, `NotificationList.web.jsx`, and `api.js`). It wires data to the view only.
- A future RN port adds `NotificationList.native.jsx` and `NotificationsBell.native.jsx` implementing the same props and `data-testid`s; Vite resolves the `.web.jsx` files on web, Metro resolves `.native.jsx` on native. No native files are created in this story.

`NotificationList.web.jsx`:

- `NotificationList({ notifications, lang, onSelect })`: `listNotifications(...)`; empty → `<p data-testid="notification-empty">` + no items; otherwise a list of items (no clocks, no window math).
- Each item (`<div data-testid="notification-item">`), in order:
  1. Message `Strings.get('notifications_friend_response', lang, { name: getNotificationActorName(n) || Strings.get('notifications_someone', lang) })`. When `getNotificationActorShareCode(n)` is truthy, wrap in `<a data-testid="notification-link" href={buildProfileHref(code)}>` and call `onSelect(n)` on click; when it is empty, render the message in a `<span>` with no anchor.
  2. Static reminder `<p data-testid="notification-deadline">{Strings.get('notifications_respond_deadline', lang)}</p>`, rendered for `n.type === NOTIFICATION_TYPE_FRIEND_RESPONSE` — always, regardless of how old the notification is.
  3. Timestamp `<time data-testid="notification-timestamp">{formatNotificationDate(n.created_at, lang)}</time>`, rendered only when the formatter returns a non-empty string (invalid/missing `created_at` → no timestamp element).

`NotificationsBell.web.jsx`:

- `NotificationsBell({ userId, lang })`: owns `open` state and calls `useNotifications(userId)` + `useMarkNotificationsRead()`. Renders a button `data-testid="notification-bell"` with `<i className="bi bi-bell-fill" />` and, when `getUnreadCount(notifications) > 0`, a badge `data-testid="notification-badge"` showing the count. Opening the panel renders `data-testid="notification-panel"` with a heading `Strings.get('notifications_title', lang)` and `NotificationList`; on open with unread rows it fires `markRead.mutate({ userId, ids: <unread ids> })`. Reuses the HomeScreen dark palette (`#0b1a2a`/`#1a3a5a`/`#2a4a6a`). No ticker/clock.

`HomeScreen.jsx`:

- `import NotificationsBell from './NotificationsBell.web.jsx';` (explicit `.web.jsx`, matching `RootLayout.jsx`'s `GuestLoginModal.web.jsx` import) and add `useUserProfile` to the existing `../../modules/api/api.js` import.
- `const { data: profile } = useUserProfile();` → `const viewerId = profile?.$id;`
- Replace the right-side `<div style={{ width: '44px' }} />` (top bar, line 126) with the bell for registered users, keeping the spacer otherwise:

```jsx
{isLoggedIn && viewerId && viewerId !== 'guest'
  ? <NotificationsBell userId={viewerId} lang={lang} />
  : <div style={{ width: '44px' }} />}
```

### 8. Provider-agnostic seam (future third-party channel)

`user_notifications` is the single write point, and `record_friend_response` is the single creator. A future email/push provider is wired server-side as a Supabase Database Webhook (or an `AFTER INSERT` trigger) on `user_notifications` that routes by `type` and renders `payload` — no client or feature change. The `type` column is the channel-routing key and `payload` is the provider-agnostic content snapshot. This is documented, not implemented in this story.

### 9. Edge cases

- **Exported lesson is `a` (ask) or anything other than `b`**: `resolveFriendResponseNotification` returns `null` (ask export still records the story-012 friend link).
- **Course whose config has no lesson `b`** (`model.json`, `gt2.json`, `t.json`, `test-api.json`): guard returns `null`.
- **Guest `B`**: `publishSegments` false → export never runs → no call.
- **Logged-in `B` with no `shareCode`**: export returns `{ succeeded: 0 }` → `null`.
- **`friendCode` missing** (`B` opened lesson `b` without a share link): `recipientShareCode` empty → `null`.
- **`B` reshares their own code** (`recipientShareCode === actorShareCode`): `null` (client) and a no-op in the RPC (server self-check).
- **Recipient share code unknown to the DB**: RPC no-ops; no error surfaced.
- **Same `B` answers the same asker again (any course/lesson)**: the unique key `(recipient_id, actor_id, type)` + `do update` refreshes `created_at`, clears `read_at`, and updates the name/context snapshot — one row per friend, no duplicates and no flood.
- **Attacker supplies an arbitrary `course_id`/`lesson_id`**: those columns are stored as untrusted context only and are **not** part of the unique key, so repeated calls with made-up courses all collapse onto the same single row instead of creating unlimited unread notifications.
- **`payload.actorName` empty**: UI falls back to `notifications_someone`.
- **`payload.actorShareCode` empty/malformed**: item renders as non-link text, no anchor.
- **Any notification age** (minutes or weeks old): the deadline line is always rendered — it is static text, not a countdown; the timestamp lets the user judge elapsed time themselves.
- **`created_at` missing/invalid**: `formatNotificationDate` returns `''` → no timestamp element (the item, message, and deadline line still render).
- **Unknown/untranslated `lang`**: `formatNotificationDate` falls back to the English locale rather than throwing.
- **Inbox fetch failure / non-array data**: `getUnreadCount` → `0`, `listNotifications` → `[]` (badge hidden, empty state).
- **Unread count 0**: no badge.
- **A publish or RPC failure**: caught in the existing success block; logged, non-fatal.

## Tasks

### Task 1 - Pure notification logic (`src/modules/notifications/notification-logic.test.js`, new)

- `normalizeShareCode(' Ab12 ')` / `('AB12')`
  - → `'ab12'` for each
- `normalizeShareCode('')` / `('   ')` / `(null)` / `(undefined)` / `(42)`
  - → `null` for each
- `buildProfileHref('sam123')`
  - → `'https://ultrafastfluency.com/sam123'`
- `buildProfileHref('')` / `(null)`
  - → `'https://ultrafastfluency.com'` for each (falls back to the bare host, never throws)
- `buildProfileHref('https://x/y')`
  - → returned unchanged (no double scheme)
- `getUnreadCount([{read_at:null},{read_at:'2026-01-01T00:00:00Z'},{read_at:null}])`
  - → `2`
- `getUnreadCount([])` / `(null)` / `(undefined)` / `('x')`
  - → `0` for each
- `listNotifications` with a row created later and one created earlier
  - → newer row first
- `listNotifications(null)` / `(undefined)` / `('x')` / `([null, 0, {}])`
  - → `[]` for each
- `listNotifications` called with an input array
  - → the input array order is not mutated
- `getNotificationActorName({ payload: { actorName: ' Sam ' } })`
  - → `'Sam'`
- `getNotificationActorName({ payload: {} })` / `({})` / `(null)` / `({ payload: { actorName: 42 } })`
  - → `''` for each
- `getNotificationActorShareCode({ payload: { actorShareCode: 'SAM123' } })`
  - → `'sam123'`
- `getNotificationActorShareCode({ payload: {} })` / `({})` / `(null)`
  - → `null` for each
- `resolveFriendResponseNotification({ lessonId:'b', courseId:'friend', recipientShareCode:'A1', actorShareCode:'B2', configData:{ lessons:[{lessonId:'b'}] }, succeeded:3 })`
  - → `{ recipientShareCode:'a1', courseId:'friend', lessonId:'b' }`
- `resolveFriendResponseNotification` with `lessonId:'a'`, `'w'`, `''`
  - → `null` for each
- `resolveFriendResponseNotification` with `succeeded:0`
  - → `null`
- `resolveFriendResponseNotification` with `recipientShareCode:''` / missing
  - → `null`
- `resolveFriendResponseNotification` with `recipientShareCode:'B2'` and `actorShareCode:'b2'`
  - → `null` (case-insensitive self-check)
- `resolveFriendResponseNotification` with `courseId:''` / missing
  - → `null`
- `resolveFriendResponseNotification` with a config whose lessons lack `'b'`
  - → `null`
- `resolveFriendResponseNotification` with `configData:null` / `undefined`
  - → `null`
- `NOTIFICATION_TYPE_FRIEND_RESPONSE`
  - → `'friend_response'`
- `formatNotificationDate('2026-09-24T11:00:00.000Z', 'en')`
  - → a non-empty string containing `2026`
- `formatNotificationDate(iso, 'EN')` / `(iso, 'en')` / `(iso, 'en-US')`
  - → equal for each (case/locale normalization)
- `formatNotificationDate(iso, 'es')` / `(iso, 'fr')` / `(iso, 'hi')` / `(iso, 'bn')`
  - → non-empty for each (localized formatter does not throw)
- `formatNotificationDate(iso, 'XX')` (a code absent from `LOCALE_MAP`, which is derived from `PROFILE_LANGUAGES`)
  - → falls back cleanly to the English locale (non-empty, contains `2026`)
- `formatNotificationDate(null, 'en')` / `('', 'en')` / `('not-a-date', 'en')` / `(undefined, 'en')`
  - → `''` for each

### Task 2 - UI strings (`src/data/strings.test.js` updated)

- `Strings.get('<each new key>', lang)` for `lang` in `en/es/pt/fr/hi/bn`
  - → the exact copy from the §6 table
- `Strings.get('notifications_friend_response', lang, { name: 'Sam' })` for `lang` in `en/es/pt/fr/hi/bn`
  - → the localized label with `{name}` replaced and no `{`/`}` remaining
- `Strings.get('notifications_friend_response', 'hi')` / `('bn')`
  - → matches Devanagari / Bengali script
- `Strings.get('notifications_respond_deadline', lang)` for `lang` in `en/es/pt/fr/hi/bn`
  - → the exact copy from the §6 table, containing `48`
- `src/data/strings.test.js` placeholder map includes `name`
  - → the auto-derived placeholder test passes for `notifications_friend_response` in hi and bn
- the whole-table hi/bn coverage test
  - → passes with the four new keys included

### Task 3 - Migration + RPC (`supabase/migrations/005_add_user_notifications.sql`, new; static guard `src/modules/notifications/notifications-migration.test.js`, new)

- `005_add_user_notifications.sql` read as text
  - → contains `create table if not exists public.user_notifications`
  - → contains `recipient_id`, `actor_id`, `type`, `course_id`, `lesson_id`, `payload`, `created_at`, `read_at`
  - → contains `alter table public.user_notifications enable row level security`
  - → the `"recipient read"` policy contains `auth.uid() = recipient_id`
  - → the `"recipient update"` policy contains `with check (auth.uid() = recipient_id)`
  - → contains a unique index on `(recipient_id, actor_id, type)` (no `course_id`/`lesson_id`, which are caller-supplied)
  - → does not contain `(recipient_id, actor_id, type, course_id, lesson_id)`
  - → contains `create or replace function public.record_friend_response`
  - → contains `security definer`
  - → contains `set search_path = ''`
  - → contains `v_actor uuid := auth.uid()`
  - → contains `on conflict (recipient_id, actor_id, type)`
  - → contains `grant execute on function public.record_friend_response(text, text, text) to authenticated`
  - → contains `revoke all on function public.record_friend_response(text, text, text) from public, anon`
  - → contains `grant update (read_at) on table public.user_notifications to authenticated`
  - → contains no `grant insert` on `user_notifications` and no `for insert` policy (writes only through the RPC)
  - → contains no `create policy ... for insert`

### Task 4 - Data-access hooks + export trigger wiring (`src/modules/api/api.js`, `src/components/widgets/SuccessButtons.jsx`; static guard `src/modules/notifications/notification-wiring.test.js`, new)

- `api.js` source inspected
  - → defines `useNotifications` with query key `['notifications', userId]` and `enabled: !!userId && userId !== 'guest'`
  - → selects from `user_notifications` filtered by `recipient_id`
  - → defines `useMarkNotificationsRead` that updates `read_at` and invalidates `['notifications', userId]`
  - → defines `useRecordFriendResponseMutation` that calls `supabase.rpc('record_friend_response'` with `p_recipient_share_code`, `p_course_id`, `p_lesson_id`
- `SuccessButtons.jsx` source inspected
  - → imports and calls `resolveFriendResponseNotification({`
  - → imports and calls `useRecordFriendResponseMutation(` / `friendResponseMutation.mutateAsync(`
  - → passes `succeeded: exportResult?.succeeded` and `recipientShareCode: appStore.getState().friendCode`
  - → the new call sits inside the existing non-fatal `try/catch` (the `'R2 publish / friend link failed (non-fatal)'` message is retained)
- `src/modules/video/video-processor.native.jsx` source inspected
  - → its `exportSegmentsToR2` stub still returns `{ count: 0, succeeded: 0 }` (contract untouched)

### Task 5 - Bell UI (`src/components/homescreen/NotificationList.web.jsx` and `src/components/homescreen/NotificationsBell.web.jsx` new; `src/components/homescreen/HomeScreen.jsx` modified; component test `src/components/homescreen/NotificationList.web.test.js`, new)

The test imports only `NotificationList.web.jsx` (presentational, no `api.js`/Supabase graph) and renders with `createRoot` + `act` (pattern from `src/components/intro-caller-name.test.js`); no network.

- `NotificationList` with two `friend_response` rows, newest first, rendered at `lang='en'`
  - → `[data-testid="notification-item"]` count is `2`
  - → the first item's text contains `Sam created a video with your questions`
  - → the first item's `[data-testid="notification-link"]` `href` is `https://ultrafastfluency.com/sam123`
  - → the first item shows `[data-testid="notification-deadline"]` with text `You only have 48 hours to respond`
  - → the first item shows a non-empty `[data-testid="notification-timestamp"]`
- both rows' deadline lines render regardless of age (one row `created_at` minutes ago, one 50h ago)
  - → `[data-testid="notification-deadline"]` count is `2`
- `NotificationList` rendered at `lang='es'`
  - → the rendered text contains the Spanish template for the message and the Spanish deadline line
- a row whose `created_at` is missing/invalid
  - → that item renders the message and `[data-testid="notification-deadline"]`, but `[data-testid="notification-timestamp"]` count is `0`
- the first item's `[data-testid="notification-link"]` clicked
  - → the `onSelect` spy is called once with that notification
- `NotificationList` with `[]` / `null`
  - → `[data-testid="notification-empty"]` is present and `[data-testid="notification-item"]` count is `0`
- `NotificationList` with a row whose `payload.actorName` is missing
  - → the rendered text contains the English fallback `A friend`
- `NotificationList` with a row whose `payload.actorShareCode` is missing
  - → that item renders but `[data-testid="notification-link"]` count is `0`
- `NotificationList.web.jsx` / `NotificationsBell.web.jsx` source inspected (pure separation)
  - → neither imports a data hook directly for rules; `NotificationList.web.jsx` imports no `api.js`/supabase/browser-only module
  - → all rule calls go through `notification-logic.js` (`listNotifications`, `buildProfileHref`, `formatNotificationDate`, `getNotificationActorName`, `getNotificationActorShareCode`)
- `notification-logic.js` source inspected
  - → contains no `react`/`jsx` import and no `window`/`document` reference
- `HomeScreen.jsx` source inspected
  - → imports `NotificationsBell` from `./NotificationsBell.web.jsx`
  - → renders `<NotificationsBell userId={viewerId} lang={lang} />` only when `viewerId !== 'guest'`
  - → keeps the `<div style={{ width: '44px' }} />` spacer in the non-registered branch

### Task 6 - Browser behavior (`tests/notifications.spec.js`, new Playwright)

Boot `/`, then inject fixtures into the app's own `queryClient` singleton (pattern from `tests/friend-lesson-link.spec.js`). No clock is needed: the deadline line is static and the timestamp is asserted only for presence. Stub all Supabase traffic in `beforeEach` so nothing escapes: `page.route('**/auth/v1/**', ...)` → `401`, and a **stateful** `page.route('**/rest/v1/**', ...)` (not a constant `[]`): GET `user_notifications` returns the current in-memory rows; PATCH `user_notifications` sets `read_at` on every row then returns `200`; `user_profiles`/other REST requests return `[]`. The statefulness matters — the mark-read invalidation triggers a refetch, and a constant `[]` stub would empty the panel mid-assertion (flaky).

Fixtures: `['notifications','u1'] = [<unread from 'Sam'/'sam123', created_at '2026-09-24T11:00:00Z'>, <read row, created_at '2026-09-22T00:00:00Z'>]`.

- `/` loaded, then `['auth','status'] = true`, `['user','profile'] = { $id:'u1', shareCode:'me123', native_language:'EN' }` and the fixture above injected
  - → `[data-testid="notification-bell"]` is visible
  - → `[data-testid="notification-badge"]` has text `1`
- the same fixture, then `[data-testid="notification-bell"]` clicked
  - → `[data-testid="notification-panel"]` is visible
  - → `[data-testid="notification-item"]` count is `2`
  - → the Sam item's `[data-testid="notification-link"]` has `href` `https://ultrafastfluency.com/sam123`
  - → `[data-testid="notification-deadline"]` count is `2` (static, shown for both rows regardless of age)
  - → the Sam item shows a non-empty `[data-testid="notification-timestamp"]`
  - → `[data-testid="notification-badge"]` has count `0` (all rows read after the mark-read mutation + stateful refetch)
  - → `[data-testid="notification-item"]` count is still `2` (the refetch returns the read rows, it does not clear them)
- `/` loaded with `['notifications','u1'] = []` injected and auth/profile as above
  - → `[data-testid="notification-bell"]` is visible and `[data-testid="notification-badge"]` has count `0`
- `/` loaded as a logged-out guest (no auth/profile injection; `**/auth/v1/**` stubbed `401`)
  - → `[data-testid="notification-bell"]` has count `0`

## Technical Context

- **No new dependencies.** Reuses React 19.2.0, `@tanstack/react-query` 5.100.14, `zustand` 5.0.13, `@supabase/supabase-js` 2.112.4, `react-router-dom` 7.15.1. Unit tests: vitest 4.1.6 + jsdom 29.1.1 (colocated `*.test.js`; `vitest.config.js` excludes `tests/**` and `*.spec.js`). Browser tests: `@playwright/test` 1.60.0 (`tests/*.spec.js`, `playwright.config.js`, `webServer: npx vite --port 5173`).
- **Verification gate:** `npm test -- --run` (docs/learnings.md:43-47). eslint/knip are not runnable in this repo; do not gate on them. The Playwright spec is a supplementary artifact outside the vitest gate.
- **Trigger evidence chain:** `SuccessButtons.jsx:93-116` already awaits `exportSegmentsToR2(lessonId)` and gates on `exportResult?.succeeded`; `video-processor.web.js:1252-1381` returns `{ count, succeeded }` and requires a logged-in `shareCode`; `App.jsx:19-37` stores the URL's `?shareCode` (case-insensitive) as `appStore.friendCode`; lesson `b` in `src/config/friend.json`/`newtest.json`/`test.json` has `recapSources:"friend"`. Only these courses contain lesson `b` (`model.json`/`gt2.json`/`t.json`/`test-api.json` do not), so the config guard suppresses them.
- **Profile-link reuse:** `buildShareUrl(shareCode)` (`video-processor-logic.js`) already returns `<SHARE_URL_BASE>/<shareCode>` — that *is* the public profile URL (`routes.jsx:35`). `buildProfileHref` only adds the `https://` scheme for an anchor, mirroring `toFriendLessonHref`.
- **Recipient resolution is server-side:** `public_profiles`/`user_profiles` expose `share_code`; the RPC matches case-insensitively with `lower(...)`. No client-side user-id lookup is needed.
- **RLS precedent:** `001`/`002`/`003` (grants + policies) and `004` (migration guarded by a static test in `src/modules/api/friend-links-migration.test.js`). Supabase SQL cannot run in vitest, so Task 3 locks the security-relevant shape as source text, mirroring `004`'s guard. Because it is a new table + policy + definer function (not an `add column`), this is a genuine static guard, not a rubber stamp.
- **Test data injection:** `queryClient` is exported from `src/modules/api/api.js` and passed to `QueryClientProvider` in `src/main.jsx`; `setQueryData` marks a query fresh (default `staleTime: Infinity`), so injected fixtures are not refetched (see `tests/friend-lesson-link.spec.js`, `agents.md` §4). `useNotifications` sets its own `staleTime: 30 * 1000`; inject after mount so the set data is fresh.
- **HomeScreen and bootstrap:** `HomeScreen` (`/`) does **not** call `useAppBootstrap` (only `AppLayout` does), so the bell must read `$id` from `useUserProfile()` (the shared `['user','profile']` query), not from `appStore.userData`.
- **Platform split (RN-ready):** `vite.config.js:56-58` resolves `.web.jsx`/`.web.js` before `.jsx`, and the repo already ships `.native.jsx` counterparts (e.g. `GuestLoginModal.web.jsx`/`.native.jsx`, `UserProfile.jsx`/`.native.jsx`). Presentation is therefore split into `NotificationList.web.jsx` (render only) and `NotificationsBell.web.jsx` (data container), while `notification-logic.js` stays pure. A future RN port adds `NotificationList.native.jsx`/`NotificationsBell.native.jsx` with the same props and `data-testid`s; no native files are created now because the repo treats them as unwired reference (`docs/learnings.md:27-31`).
- **Timestamp formatter is pure and platform-agnostic:** `formatNotificationDate` lives in `notification-logic.js` and uses `toLocaleString` with `LOCALE_MAP` from `src/data/languages.js` (pure data — its header explicitly forbids React/Supabase imports). `LOCALE_MAP` is keyed by the uppercase base code, so the formatter uppercases the base and falls back to `'en'` for unknown languages. The container passes HomeScreen's `lang`.
- **State:** no new Zustand slice is needed. `friendCode` is already persisted (`store.js:699`) and set from the URL.
- **`strings.test.js` coupling:** its placeholder map is a fixed object; `{name}` requires adding `name` to it (line 64). The auto-derived "every key carries hi/bn" test then covers the new keys.
- **Static source guards are deliberate for untestable paths:** the export/publish trigger (`SuccessButtons` + `exportSegmentsToR2`) and the RPC wiring cannot be driven headlessly (MediaRecorder/R2/Supabase), so Task 4 locks that contract in source text, exactly as `friend-lesson-link-wiring.test.js` does for story 012; the `HomeScreen` bell mount is likewise guarded like `landscape-warning-wiring.test.js`. Pure logic, strings, the migration shape, and the presentational UI are all exercised by real unit tests, so these guards are not a substitute for behavior coverage (contrast the guard/modal wiring story 016 could test end-to-end, which deliberately has no source guard). Guards read **raw** source — never comment-stripped source — per learnings.md:19-23.
- **Docs/learnings guards:** do not assert URLs/schemes against comment-stripped source (learnings.md:19-23); the `notifications-migration.test.js` guard reads raw SQL. No config-file invariant is added, so the `src/config/*.json` glob guidance (learnings.md:119-123) does not apply beyond the existing `friend`/`newtest`/`test` fixtures used in prose.

## Notes

- **Confirmed product decisions (user answers):** in-app only; bell in the HomeScreen top bar; persistent with read/unread (no expiry, no delete); notify on the actual export/publish only; skip guest `B`; message links to `/<B.shareCode>`; localized copy in the app's six languages; Supabase only (no new dependency); keep a seam for a future third-party provider; every friend-response notification shows a timestamp and a static "You only have 48 hours to respond" line; strict logic/presentation separation for a future React Native monorepo.
- **Lifecycle definition:** notifications never expire and are never deleted by this feature. "Read" (`read_at`) is the only state; opening the bell panel marks the visible unread rows read, which clears the badge. This is intentionally different from the 48h `friend_links` render-time expiry because the notification is an inbox record, not a live clip link.
- **48h deadline line is static, not computed:** `notifications_respond_deadline` is always rendered for `friend_response` items; there is no countdown and no `isResponseWindowOpen`/window helper. The per-item **timestamp** (`formatNotificationDate(created_at, lang)`) is what lets a user who returns after 48 hours see for themselves that the time elapsed — the app never hides or rewrites the text. This is a deliberate product decision (user answer); do not "improve" it into a countdown or a conditional without confirming.
- **Dedupe/refresh semantics:** the unique key is `(recipient_id, actor_id, type)` — one notification per friend per type. It deliberately excludes the caller-supplied `course_id`/`lesson_id`; these are stored as context only (the UI does not render them), so an authenticated caller cannot bypass dedupe by inventing course ids to flood a victim's inbox. A repeat answer by the same friend (any course/lesson) refreshes the row (`created_at = now()`, `read_at = null`, context/name snapshot updated) rather than adding another notification.
- **Self-notification prevention is enforced in two places:** the pure resolver rejects `recipient === actor` (case-insensitive), and the RPC returns early when the resolved recipient is the caller. Both are cheap; neither is trusted alone.
- **Security posture:** clients can `SELECT` only their own rows and `UPDATE` only the `read_at` column; there is no insert grant/policy, so all creation goes through the `SECURITY DEFINER` RPC, which derives `actor_id`/`actorName` from the JWT/profile. The recipient is resolved from the supplied share code, so a caller cannot target an arbitrary user id. The function sets `search_path = ''` and fully qualifies identifiers.
- **Third-party provider seam (not implemented):** add a Supabase Database Webhook or `AFTER INSERT` trigger on `public.user_notifications` routed by `type` (`friend_response`) to an Edge Function/queue that calls the provider (Resend/OneSignal/FCM/etc.). Because the RPC inserts one normalized row, the webhook receives the full `payload` (`actorShareCode`, `actorName`) with no feature change. Do not add a provider SDK or client-side dispatcher in this story.
- **Manual verification** (Supabase RLS + the MediaRecorder/R2 export cannot be exercised headlessly; logic is covered by Tasks 1-5):
  1. Apply `005_add_user_notifications.sql` to the Supabase project (or local stack).
  2. `npm run dev`, log in as `B`, open `/course/friend/lesson/b?shareCode=<A>` (B's browser must have captured the share code), complete the lesson, and click the generate button (confirm the answer clips upload).
  3. Confirm a `user_notifications` row exists with `recipient_id = A`, `actor_id = B`, `type = 'friend_response'`, and a `payload` carrying B's `shareCode`/name.
  4. Log in as `A`, open `/`: the bell shows a `1` badge; opening it lists "B… created a video with your questions" with a timestamp and the "You only have 48 hours to respond" line, and the link opens B's public profile. A week-old notification still shows both lines (the timestamp reveals the elapsed time).
  5. Re-answer as `B`: the same row is refreshed (unread again), not duplicated.
  6. Export `/course/friend/lesson/a` as `A`: no new notification (only the friend link is recorded).
  7. As a guest, generate a lesson-b video and decline login: no notification row.
- **Logging (`agents.md` §2):** keep all existing logs; the new success paths log (`[notifications] fetched`, `[notifications] marked read`, `[notifications] friend response recorded`, `trackEvent('friend_response_notified')`) and failures log via `console.error` in the mutation `onError` handlers and the retained non-fatal success-screen catch.
