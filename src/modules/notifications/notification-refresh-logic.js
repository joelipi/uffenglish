// modules/notifications/notification-refresh-logic.js
// Pure refresh policy for the in-app notification inbox. No React, no DOM, no
// data access — the rules live here so they can be unit-tested and reused by
// the React Native port (presentation lives in
// src/components/homescreen/NotificationsBell.web.jsx).
//
// Why this module exists: the bell is mounted ONCE by the app shell, so the
// inbox query lives for the whole session. Without an explicit refresh rule a
// notification that arrives while the app is open stays invisible until the
// page is reloaded. The rule below re-reads the inbox on the three moments
// that matter — the app is opened, the user comes back to the tab, and every
// few seconds while the page is visible — and stops there.

/**
 * How often the inbox is re-read while the page is visible.
 *
 * Five seconds: fast enough that a notification feels live, slow enough that
 * the poll is one small request every few seconds on a device that may be on
 * cellular data.
 */
export const NOTIFICATION_REFRESH_INTERVAL_MS = 5000;

/**
 * The poll period for a viewer, or `false` when there is nothing to poll for.
 *
 * A guest has no inbox (the query is disabled for them too), so the poll must
 * not run at all — a signed-out visitor must not keep a timer alive.
 */
export function resolveNotificationRefreshInterval(userId) {
  if (!userId || userId === 'guest') return false;
  return NOTIFICATION_REFRESH_INTERVAL_MS;
}

/**
 * The TanStack Query options that make the inbox self-refreshing.
 *
 * - `staleTime: 0` — the cached inbox is never "fresh enough" to serve as-is.
 * - `refetchOnMount: 'always'` — opening the app re-reads the inbox. This is
 *   the floor: the user must never need a reload to see a notification.
 * - `refetchOnWindowFocus: 'always'` — coming back to the tab (a phone locked
 *   and unlocked) re-reads it. The app's global default is `false`, because
 *   most queries here are write-once config reads; the inbox is the one query
 *   whose whole job is to show what happened elsewhere.
 * - `refetchInterval` — while the page is visible the inbox is re-read every
 *   few seconds, so a notification that arrives shows up without a reload.
 * - `refetchIntervalInBackground: false` — a HIDDEN page (a backgrounded
 *   phone, a minimised window) stops polling: the requests and the radio
 *   wake-ups would be pure waste there, and the focus refetch brings the
 *   inbox up to date the moment the user returns.
 */
export function resolveNotificationRefreshOptions(userId) {
  return {
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: resolveNotificationRefreshInterval(userId),
    refetchIntervalInBackground: false,
  };
}
