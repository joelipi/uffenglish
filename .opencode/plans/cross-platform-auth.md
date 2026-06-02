# Plan: Cross-Platform Auth (Login, Signup, Password Reset)

## Goal
Convert the standalone HTML auth pages into React components for the **web app** (Vite + React Router). Create correct cross-platform file structure with native stubs so the Expo app inherits a clear contract without speculative UI code.

---

## Decisions

- **Web navigation:** React Router with `useNavigate()` (no `window.location.href` — preserves SPA state)
- **Auth pages get their own layout** (centered card, no sidebar) — separate from `AppLayout`
- **HTML pages get deleted** after React forms are verified working
- **Native: stubs only** — `.native.jsx` files get the correct export signature and a `// TODO` body. No StyleSheet implementations, no React Native primitives. Real native work moves to a separate plan when Expo development begins.
- **Phase 4 (native bootstrap hooks) deferred** — pure native concern, no web work unblocked by writing them now
- **Appwrite redirect URL:** Must whitelist custom scheme (e.g., `uffenglish://`) in Appwrite Console for native password reset deep linking (future concern)

---

## Current State

**Already cross-platform (no changes needed):**
- `js/modules/api/appwrite.js` — Appwrite SDK client, `account`, `tablesDB`, `ID` exports
- `js/modules/api/api.js` — `signOut()`, `isUserLoggedIn()`, `getUserProfile()`, `useAuthStatus()`, `useUserProfile()`, `syncUserMetaDataMutation()`, `invalidateUserAndAuthCache()`
- `js/modules/user/user-profile.js` — `syncUserMetaData()`, `saveLessonProgress()`, `saveCourseToUserProfile()`, `syncOfflineScores()`, `calculateCurrentStreak()`
- `js/modules/user/collect-signup-data.js` — geo/referrer collection (already has platform-split imports)
- `js/components/AuthLink.jsx` — React component, reads `isLoggedIn` from Zustand store
- `js/modules/store/store.js` — Zustand store (`isLoggedIn`, `setIsLoggedIn()`)

**Web-only (must be replaced or deleted):**
- `login.html` — standalone HTML page with inline JS → replaced by `LoginForm.web.jsx`
- `signup.html` — standalone HTML page with inline JS → replaced by `SignupForm.web.jsx`
- `recover-password.html` — standalone HTML page → replaced by `RecoverPasswordForm.web.jsx`
- `reset-password.html` — standalone HTML page → replaced by `ResetPasswordForm.web.jsx`
- `js/components/modals/GuestLoginModal.jsx` — uses `<dialog>` element → rename to `.web.jsx`

---

## Phase 1: Create React Auth Form Components

Create form components in `js/components/auth/` with `.web.jsx` / `.native.jsx` split. The logic (Appwrite SDK calls, state management, error handling) is shared. The UI primitives differ per platform.

### Shared Logic Pattern

Each form has a shared logic file and two platform renderers:

```
LoginForm.jsx          → shared logic (Appwrite calls, state, handlers) — built now
LoginForm.web.jsx      → web UI (<form>, <input>, <button>) — built now
LoginForm.native.jsx   → stub with correct export signature — future
```

The shared `.jsx` file exports a `useLoginForm()` hook containing all Appwrite SDK logic. The `.web.jsx` file imports this hook and renders HTML primitives. The `.native.jsx` file is a stub.

### 1.1 `js/components/auth/LoginForm.jsx` + `LoginForm.web.jsx` + `LoginForm.native.jsx`

**`LoginForm.jsx` (shared logic) — build now:**
- Email + password state
- On submit: `account.createEmailPasswordSession(email, password)` (from `appwrite.js`)
- Calls `invalidateUserAndAuthCache()` (from `api.js`)
- On success: calls `onLoginSuccess()` callback
- Error handling: stores error message in state
- No web-only APIs — pure React state + Appwrite SDK

**`LoginForm.web.jsx` — build now:**
- Imports `useLoginForm` from `./LoginForm.jsx`
- Renders `<form>`, `<input type="email">`, `<input type="password">`, `<button type="submit">`
- Bootstrap classes for styling

