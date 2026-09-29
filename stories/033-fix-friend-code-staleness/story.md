# Make `friendCode` URL-authoritative (fix stale friend share code)

## Context

`appStore.friendCode` is the friend-challenge share code read from the `?shareCode=` URL param. It is set once in `App.jsx:19-37` (mount-only, inline `URLSearchParams` parsing), persisted to `localStorage` (`store.js:98/227/711`), and **never cleared or updated**. Consequences:

- A browser that once opened `/course/friend/lesson/b?shareCode=X` keeps `friendCode: 'X'` forever, so a later `?shareCode=`-less visit to a friend lesson `a`/`b` still substitutes the previous friend's clips via `normalizeConfig` (`config-normalizer.js:79`).
- Story 026's co-authored B recap (`otherShareCode`) and the friend-response notification recipient (`SuccessButtons.jsx:102/131`) attach the stale code.
- Signup attribution (`collect-signup-data.js:18-19`) records the stale code as the referral.
- SPA navigation never re-reads the URL, so opening a different friend's link in the same session (`/course/friend/lesson/b?shareCode=Y`) does not update it either (only a full reload changes `App.jsx`'s mount-only read).

The URL is the true source: the friend code only ever exists as a query param, and login/signup preserve it (`GuestLoginModal.web.jsx:71,223`; `SaveClipsModal.web.jsx:29,81` both redirect with `location.pathname + location.search`). This story makes `friendCode` a **live mirror of the current URL** and stops persisting it. No consumer changes are needed.

## Out of Scope

- **Removing or renaming the `friendCode` store field.** `config-normalizer.js`, `SuccessButtons.jsx`, and `collect-signup-data.js` keep reading `appStore.getState().friendCode`; only its lifecycle changes.
- **The profile-level `friend_code` DB column** (`api.js:31/46/62`, `auth-check.js:59`). That is a separate signup-referral field; this story does not touch it or `toDbColumns`/`fromDbRow`.
- **Changing what a friend lesson does when no share code is present** beyond the corrected value: `{friendCode}` still resolves to empty (the existing `FRIEND_CODE_REGEX` behavior), so a `?shareCode`-less `a`/`b` lesson shows no friend clips. No new copy or UI.
- **Preserving `?shareCode=` across in-lesson "next lesson" navigation** (`LessonContainer.jsx:87` drops the query). Carrying it forward would wrongly mark the next lesson a friend lesson; clearing is correct because the friend export happens on the friend lesson before that navigation.
- **Any other store field or the guest-language behavior.**
- **R2, Supabase, notifications, or the `record_friend_response` RPC.**

## Implementation approach

### 1. URL-authoritative sync in `RootLayout` (`src/routes/RootLayout.jsx`)

`RootLayout` already wraps every route and has `const location = useLocation()`. Add one effect (after the existing pageview effect) that mirrors the URL into the store using the **existing** pure extractor `getShareCodeFromSearch` from `friend-lesson-detection.js` (`friend-lesson-detection.js:17-27`), which already handles case-insensitivity, trimming, and absent/empty:

```js
import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { getShareCodeFromSearch } from '../modules/user/friend-lesson-detection.js';
import { appStore } from '../modules/store/store.js';

// In RootLayout():
useEffect(() => {
    const code = getShareCodeFromSearch(location.search);
    if (appStore.getState().friendCode !== code) {
        appStore.getState().setFriendCode(code);
        console.log('[FriendCode] synced from URL:', code);
    }
}, [location.search]);
```

- Runs on mount and whenever the query string changes (route changes, login/signup round-trips, in-SPA navigation).
- Sets `null` when there is no `shareCode` param, so stale values are cleared before any lesson consumer runs.
- The `!==` guard avoids redundant store writes (and persist writes) on unrelated navigations.
- Because `config-normalizer` runs in `AppLayout`'s effect gated on async data (`fetchedConfig && userData && language settled`, `AppLayout.jsx:35-41`), `RootLayout`'s effect has set the value before normalization; the same async gate also covers the login/signup return path.

### 2. Remove the duplicate mount-only capture (`src/App.jsx`)

Delete the `useEffect` at `App.jsx:19-37` (inline `URLSearchParams` parsing + `setFriendCode`). RootLayout's effect replaces it; `getShareCodeFromSearch` becomes the single parser. Keep the other three `useEffect`s and the `useEffect` import.

### 3. Stop persisting `friendCode` + strip legacy persisted values (`src/modules/store/store.js`)

- Remove `friendCode: state.friendCode` from `partialize` (`store.js:711`).
- Add a persist `version` + `migrate` that drops a legacy persisted `friendCode`, so a stale value cannot hydrate on the first load after this ships:

