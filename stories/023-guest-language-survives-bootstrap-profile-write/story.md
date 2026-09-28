# Guest-chosen language survives the async profile bootstrap

## Context

When a guest confirms a language in the guest modal (`confirmGuestLanguage`, `src/components/modals/GuestLoginModal.web.jsx:111`), the store writes **both** `guestNativeLanguage` and `userData.native_language` in one `set()` (`store.js:241-249`). The rest of the app then reads the language guest-first — `guestNativeLanguage || userData?.native_language || 'en'` — in `config-normalizer.js:19`, `video-share.web.js:23`, `HomeScreen.jsx:18`, `PublicProfile.jsx:50`.

The bug: `useAppBootstrap` writes `userData` asynchronously via `setCourseData({ userData })` once its queries resolve (`use-app-bootstrap-webonly.js:62`). It waits on `useAuthStatus` **and** `useUserProfile` (`authLoading || profileLoading`, line 52), but the guest modal is opened by `useGuestModalGuard` on `useAuthStatus` alone (`use-guest-modal-guard.js:31,43`). So the user can confirm Spanish while the profile query is still pending; when it resolves, bootstrap calls `setCourseData({ userData })` with the fetched guest profile (`native_language: 'EN'`, `api.js:222-234`) and overwrites the confirmed `'ES'`. `guestNativeLanguage` stays `'ES'`, so guest-first consumers still show Spanish while every component that reads `userData.native_language` directly (`MissionSection`, `DecisionButtons`, `Hints`, `SuccessButtons`, lesson step labels, the recap renderer, …) flips back to English.

Story 016 added a re-apply effect for the **silently adopted** language only (`silentLangRef` + `resolveSilentLanguageReapply`, `use-guest-modal-guard.js:74-95`); the modal-confirmed path has no equivalent protection.

## Out of Scope

- **The recap read-site fix.** `fix-recap-guest-language` (separate branch/PR) makes `video-processor.web.js` resolve guest-first as defence in depth. This story fixes the root cause at the write point, after which that change is redundant but harmless; the two may be merged in any order or the recap branch dropped. Do not duplicate its production change here.
- **Rewriting every `userData.native_language` consumer to guest-first.** The agreed single source of truth is the store mirror: keep `userData.native_language` correct for guests so existing consumers work unchanged.
- **Logged-in behavior.** A logged-in profile language remains authoritative (`isLoggedIn` always wins); no change.
- **Story 016's modal steps, strings, or `resolveSilentLanguageReapply`.** The existing re-apply effect is kept as a backstop; it is not removed or restructured.
- **Persisting/clearing `guestNativeLanguage`, or the mid-session-login staleness** already documented in `agents.md`/story 016.
- **Any new dependency.** Pure JS + the existing Zustand store.

## Implementation approach

### 1. Make the guest's chosen language authoritative at the store write point

`setCourseData` is the single writer of `userData` from fetched profile data (grep: only `useAppBootstrap:62` and `AppLayout.jsx:40` call it, and only bootstrap passes `userData`). Guaranteeing the rule there protects every consumer, regardless of query-timing, and does not depend on the guard's effect ordering.

Add a pure helper to `src/modules/user/guest-modal-logic.js` (already the home of the guest-language decisions, dependency-free — it has no imports, so importing it into the store cannot create a cycle):

```js
/**
 * Applies the guest's chosen language over a profile object. A guest's
 * `guestNativeLanguage` is authoritative: the async bootstrap writes the
 * fetched guest profile (native_language 'EN') and must not revert a language
 * the guest already confirmed. Logged-in users are untouched (profile wins).
 * Returns the SAME reference when nothing changes, so React does not re-render.
 */
export function applyGuestLanguagePreference({ userData, guestLang, isLoggedIn } = {}) {
    if (isLoggedIn) return userData;
    if (!guestLang) return userData;
    if (!userData || typeof userData !== 'object') return userData;
    if (userData.native_language === guestLang) return userData;
    return { ...userData, native_language: guestLang };
}
```

Use it in `store.js` `setCourseData` (currently `store.js:330-335`):