**`LoginForm.native.jsx` — stub:**
```jsx
// TODO: Implement with React Native primitives (<View>, <TextInput>, <TouchableOpacity>)
// Contract: default export LoginForm component with props { onLoginSuccess?, onSignupLink?, onForgotPassword? }
// Shared logic lives in ./LoginForm.jsx — import useLoginForm() from there.
export default function LoginForm({ onLoginSuccess, onSignupLink, onForgotPassword }) {
    return null; // placeholder
}
```

### 1.2 `js/components/auth/SignupForm.jsx` + `SignupForm.web.jsx` + `SignupForm.native.jsx`

**`SignupForm.jsx` (shared logic) — build now:**
- First name, last name, email, password, native language, English level state
- On submit:
  1. `account.create(ID.unique(), email, password, fullName)` — create account
  2. `account.createEmailPasswordSession(email, password)` — create session
  3. Wait briefly for session to propagate (avoid race condition with DB permissions)
  4. `tablesDB.createRow(...)` — create profile row
  5. `collectSignupGeoAndReferrer()` — fire-and-forget (dynamic import)
  6. `invalidateUserAndAuthCache()` — bust cache
- Error handling: inline validation + API error display

**`SignupForm.web.jsx` — build now:**
- Imports `useSignupForm` from `./SignupForm.jsx`
- Renders all form fields with HTML primitives and Bootstrap classes

**`SignupForm.native.jsx` — stub:**
```jsx
// TODO: Implement with React Native primitives
// Contract: default export SignupForm component with props { onSignupSuccess?, onLoginLink? }
export default function SignupForm({ onSignupSuccess, onLoginLink }) {
    return null;
}
```

### 1.3 `js/components/auth/RecoverPasswordForm.jsx` + `RecoverPasswordForm.web.jsx` + `RecoverPasswordForm.native.jsx`

**`RecoverPasswordForm.jsx` (shared logic) — build now:**
- Email input state
- On submit: `account.createRecovery(email, resetUrl)` (Appwrite SDK v24 method)
  - `resetUrl` = `getAppOrigin()` (from Phase 3) + `'/reset-password'`
  - Web: `window.location.origin + '/reset-password'`
  - Native (future): `uffenglish://reset-password`
- Show success message: "Check your email for reset link"

**`RecoverPasswordForm.web.jsx` — build now:**
- Imports `useRecoverPasswordForm` from `./RecoverPasswordForm.jsx`
- Renders email input + submit button

**`RecoverPasswordForm.native.jsx` — stub:**
```jsx
// TODO: Implement with React Native primitives
// Contract: default export RecoverPasswordForm component with props { onBackToLogin? }
export default function RecoverPasswordForm({ onBackToLogin }) {
    return null;
}
```

### 1.4 `js/components/auth/ResetPasswordForm.jsx` + `ResetPasswordForm.web.jsx` + `ResetPasswordForm.native.jsx`

**`ResetPasswordForm.jsx` (shared logic) — build now:**
- Reads `userId` and `secret` from URL params via `getUrlParam()` from `url-params.js`
- New password + confirm password state
- On submit: `account.updateRecovery(userId, secret, password, passwordConfirm)`
- On success: shows success message, calls `onResetSuccess()`

**`ResetPasswordForm.web.jsx` — build now:**
- Imports `useResetPasswordForm` from `./ResetPasswordForm.jsx`
- Renders new password + confirm password inputs

**`ResetPasswordForm.native.jsx` — stub:**
```jsx
// TODO: Implement with React Native primitives
// Contract: default export ResetPasswordForm component with props { onResetSuccess?, onError? }
export default function ResetPasswordForm({ onResetSuccess, onError }) {
    return null;
}
```

### 1.5 `js/components/auth/index.js`

Barrel export:
```js
export { default as LoginForm } from './LoginForm.web.jsx';
export { default as SignupForm } from './SignupForm.web.jsx';
export { default as RecoverPasswordForm } from './RecoverPasswordForm.web.jsx';
export { default as ResetPasswordForm } from './ResetPasswordForm.web.jsx';
```

Note: The barrel exports the `.web.jsx` versions for Vite (which resolves `.web.jsx` first via `resolve.extensions`). The Expo app imports `.native.jsx` directly.

**Metro bundler caveat (future):** React Native's Metro bundler can sometimes resolve barrel files differently than Vite regarding `.web` vs `.native` extensions. If you encounter "Module not found" errors in Expo, either configure Metro's `resolver.sourceExts` in `metro.config.js` to prioritize `.native.jsx`, or bypass the barrel file entirely in Expo screens and import `LoginForm.native.jsx` directly.