```js
{
    name: 'uff-lesson-storage',
    version: 1,
    migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState;
        const { friendCode, ...rest } = persistedState;
        return rest;
    },
    partialize: (state) => ({ /* existing keys, friendCode removed */ })
}
```

`friendCode`'s default (`store.js:98`) stays `null`. After migration and the RootLayout sync, it always equals `getShareCodeFromSearch(current search)`.

### 4. Edge cases

- **No `?shareCode=`** (`/`, `/profile`, `/signup`, `/course/friend/lesson/b` without query): `getShareCodeFromSearch` → `null` → `setFriendCode(null)`.
- **Different query on the same route**: effect depends on `location.search` → updates to the new code.
- **Same value re-navigated**: the `!==` guard skips the write.
- **Legacy persisted `friendCode`**: removed by `migrate` before first render; also cleared by the sync.
- **Case / whitespace** (`?SHARECODE=Ab12`, `?shareCode=%20ab12`): normalized to `ab12` by `getShareCodeFromSearch`.
- **Login/signup redirect** (`/login?redirect=<friendLessonUrl>`): on the auth route the code is `null`; after `navigate(redirect)` back to the friend URL the sync restores it (the redirect keeps the query).
- **Friend export**: the friend lesson route keeps its `?shareCode=` for the whole lesson, so `SuccessButtons`/`normalizeConfig` read the correct value at export time.
- **Malformed search**: `getShareCodeFromSearch` never throws (returns `null`).

## Tasks

### Task 1 - Store: stop persisting + legacy migration (`src/modules/store/store.js`; new `src/modules/store/friend-code-persistence.test.js`)

The store persists under `localStorage['uff-lesson-storage']`. The test seeds `localStorage` then imports the store (`await import('./store.js')` with `vi.resetModules()`), reading `appStore.getState()` and `JSON.parse(localStorage.getItem('uff-lesson-storage'))`.

- store source read as text
  - → the `partialize` object does not contain `friendCode`
  - → the persist config contains `version: 1` and a `migrate` function that deletes `friendCode`
- store imported with no persisted blob
  - → `appStore.getState().friendCode` is `null`
- legacy blob `{ "state": { "friendCode": "stale", "courseId": "friend" }, "version": 0 }` seeded, store imported
  - → `appStore.getState().friendCode` is `null`
  - → `appStore.getState().courseId` is `'friend'` (other persisted keys survive)
- `setFriendCode('stale')` called, then `localStorage['uff-lesson-storage']` parsed
  - → `.state.friendCode` is `undefined`
  - → the written blob has `version === 1`

### Task 2 - URL sync in RootLayout (`src/routes/RootLayout.jsx`; new `src/routes/RootLayout.friend-code.test.js`)

The test mocks RootLayout's heavy children (`GuestLoginModal.web.jsx`, `SaveClipsModal.web.jsx`, `Preloader.jsx`), `use-guest-modal-guard.js`, and `posthog.js`, renders it inside a `MemoryRouter` + `Routes`, and asserts `appStore.getState().friendCode` (resetting it to `null` between cases).

- RootLayout source, comments stripped
  - → imports `getShareCodeFromSearch` from `../modules/user/friend-lesson-detection.js` and `appStore`
  - → its effect calls `setFriendCode(getShareCodeFromSearch(location.search))` and depends on `location.search`
- rendered at `/course/friend/lesson/b?shareCode=Ab12`
  - → `appStore.getState().friendCode` is `'ab12'`
- rendered at `/?SHARECODE=Ab12`
  - → `'ab12'`
- rendered at `/?shareCode=` (empty value)
  - → `null`
- rendered at `/`
  - → `null`
- rendered at `/course/friend/lesson/b` (no query)
  - → `null`
- rendered at `/` after first rendering at `/?shareCode=ab12` (same mounted RootLayout, a location change)
  - → `null`

### Task 3 - Remove the duplicate capture (`src/App.jsx`)

- `App.jsx` source, comments stripped
  - → contains no `URLSearchParams` and no `setFriendCode` call
  - → still contains the PostHog import effect and the `useEffect` import
- `src/routes/RootLayout.jsx` source, comments stripped
  - → contains `setFriendCode(` (the sole URL-driven writer)

### Task 4 - End-to-end staleness (new `tests/friend-code-staleness.spec.js`, Playwright)