```js
import { applyGuestLanguagePreference } from '../user/guest-modal-logic.js';

setCourseData: (data) => set((state) => {
    const incomingUserData = data.userData !== undefined ? data.userData : state.userData;
    return {
        userData: applyGuestLanguagePreference({
            userData: incomingUserData,
            guestLang: state.guestNativeLanguage,
            isLoggedIn: state.isLoggedIn,
        }),
        configData: data.configData !== undefined ? data.configData : state.configData,
        courseId: data.courseId !== undefined ? data.courseId : state.courseId,
        userLevel: data.userLevel !== undefined ? data.userLevel : state.userLevel,
    };
}),
```

`useAppBootstrap` already calls `setIsLoggedIn(!!isLoggedIn)` before `setCourseData` (`use-app-bootstrap-webonly.js:58,62`), so `state.isLoggedIn` is correct at the write. `setCourseData` calls that omit `userData` (AppLayout config write) keep the current object and re-apply idempotently.

### 2. Why this fully closes the race

- Modal-confirmed (`confirmGuestLanguage`) and silently adopted (`setGuestLanguageSilent`) both set `guestNativeLanguage`; after this change a late bootstrap write can no longer revert `userData.native_language`.
- The guard's existing re-apply effect remains a harmless backstop for any unforeseen write; it is not load-bearing for the reported bug anymore.
- No call-site or timing assumption is required, which is what made the current protection incomplete.

### 3. Edge cases

- **Guest, no language chosen** (`guestNativeLanguage` null): the incoming profile language is kept unchanged (`'EN'` default).
- **Guest chose `'OTHER'`**: `'OTHER'` is a valid `guestNativeLanguage`; the mirror keeps `'OTHER'` and existing fallback logic (`Strings.get` → English) is unchanged.
- **Logged in, stale persisted `guestNativeLanguage` from an old guest session**: `isLoggedIn` short-circuits, so the profile language is never overridden.
- **`userData` null/undefined and no incoming**: helper returns it unchanged; the store keeps `state.userData`.
- **Incoming already equals `guestNativeLanguage`**: same object reference returned (no re-render).
- **Config-only `setCourseData` (no `userData` field)**: re-applies the guest language to the existing object idempotently.
- **Login within the same SPA session**: unaffected — `setCourseData` is not called again after login (`initStarted` guard), and a fresh load uses the profile.

## Tasks

### Task 1 - Pure guest-language preference helper (`src/modules/user/guest-modal-logic.test.js` updated)

- `applyGuestLanguagePreference({ userData: { native_language: 'EN' }, guestLang: 'ES', isLoggedIn: false })`
  - → `{ native_language: 'ES' }` (other keys preserved)
- `applyGuestLanguagePreference` called with a guest whose `userData.native_language` already equals `guestLang`
  - → returns the **same object reference**
- `applyGuestLanguagePreference({ userData: { native_language: 'EN' }, guestLang: null, isLoggedIn: false })`
  - → returns the same object reference (no chosen language)
- `applyGuestLanguagePreference({ userData: { native_language: 'EN' }, guestLang: 'ES', isLoggedIn: true })`
  - → returns the same object reference (logged-in profile wins)
- `applyGuestLanguagePreference({ userData: null, guestLang: 'ES', isLoggedIn: false })` / `({ userData: undefined, guestLang: 'ES' })` / `({ userData: 'x', guestLang: 'ES' })`
  - → returns the input unchanged (`null`/`undefined`/non-object not coerced)
- `applyGuestLanguagePreference({ userData: { $id: 'guest', native_language: 'EN' }, guestLang: 'ES' })`
  - → the returned object has `native_language: 'ES'` and `$id: 'guest'`, and is a new object
- `applyGuestLanguagePreference()` (no args)
  - → `undefined` (no throw)

### Task 2 - Store write-point guarantee (`src/modules/store/store.js` changed; `src/modules/store/guest-modal-store.test.js` updated)

- `guestNativeLanguage: 'ES'`, `isLoggedIn: false`, `userData: { $id: 'guest', native_language: 'ES' }`, then `setCourseData({ userData: { $id: 'guest', native_language: 'EN' } })`
  - → `userData.native_language === 'ES'` (late bootstrap cannot revert the choice)
- `guestNativeLanguage: 'ES'`, `isLoggedIn: true`, `userData: { $id: 'u1', native_language: 'ES' }`, then `setCourseData({ userData: { $id: 'u1', native_language: 'EN' } })`
  - → `userData.native_language === 'EN'` (logged-in profile wins)