---

## Phase 2: Rename GuestLoginModal for Web

### 2.1 Rename `js/components/modals/GuestLoginModal.jsx` → `GuestLoginModal.web.jsx`

The current implementation uses the HTML `<dialog>` element with `.showModal()` / `.close()` — web-only. Rename to `.web.jsx` to follow the platform split convention.

Create `GuestLoginModal.native.jsx` as a stub:
```jsx
// TODO: Implement with React Native <Modal> from react-native
// Contract: default export GuestLoginModal component (reads guestModalOpen from Zustand store)
export default function GuestLoginModal() {
    return null;
}
```

---

## Phase 3: URL Params Utility

### 3.1 `js/modules/utils/url-params.js` + `.web.js` + `.native.js`

A small platform-split utility for reading URL parameters and getting the app origin.

**`url-params.web.js` — build now:**
```js
export function getUrlParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}
export function getAppOrigin() {
    return window.location.origin;
}
```

**`url-params.native.js` — stub:**
```js
// TODO: Implement with expo-linking
// Contract: useUrlParam(name) hook, getAppOrigin() function
//
// ⚠️ DO NOT import from url-params.js (the router) in native code.
// The router hardcodes web exports. Import from this file directly:
//   import { useUrlParam, getAppOrigin } from './url-params.native.js';
export function useUrlParam(name) {
    // TODO: use useURL() from expo-linking to read deep link params
    return null;
}
export function getAppOrigin() {
    // TODO: use Linking.createURL('/') from expo-linking
    return '';
}
```

Note: Native uses `useUrlParam()` (React hook) instead of `getUrlParam()` (plain function) because `useURL()` is a hook. The web version uses a plain function. The shared logic files should use the hook interface (web version wraps `getUrlParam` in a hook for consistency).

**`url-params.js` (router):**
```js
export { getUrlParam, getAppOrigin } from './url-params.web.js';
```

**Used by:** `RecoverPasswordForm` (for `redirectUrl`), `ResetPasswordForm` (for `userId`/`secret`).

---

## Phase 4: Route Integration (Web)

### 4.1 Web Routes (React Router)

**Problem:** Route definitions in `routes.jsx` are static objects — can't use React hooks (`useNavigate()`) there. But `window.location.href` destroys SPA state.

**Solution:** Use small wrapper components that have access to `useNavigate()`.

**New file: `app/AuthLayout.jsx`**

A centered card layout for auth pages — no sidebar, no lesson loading.

```jsx
import { Outlet } from 'react-router-dom';

export default function AuthLayout() {
    return (
        <div className="d-flex align-items-center justify-content-center vh-100">
            <div className="card shadow-sm" style={{ maxWidth: 420, width: '100%' }}>
                <div className="card-body p-4">
                    <Outlet />
                </div>
            </div>
        </div>
    );
}
```

**New file: `app/LoginRoute.jsx`** (and similar for each auth route)

A thin wrapper that renders the form and connects callbacks to `useNavigate()`:

```jsx
import { useNavigate } from 'react-router-dom';
import LoginForm from '../js/components/auth/LoginForm.web.jsx';

export default function LoginRoute() {
    const navigate = useNavigate();
    return (
        <LoginForm
            onLoginSuccess={() => navigate('/')}
            onSignupLink={() => navigate('/signup')}
            onForgotPassword={() => navigate('/recover-password')}
        />
    );
}
```

Same pattern for `SignupRoute.jsx`, `RecoverPasswordRoute.jsx`, `ResetPasswordRoute.jsx`.

**Updated `app/routes.jsx`:**