Read the live store via `page.evaluate(async () => (await import('/src/modules/store/store.js')).appStore.getState().friendCode)` (the app's singleton is module-cached; same pattern as the existing `queryClient` injection). Stub Supabase (`**/auth/v1/**` → 401, `**/rest/v1/**` → `[]`) so the home route settles.

- localStorage `uff-lesson-storage` seeded **once** with `{ state: { friendCode: 'stale' }, version: 0 }` via `page.addInitScript` guarded by `if (!localStorage.getItem('uff-lesson-storage'))` (so later `goto`s do not re-seed it), then `/` loaded
  - → the imported store's `friendCode` is `null` (migration + no-query sync)
- `/?shareCode=Ab12` loaded
  - → `'ab12'`
- `/?shareCode=Ab12` loaded, then `page.goto('/')`
  - → `null`
- `/?shareCode=ab12` loaded, then `page.goto('/?shareCode=cd34')`
  - → `'cd34'`
- `/?SHARECODE=Ab12` loaded
  - → `'ab12'`
- the existing `tests/friend-lesson-modals.spec.js` and `tests/friend-video-only.spec.js` (which open `?shareCode=` friend lessons) run
  - → still pass (the URL sync sets the code on load, so friend-lesson behavior is preserved)

## Technical Context

- **No new dependencies.** Reuses React 19.2.0, `react-router-dom` 7.15.1, `zustand` 5.0.13, `@tanstack/react-query` 5.100.14, `@supabase/supabase-js` 2.112.4. Unit tests: vitest 4.1.6 + jsdom 29.1.1 (colocated `*.test.js`; `vitest.config.js` excludes `tests/**` and `*.spec.js`). Browser tests: `@playwright/test` 1.60.0. Gate: `npm test -- --run`; the Playwright spec is supplementary.
- **Single parser:** `getShareCodeFromSearch(search)` (`friend-lesson-detection.js:17-27`) is already unit-tested (case-insensitive key, trims/lowercases, `null` for empty/absent). `App.jsx` currently duplicates this logic inline; this story deletes the duplicate.
- **Why the store stays:** `normalizeConfig` (`config-normalizer.js:79`), `SuccessButtons` (`SuccessButtons.jsx:102/131`), and `collect-signup-data.js:18` all read `appStore.getState().friendCode`. Keeping the field and fixing its lifecycle is the minimal change; no consumer edits.
- **Zustand persist semantics:** `partialize` only controls what is written; a previously persisted `friendCode` still hydrates, so the `version`/`migrate` bump is required to strip it. Persisted store name is `uff-lesson-storage` (`store.js:683`).
- **Timing:** `RootLayout` renders above `AppLayout`; its effect sets the code before `AppLayout`'s config-normalization effect runs, which is itself gated on async `fetchedConfig`/`userData`/settled language (`AppLayout.jsx:35-41`).
- **Login/signup preserve the query:** `GuestLoginModal.web.jsx:71/223/234` and `SaveClipsModal.web.jsx:29/81` redirect with `location.pathname + location.search`, so returning from auth restores the friend code via the sync.
- **`window.appStore` is only set when a lesson mounts** (`use-app-bootstrap-webonly.js:26-31`), so the Playwright spec imports the store module directly rather than relying on the bridge.

## Notes

- **Root cause and fix (one line):** `friendCode` was captured once and persisted; now it is derived from `location.search` on every route change and is not persisted. The URL is authoritative; the store is its live mirror.
- **Behavior change to expect:** a friend lesson opened without a `?shareCode=` no longer shows a previously-used friend's clips (it correctly shows none), and signup no longer records a stale referral. A friend link opened in the same SPA session now updates the code instead of requiring a reload.
- **No SQL, no R2, no notification changes.**
- **Documentation (non-automatable):** update `docs/learnings.md` — the entry "`appStore.friendCode` is persisted and never cleared — it can be stale" (line ~86) should be revised to record the fix (URL-authoritative + not persisted + `version`/`migrate`). Optionally add a line to `agents.md`'s identity/language section: `friendCode` is derived from `location.search` by `RootLayout`; read it from the store but never assume it is persisted.
- **Manual verification** (route/navigation behavior is covered by Tasks 1-4; this is the user-facing check):
  1. Open `/course/friend/lesson/b?shareCode=<A>`; confirm the lesson shows A's question clips and finishing the export creates `<B>-<A>-friend-b-complete.mp4` with A as the notification recipient.
  2. Without reloading, navigate home (`/`); confirm `appStore.getState().friendCode` is `null` in the console.
  3. Now open `/course/friend/lesson/b` (no `?shareCode=`); confirm no friend clips play and a plain `b` export creates the single-code `<B>-friend-b-complete.mp4`.
  4. Reload `/course/friend/lesson/b?shareCode=<A>`; confirm A's clips return.
  5. Sign up from `/signup` after the above; confirm the referral recorded is not A's stale code.