- `guestNativeLanguage: null`, `isLoggedIn: false`, `userData: null`, then `setCourseData({ userData: { $id: 'guest', native_language: 'EN' } })`
  - → `userData.native_language === 'EN'`
- `guestNativeLanguage: 'ES'`, `userData: { $id: 'guest', native_language: 'ES' }`, then `setCourseData({ configData: { lessons: [] }, courseId: 'friend' })` (no `userData` key)
  - → `userData.native_language` stays `'ES'`; `configData` and `courseId` are written
- `setCourseData({ userData: <incoming> })`
  - → `configData`/`courseId`/`userLevel` not present in the payload are preserved from the previous state
- `setCourseData({ userData: { $id: 'guest', native_language: 'EN' } })` with `guestNativeLanguage: 'ES'`
  - → returns a **new** `userData` object whose `$id` is preserved

## Technical Context

- **No new dependencies.** Reuses React 19.2.0, `zustand` 5.0.13, `@tanstack/react-query` 5.100.14. Unit tests: vitest 4.1.6 + jsdom 29.1.1 (`npm test -- --run` is the repo's verification gate; eslint/knip are not runnable here — `docs/learnings.md:43-47`).
- **Single writer:** `setCourseData` is the only store action that writes `userData` from fetched data. `setGuestLanguageSilent`/`confirmGuestLanguage` write it with the chosen language; `avatar-client-store.js:22` spreads the current object (preserves `native_language`); `answer-pipeline.js:766` and `step-executor-webonly.js:223` pass the existing object through. Fixing `setCourseData` therefore covers the clobber.
- **No import cycle:** `src/modules/user/guest-modal-logic.js` has no imports (verified), so `store.js` may import it; `config-normalizer.js` already imports the reverse direction indirectly via the store, and the helper is pure.
- **Why not fix bootstrap instead:** the store chokepoint protects any future profile write, requires no ordering assumptions, and is directly unit-testable (the repo tests store actions in `guest-modal-store.test.js`).
- **Race evidence:** `useAppBootstrap` gates on `authLoading || profileLoading` (`use-app-bootstrap-webonly.js:52`) while `useGuestModalGuard` gates on `authLoading` only (`use-guest-modal-guard.js:31`). `useUserProfile` for a guest still performs an async `getCurrentUser()` before returning the default guest profile (`api.js:222-234`), so the two queries can resolve in either order.
- **Existing backstop:** story 016's `resolveSilentLanguageReapply` / `silentLangRef` effect (`use-guest-modal-guard.js:74-95`) re-applies only the silently adopted language and is left in place; it is unit-tested in `guest-modal-logic.test.js` and unaffected.
- **Complementary branch:** `fix-recap-guest-language` changes the recap read site to guest-first (`video-processor.web.js`). This story does not touch that file.

## Notes

- **Product doc updated:** the "Guest mode" bullet in `docs/product.md` now states that a guest-chosen/a silently adopted language survives the asynchronous profile bootstrap and links to this story. This is a description of already-shipped user-visible behavior, not a separate deliverable, so it carries no test.
- **Confirmed root cause (user report):** guest, selected Spanish via the modal, most UI Spanish but the recap share headline/deadline English. The profile-only recap read was patched in `fix-recap-guest-language`; this story removes the underlying stale-mirror condition so all consumers are fixed.
- **Guarantee (not a timing fix):** after this change `userData.native_language` cannot be reverted from a confirmed guest language by any `setCourseData` write, in any query-resolution order.
- **Backstop kept:** the story 016 re-apply effect is not removed; removing it is out of scope and would widen the blast radius of a bug fix. It now rarely (if ever) fires.
- **Manual verification** (the modal/bootstrap race is timing-dependent and not reliably reproducible headlessly without artificial delay, so the deterministic coverage is the store unit tests):
  1. `npm run dev`, open a non-friend lesson as a guest (e.g. `/course/model/lesson/g`) with a slow network throttle so the profile query resolves after the modal.
  2. In the guest modal select Spanish and continue as a guest.
  3. In the console, `window.appStore.getState().userData.native_language` is `'ES'` after bootstrap settles (not `'EN'`), and the recap share headline/deadline render in Spanish.
  4. Repeat logged in with an English profile: the profile language wins and no Spanish override occurs.
- **Logging (`agents.md` §2):** the change adds no new logging path and removes none; the existing `[GuestModalGuard]` and bootstrap logs are unchanged.
