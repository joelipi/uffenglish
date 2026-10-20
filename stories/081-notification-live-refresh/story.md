# The in-app notification inbox refreshes itself (no reload needed)

## Context

The in-app notification inbox works, but a notification that arrives while the
app is already open is **only visible after a full page reload**.

Why: the bell is mounted **once** by the app shell
(`src/routes/AppShellLayout.jsx` → `src/components/layout/AppHeader.web.jsx` →
`NotificationsBell.web.jsx`), so the `useNotifications(userId)` query
(`src/modules/api/api.js`) is created once per session and stays mounted for as
long as the user is inside the app. Its options never ask for a re-read:

- `staleTime: 30 * 1000` — the cached inbox is considered fresh for 30 s,
- `refetchOnWindowFocus` — the **global** `QueryClient` default is `false`
  (`src/modules/api/api.js:78-87`), so returning to the tab re-reads nothing,
- no `refetchInterval` — nothing ever re-reads the inbox while the page is open.

The only re-read that happens is the one the mark-read mutation triggers
(`invalidateQueries({ queryKey: ['notifications', userId] })`). So a friend who
answers while the asker has the app open produces a row that the asker sees
only after reloading the page — the row is written server-side by
`record_friend_response()` (`supabase/migrations/005_add_user_notifications.sql`)
and nothing on the client is watching for it.

## The request

- The inbox must be updated **when the page is opened** (at the very least),
  and ideally **within a few seconds** of a notification arriving.
- The mechanism must be **free**, must not add **third-party services** or
  **new dependencies**, and must not **unduly burden the user's device**
  (a phone in the background must not keep polling).

## Out of Scope

- **Changing the notification row, the dedupe key or the RPC** — the write path
  is server-side and already correct.
- **Web push** (story 063) — that is the delivery channel for an app that is
  *closed*. This story is about the in-app inbox while the app is *open*.
- **Supabase Realtime** (`postgres_changes`): it would deliver the row
  instantly with no polling at all, but it needs the table added to the
  `supabase_realtime` publication (a migration on the live database) and its
  RLS/authorization behaviour is a second thing to get wrong. A poll through
  the query layer the app already uses is free, verifiable and reversible.
- **Merging into `main`.**

## Implementation approach

The inbox query gets an explicit **refresh policy**, kept in a pure module so
it is unit-testable and reusable by the React Native port:

`src/modules/notifications/notification-refresh-logic.js`

- `NOTIFICATION_REFRESH_INTERVAL_MS = 5000` — how often the inbox is re-read
  while the page is visible.
- `resolveNotificationRefreshOptions(userId)` → the TanStack Query options:
  - `staleTime: 0` — the cached inbox is never "fresh enough" to serve as-is;
  - `refetchOnMount: 'always'` — **opening the app re-reads the inbox** (the
    requirement's minimum);
  - `refetchOnWindowFocus: 'always'` — coming back to the tab (a phone locked
    and unlocked) re-reads it;
  - `refetchInterval: 5000` — while the page is visible the inbox is re-read
    every few seconds, so a notification that arrives shows up **without a
    reload**;
  - `refetchIntervalInBackground: false` — a **hidden** page (a backgrounded
    phone, a minimised window) stops polling: the requests and the radio
    wake-ups would be pure waste there, and the focus refetch brings the inbox
    up to date the moment the user returns.

`useNotifications(userId)` spreads those options into the query. Nothing else
changes: the same query key, the same RLS-scoped select, the same mark-read
mutation.

**Why polling and not a websocket:** the poll is one small `GET` every five
seconds, only while the page is visible, and it uses the query layer the app
already runs. It needs no new dependency, no database change, no third-party
service and no new credentials — and it is the same mechanism on every browser
the app supports, including a phone whose OS has put the tab to sleep.

**Why the payload is not a concern here:** the inbox is the recipient's own
rows (RLS-scoped, `limit(50)`) and is empty for most users — the poll of an
empty inbox is a two-line response. The expensive part of a request is the
round trip, and that is what the visibility rule keeps rare.

**Route changes:** the bell lives in the app shell, so navigating between
inside pages (`/home` → `/courses`) does not remount it. The 5-second poll
covers that case — the inbox is at most five seconds old — and the shell's
mount refetch covers the "the user opened the app" case immediately.

## Tasks

- `src/modules/notifications/notification-refresh-logic.js` (new)
  → the pure refresh policy (no React, no DOM, no data access)
- `src/modules/api/api.js`
  → `useNotifications` spreads `resolveNotificationRefreshOptions(userId)`
- `src/modules/notifications/notification-refresh-logic.test.js` (new)
  → the policy's values, and that it stays free of React/DOM imports
- `src/modules/api/api.notifications-refresh.test.js` (new)
  → the behaviour: the inbox is read on mount, re-read every five seconds
    while the page is visible, **not** re-read while the page is hidden, and
    never read at all for a guest
- `tests/notifications.spec.js`
  → the browser assertion: a notification that arrives while `/home` is open
    appears in the badge **without a reload**
  → and the "empty inbox" case now empties the **stubbed server** too: that
    spec injected an empty inbox into the query cache while the server still
    held two rows, which only passed while the inbox was never re-read

## Acceptance criteria

1. opening the app re-reads the inbox
   → the behaviour test asserts a read on mount; the query options carry
     `refetchOnMount: 'always'`
2. the inbox is re-read every few seconds while the page is visible, so a new
   notification appears without a reload
   → the behaviour test advances the clock by 5 s and asserts a second read;
     the browser spec adds a row to the stubbed server and waits for the badge
     to show it (no reload)
3. a hidden page does not poll
   → the behaviour test makes the document hidden and asserts no further read
     happens; the options carry `refetchIntervalInBackground: false`
4. a guest (no account) never polls
   → the behaviour test asserts no read at all for `userId: 'guest'`
5. no new dependency and no third-party service
   → the diff touches no `package.json`; the mechanism is the query layer the
     app already uses
6. `npx vitest run` reports 0 failures; `npm run build` and `npm run lint`
   exit 0; the notifications browser spec passes
   → commands and output recorded in the completion report

## Notes for reviewers

- **The poll is per mounted bell, not per user.** Two observers of the same
  query key share one query, so the mark-read invalidation and the poll cannot
  fight over the data.
- **`refetchOnWindowFocus: 'always'` overrides the global `false`**, which is
  deliberate: the global default exists because most queries in this app are
  write-once config reads. The inbox is the one query whose whole job is to
  show what happened elsewhere.
- **The 30-second `staleTime` is gone on purpose.** It was the reason a
  re-mounted bell could serve a stale inbox; `staleTime: 0` plus the explicit
  `always` refetch flags make the intent readable.
- **The visibility rule is TanStack's, not ours**: `refetchIntervalInBackground:
  false` only fires the interval while `document.visibilityState !== 'hidden'`
  (`focusManager.isFocused()` in `@tanstack/query-core`). A phone that
  backgrounds the tab therefore stops polling immediately, and the focus
  refetch runs the moment the tab becomes visible again.