```jsx
import { Navigate, Link } from 'react-router-dom';
import AppLayout from './AppLayout.jsx';
import AuthLayout from './AuthLayout.jsx';
import LoginRoute from './LoginRoute.jsx';
import SignupRoute from './SignupRoute.jsx';
import RecoverPasswordRoute from './RecoverPasswordRoute.jsx';
import ResetPasswordRoute from './ResetPasswordRoute.jsx';
import LessonContainer from '../js/components/LessonContainer.jsx';

function LessonError() {
    return (
        <div className="d-flex flex-column align-items-center justify-content-center vh-100">
            <h2>Lesson not found</h2>
            <p>The course or lesson you requested does not exist.</p>
            <Link to="/" className="btn btn-primary">Go Home</Link>
        </div>
    );
}

export const routes = [
    // Auth routes (own layout, no sidebar)
    {
        path: '/login',
        element: <AuthLayout />,
        children: [
            { index: true, element: <LoginRoute /> }
        ]
    },
    {
        path: '/signup',
        element: <AuthLayout />,
        children: [
            { index: true, element: <SignupRoute /> }
        ]
    },
    {
        path: '/recover-password',
        element: <AuthLayout />,
        children: [
            { index: true, element: <RecoverPasswordRoute /> }
        ]
    },
    {
        path: '/reset-password',
        element: <AuthLayout />,
        children: [
            { index: true, element: <ResetPasswordRoute /> }
        ]
    },

    // Lesson routes (with AppLayout)
    {
        path: '/course/:courseId/lesson/:lessonId',
        element: <AppLayout />,
        errorElement: <LessonError />,
        children: [
            { index: true, element: <LessonContainer /> }
        ]
    },

    // Default redirect
    {
        path: '/',
        element: <Navigate to="/course/gt2/lesson/a" replace />
    },
    {
        path: '*',
        element: <Navigate to="/" replace />
    }
];
```

**Delete after verification:**
- `login.html`
- `signup.html`
- `recover-password.html`
- `reset-password.html`

---

## Execution Order

| Phase | What | Files Created | Verify |
|-------|------|---------------|--------|
| 1 | Auth form components | 13 (4 shared `.jsx` + 4 web `.web.jsx` + 4 native stubs + 1 barrel `index.js`) | `npm run build` |
| 2 | GuestLoginModal rename + native stub | 1 rename + 1 new stub | `npm run build` |
| 3 | url-params utility | 2 new (`url-params.web.js`, `url-params.js` router) + 1 stub (`url-params.native.js`) | `npm run build` |
| 4 | Route integration (web wrappers + delete HTML pages) | 5 new (`AuthLayout.jsx` + 4 route wrappers) | `npm run build` + manual test |

**Total:** 22 files created (4 shared logic + 4 web renderers + 5 native stubs + 1 barrel + 3 url-params + 5 route files). 4 HTML pages deleted. 1 file renamed.

---

## What This Does NOT Change

- `appwrite.js` — no changes (already cross-platform)
- `api.js` — no changes (already cross-platform)
- `user-profile.js` — no changes (already cross-platform)
- `collect-signup-data.js` — no changes (already cross-platform)
- No new npm dependencies (Appwrite SDK already supports RN, Expo Linking is built-in)

---

## Deferred to Native Plan

The following are **not** part of this plan — they move to a separate native-phase plan when Expo development begins:

- Full `.native.jsx` implementations (LoginForm, SignupForm, RecoverPasswordForm, ResetPasswordForm, GuestLoginModal)
- `app-infra-native.js` and `use-app-bootstrap-native.js` (native bootstrap hooks)
- Deep link handling for password reset (`uffenglish://reset-password`)
- Expo Router screen files (`app/(auth)/login.jsx`, etc.)
- Metro bundler configuration for `.web`/`.native` extension resolution
- Zustand persistence cross-platform storage engine (`@react-native-async-storage/async-storage`)

---

## Zustand Persistence (Future Concern)

`store.js` uses `persist` middleware with `partialize` to save lesson scores, fluency metrics, gamification data, and tutor engagement stats to `localStorage`. This works on web but **not on React Native** — `localStorage` doesn't exist there.

**Not blocking for this plan** — no auth data is persisted (only `isLoggedIn` which is in-memory). Lesson progress and gamification state will be lost on mobile app restart until addressed in the native plan.

---

## Verification

After Phase 1:
- Web: Render `LoginForm.web.jsx` in a test route, verify login flow works
- Web: Render `SignupForm.web.jsx` in a test route, verify signup flow works

After Phase 2:
- Web: GuestLoginModal still works with `<dialog>`

After Phase 4:
- Web: `/login`, `/signup`, `/recover-password`, `/reset-password` routes work
- Web: After login, navigates to lesson page (no full reload, SPA state preserved)
- HTML pages deleted, no broken links
