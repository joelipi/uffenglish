# Friend lessons skip the guest login + language modal

## Context

`src/hooks/use-guest-modal-guard.js` currently opens the guest modal (`GuestLoginModal.web.jsx`) for every anonymous visitor on a non-auth route. That modal is a two-step flow (`select-language` → `login-choice`). A friend who opens a friend-challenge practice link (`/course/<courseId>/lesson/<lessonId>?shareCode=<code>`, built by `buildFriendLessonLink`, `src/modules/user/friend-lesson-link-logic.js:16`) is a fresh anonymous visitor, so today they are interrupted by a language-confirmation step and then a Log In / Sign Up / Continue as Guest step before they can answer the questions.

Friend lessons are meant to be low-friction: the friend should be able to start practicing immediately. This story makes the guest guard friend-aware:

- Friend lesson + **non-English** browser language → no modal at all; adopt the browser language silently.
- Friend lesson + **English** browser language → show the language-confirmation step only; never the login step.
- Non-friend lesson → the existing two-step flow is unchanged.

A "friend lesson" is detected synchronously from the route alone so nothing can flash: the URL carries a case-insensitive `?shareCode=` parameter, **or** the route's lesson id is `a` or `b` (the friend-challenge ask/answer lesson ids). Course id is deliberately not part of the predicate because course ids are open-ended.

## Out of Scope

- **The login step is not removed from the app.** Logged-out friends can still log in after recording, via the success screen's `SaveClipsModal` ("Log in to add your clips", `src/components/modals/SaveClipsModal.web.jsx`), or from the HomeScreen menu's `Sign In` link (`src/components/homescreen/HomeScreen.jsx:158`, `/login`). Neither is modified.
- **The auth routes/forms** (`/login`, `/signup`, `/recover-password`, `/reset-password`) and the guest modal's step-2 UI/strings.
- **The native stub** `src/components/modals/GuestLoginModal.native.jsx` (returns `null`; not shipped).
- **New UI copy** — no new `Strings` keys are needed.
- **Config files / lesson content** (`src/config/*.json`) — friend lesson ids are read from the existing configs, never changed.
- **R2, video, speech, and recap** behavior.

## Implementation approach

### 1. Detection rule (pure, synchronous, no course id)

New module `src/modules/user/friend-lesson-detection.js`:

```js
// Friend-challenge lessons use the ids 'a' (ask) and 'b' (answer). Course ids
// are open-ended, so they are deliberately not part of the predicate.
export const FRIEND_LESSON_IDS = ['a', 'b'];

// Case-insensitive ?shareCode= in a URL search string (with or without '?').
// Returns the trimmed, lowercased code, or null.
export function getShareCodeFromSearch(search) {
    if (typeof search !== 'string' || search === '') return null;
    const params = new URLSearchParams(search[0] === '?' ? search.slice(1) : search);
    for (const [key, value] of params) {
        if (key.toLowerCase() === 'sharecode') {
            const code = value.trim().toLowerCase();
            return code || null;
        }
    }
    return null;
}

// Lesson id from '/course/:courseId/lesson/:lessonId'; null for any other path.
export function getLessonIdFromPathname(pathname) {
    if (typeof pathname !== 'string' || pathname === '') return null;
    const match = /^\/course\/[^/]+\/lesson\/([^/]+)\/?$/.exec(pathname);
    return match ? decodeURIComponent(match[1]) : null;
}

// A friend lesson is opened via a friend share link (?shareCode=) or is a
// friend-challenge lesson id ('a'/'b'), in any course.
export function isFriendLesson({ search, pathname } = {}) {
    if (getShareCodeFromSearch(search)) return true;
    const lessonId = getLessonIdFromPathname(pathname);
    return lessonId !== null && FRIEND_LESSON_IDS.includes(lessonId);
}
```

The stored `friendCode` value is **not** used for detection; only the live URL and the route's lesson id.

### 2. Modal decision rule (pure)

New module `src/modules/user/guest-modal-logic.js`:

```js
export const ENGLISH_LANG = 'EN';

// - friend lesson + non-English browser -> adopt the browser language silently
//   (no modal at all)
// - friend lesson + English browser     -> language step only
// - non-friend lesson                   -> the existing two-step flow
export function resolveGuestModalPlan({ isFriendLesson, detectedLang } = {}) {
    const lang = (typeof detectedLang === 'string' && detectedLang) ? detectedLang : ENGLISH_LANG;
    if (isFriendLesson && lang !== ENGLISH_LANG) {
        return { action: 'adopt-silently', language: lang };
    }
    return { action: 'open-language', friendMode: !!isFriendLesson };
}
```

`detectedLang` is produced by the existing `detectBrowserLanguage()` (uppercase base code). Any non-`EN` value — supported or not — is adopted silently; unsupported codes fall back to English content exactly as existing guest mode does.

### 3. Store (`src/modules/store/store.js`)

- Add session flag `guestModalFriendMode: false` and setter `setGuestModalFriendMode: (val) => set({ guestModalFriendMode: val })`.
- Add `setGuestLanguageSilent(lang)` — writes `guestNativeLanguage` and `userData.native_language` **without** changing `guestModalStep` or opening the modal:

```js
setGuestLanguageSilent: (lang) => set((state) => ({
    guestNativeLanguage: lang,
    userData: state.userData
        ? { ...state.userData, native_language: lang }
        : { native_language: lang },
})),
```

- Replace `setGuestLanguageAndAdvance` with a branching `confirmGuestLanguage(lang)` (keep the existing "atomic single set()" comment). In friend mode it closes the modal instead of advancing to `login-choice`:

```js
confirmGuestLanguage: (lang) => set((state) => {
    const userData = state.userData
        ? { ...state.userData, native_language: lang }
        : { native_language: lang };
    if (state.guestModalFriendMode) {
        return { guestNativeLanguage: lang, userData, isGuestModalOpen: false };
    }
    return { guestNativeLanguage: lang, userData, guestModalStep: 'login-choice' };
}),
```

### 4. Guard (`src/hooks/use-guest-modal-guard.js`)

In the open effect, replace the unconditional open with the plan:

- Compute `const friendLesson = isFriendLesson({ search: location.search, pathname: path })` and `const plan = resolveGuestModalPlan({ isFriendLesson: friendLesson, detectedLang: detectBrowserLanguage() })`.
- Always set `setGuestDetectedLang`, `setGuestModalShownThisSession(true)`, and `setGuestModalFriendMode(friendLesson)`.
- `plan.action === 'adopt-silently'` → store `plan.language` in a ref, call `setGuestLanguageSilent(plan.language)`, ensure `setGuestModalOpen(false)`, log, and return. The modal is never opened, so there is no flash.
- Otherwise → `setGuestModalStep('select-language')` and `setGuestModalOpen(true)` (unchanged non-friend behavior; friend + English also lands here but with `guestModalFriendMode` true so step 2 never renders).
- Add `location.search` to the effect deps.
- Add a second effect (deps on the store's `userData` via `useStore`) that re-applies the silent language if a later bootstrap write replaces `userData`:

```js
useEffect(() => {
    const lang = silentLangRef.current;
    if (!lang) return;
    if (storeUserData?.native_language === lang) return;
    appStore.getState().setGuestLanguageSilent(lang);
}, [storeUserData]);
```

This closes the one race this story introduces: `useAppBootstrap` calls `setCourseData({ userData })` with the guest profile (default `native_language: 'EN'`) asynchronously, and the guard effect can fire before it. The ref + store subscription guarantees the adopted language sticks.

### 5. Modal (`src/components/modals/GuestLoginModal.web.jsx`)

Replace the three `setGuestLanguageAndAdvance(...)` calls (`handleContinueWithSelected`, `handleEnglishOnly`, `handleNotListed`) with `confirmGuestLanguage(...)`. No render/structure/string changes: in friend mode the step never becomes `login-choice`, so the login buttons are never mounted.

### 6. Behavior matrix

| lesson | `?shareCode=` | lesson id | browser lang | result |
|---|---|---|---|---|
| friend answer | yes | any | ES | no modal; `native_language = ES` |
| friend answer | yes | any | EN | language step only; confirm closes modal |
| friend a/b | no | `a`/`b` | ES | no modal; `native_language = ES` |
| friend a/b | no | `a`/`b` | EN | language step only; confirm closes modal |
| non-friend | no | `g` | ES/EN | unchanged two-step modal |
| non-friend opened with a share code | yes | `wa` | ES | no modal; `native_language = ES` |

## Tasks

### Task 1 - Pure detection + decision logic (`src/modules/user/friend-lesson-detection.test.js` and `src/modules/user/guest-modal-logic.test.js`, both new)

- `getShareCodeFromSearch('?shareCode=Ab12')` and `('?SHARECODE=Ab12')` and `('shareCode=Ab12')`
  - → `'ab12'` for each
- `getShareCodeFromSearch('?shareCode=')` / `('?other=1')` / `('')` / `(null)` / `(undefined)`
  - → `null` for each
- `getLessonIdFromPathname('/course/friend/lesson/b')` / `('/course/friend/lesson/b/')` / `('/course/model/lesson/wa')`
  - → `'b'` / `'b'` / `'wa'`
- `getLessonIdFromPathname('/')` / `('/profile')` / `('/course/model/lesson')` / `('/course/model/lesson/g/extra')` / `(null)`
  - → `null` for each
- `isFriendLesson({ pathname: '/course/friend/lesson/b' })`, `({ pathname: '/course/model/lesson/a' })`, `({ pathname: '/course/gt2/lesson/a' })`
  - → `true` for each (lesson id a/b, any course)
- `isFriendLesson({ search: '?shareCode=x', pathname: '/course/model/lesson/wa' })` and `({ search: '?SHARECODE=x', pathname: '/course/gt2/lesson/2-0' })`
  - → `true` for each (share code wins regardless of lesson id)
- `isFriendLesson({ pathname: '/course/model/lesson/g' })`, `({ pathname: '/course/model/lesson/wa' })`, `({ pathname: '/' })`, `({})`, `()`
  - → `false` for each
- `resolveGuestModalPlan({ isFriendLesson: true, detectedLang: 'ES' })`
  - → `{ action: 'adopt-silently', language: 'ES' }`
- `resolveGuestModalPlan({ isFriendLesson: true, detectedLang: 'EN' })`
  - → `{ action: 'open-language', friendMode: true }`
- `resolveGuestModalPlan({ isFriendLesson: false, detectedLang: 'ES' })` and `({ isFriendLesson: false, detectedLang: 'EN' })`
  - → `{ action: 'open-language', friendMode: false }` for each
- `resolveGuestModalPlan({ isFriendLesson: true, detectedLang: undefined })`, `('')`, `(null)`
  - → `{ action: 'open-language', friendMode: true }` for each (missing language falls back to EN)
- `resolveGuestModalPlan()`
  - → `{ action: 'open-language', friendMode: false }`

### Task 2 - Store actions (`src/modules/store/guest-modal-store.test.js`, new)

- `setGuestLanguageSilent('ES')` with `userData: null`
  - → `guestNativeLanguage === 'ES'`, `userData.native_language === 'ES'`, `isGuestModalOpen` unchanged (`false`), `guestModalStep` unchanged (`'select-language'`)
- `setGuestLanguageSilent('ES')` with `userData: { $id: 'guest', native_language: 'EN' }`
  - → `userData.native_language === 'ES'` and `userData.$id === 'guest'` (other keys preserved)
- `setGuestModalFriendMode(true)`
  - → `guestModalFriendMode === true`
- `guestModalFriendMode: false` + `isGuestModalOpen: true` + `confirmGuestLanguage('ES')`
  - → `guestModalStep === 'login-choice'`, `isGuestModalOpen` still `true`, `userData.native_language === 'ES'`, `guestNativeLanguage === 'ES'`
- `guestModalFriendMode: true` + `isGuestModalOpen: true` + `confirmGuestLanguage('ES')`
  - → `isGuestModalOpen === false`, `guestModalStep === 'select-language'` (never `login-choice`), `userData.native_language === 'ES'`
- `guestModalFriendMode: true` + `confirmGuestLanguage('OTHER')`
  - → `isGuestModalOpen === false`, `guestNativeLanguage === 'OTHER'`, `userData.native_language === 'OTHER'`

### Task 3 - Guard + modal wiring (`src/modules/user/friend-lesson-modals-wiring.test.js`, new)

- `src/hooks/use-guest-modal-guard.js` read as text
  - → imports `isFriendLesson` from `friend-lesson-detection.js` and `resolveGuestModalPlan` from `guest-modal-logic.js`
  - → calls `isFriendLesson({` with both `search` and `pathname`
  - → calls `resolveGuestModalPlan({`
  - → contains the `plan.action === 'adopt-silently'` branch and calls `setGuestLanguageSilent(plan.language)` inside it
  - → subscribes to store `userData` via `useStore(appStore` and re-applies `setGuestLanguageSilent` for the remembered language
- `src/components/modals/GuestLoginModal.web.jsx` read as text
  - → calls `confirmGuestLanguage`
  - → contains no `setGuestLanguageAndAdvance`
- `src/modules/store/store.js` read as text
  - → contains `guestModalFriendMode`, `setGuestModalFriendMode:`, `setGuestLanguageSilent:` and `confirmGuestLanguage:`
  - → contains no `setGuestLanguageAndAdvance:`

### Task 4 - Browser behavior (`tests/friend-lesson-modals.spec.js`, new Playwright)

- locale `es-ES` + `/course/friend/lesson/b?shareCode=friendtest1` loaded and app booted
  - → `window.appStore.getState().isGuestModalOpen === false`
  - → the `#guestLoginModal` dialog's `.open` property is `false`
  - → `window.appStore.getState().userData.native_language === 'ES'`
- locale `en-US` + `/course/friend/lesson/b?shareCode=friendtest1` loaded and app booted
  - → `#guestLanguageSelect` is visible
  - → `#guestLoginBtn` has count `0`
  - → after clicking `#guestEnglishOnlyBtn`, `isGuestModalOpen === false`, `guestModalStep === 'select-language'`, and `#guestLoginBtn` still has count `0`
- locale `en-US` + `/course/model/lesson/g` loaded and app booted
  - → `#guestLanguageSelect` is visible
  - → after clicking `#guestEnglishOnlyBtn`, `#guestLoginBtn` becomes visible (non-friend flow unchanged)

## Technical Context

- **No new dependencies.** Reuses React 19.2.0, `react-router-dom` 7.15.1, `zustand` 5.0.13 (`src/modules/store/store.js`), `@tanstack/react-query` 5.100.14. Unit tests: vitest 4.1.6 + jsdom 29.1.1 (`vitest.config.js` runs colocated `*.test.js`; it excludes `tests/**` and `*.spec.js`). Browser tests: `@playwright/test` 1.60.0 (`playwright.config.js`, `webServer: npx vite --port 5173`, `baseURL: http://localhost:5173`).
- **Existing detection primitives:** `detectBrowserLanguage()` is already exported from `use-guest-modal-guard.js` and returns an uppercase base code (`'EN'`, `'ES'`, `'HI'`…), falling back to `'EN'`. `App.jsx:19-37` already reads `?shareCode=` case-insensitively; this story only adds a second synchronous consumer, so route detection does not depend on that effect's timing.
- **`URLSearchParams` and `decodeURIComponent`** are global in Node 18+/jsdom, so the pure module needs no browser globals and is safe in vitest.
- **`playwright.config.js` `test.use({ locale })`** sets both `Accept-Language` and `navigator.language`; the app reads `navigator.language`, so the silent-adoption assertion is deterministic.
- **`guestModalStep`/`guestModalFriendMode`/`isGuestModalOpen` are not persisted** (not in the store's `partialize`); `guestNativeLanguage` and `friendCode` are persisted. Each Playwright test gets a fresh browser context, so localStorage starts clean.
- **The modal is closed by default** (`isGuestModalOpen: false`), so skipping the open is inherently flash-free; no pre-paint/DOM workaround is needed.
- **Store reset in tests:** `appStore.setState({...})` is the established pattern (`src/modules/store/store.test.js:7`).

## Notes

- **Confirmed product rule (user answer):** a friend lesson is `?shareCode=` in the URL **or** lesson id `a`/`b`, in any course. Because `src/config/model.json:261` and `src/config/gt2.json:7` also define a lesson `a` ("Soda 1"), those two *normal* lessons are now treated as friend lessons and will skip the guest login/language prompt. This is an accepted, explicit trade-off — course id is not used because course ids are open-ended.
- **Confirmed product rule (user answer):** friends are not blocked from logging in. The success-screen `SaveClipsModal` (after recording) and the HomeScreen menu `Sign In` remain the login paths; this story only suppresses the automatic prompt.
- **Confirmed product rule (user answer):** for a friend lesson with a non-English browser, adopt the detected language even when UFF has no translation for it (content falls back to English), matching existing guest-mode behavior.
- **Ordering fix rationale:** `useAppBootstrap` (`src/hooks/use-app-bootstrap-webonly.js:62`) writes `userData` from the guest profile (`native_language: 'EN'`) asynchronously; the guard can run first. The `silentLangRef` + `useStore(userData)` re-apply effect ensures the silently-adopted language survives that write without touching the bootstrap hook.
- **Preserved behavior:** for non-friend lessons the two-step modal is byte-for-byte unchanged in UI and strings; only the action name behind the three step-1 buttons changes (`setGuestLanguageAndAdvance` → `confirmGuestLanguage`), and `confirmGuestLanguage` reproduces the non-friend result exactly.
- **Logging (`agents.md` §2):** keep the existing `[GuestModalGuard]` logs, add a success log for the silent-adopt path, and add the friend flag to the open log. Do not remove existing logs.
- **Manual verification** (a real browser language and a real friend link cannot be fully simulated headlessly): set the browser to Spanish, open a friend link with `?shareCode=`, and confirm the lesson opens with no modal and Spanish overlays; switch the browser to English and confirm only the language step appears; open `/course/model/lesson/g` as a guest and confirm the two-step modal still appears.
