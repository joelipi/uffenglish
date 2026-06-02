# Plan: Cross-Platform Auth (Login, Signup, Password Reset)

## Goal
Convert the standalone HTML auth pages into React components that work on both web (Vite + React Router) and React Native (Expo + Expo Router). The core Appwrite SDK logic is already cross-platform — this plan creates the UI layer.

---

## Decisions

- **Web navigation:** React Router (not `window.location.href`)
- **Native navigation:** Expo Router
- **Auth pages get their own layout** (centered card, no sidebar) — separate from `AppLayout`
- **HTML pages get deleted** after React forms are verified working
- **Form components are navigation-agnostic** — callbacks only, platform wrappers connect to their router

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
- `login.html` — standalone HTML page with inline JS → replaced by `LoginForm.jsx`
- `signup.html` — standalone HTML page with inline JS → replaced by `SignupForm.jsx`
- `recover-password.html` — standalone HTML page → replaced by `RecoverPasswordForm.jsx`
- `reset-password.html` — standalone HTML page → replaced by `ResetPasswordForm.jsx`
- `js/components/modals/GuestLoginModal.jsx` — uses `<dialog>` element → split into `.web.jsx` + `.native.jsx`
- `js/hooks/use-app-bootstrap-webonly.js` — web bootstrap hook → needs native counterpart
- `js/hooks/app-infra-webonly.js` — web infrastructure → needs native counterpart

---

## Phase 1: Create React Auth Form Components

Create shared React components in `js/components/auth/`. These import directly from the existing cross-platform `modules/api/` code.

### 1.1 `js/components/auth/LoginForm.jsx`

React form component. Replaces `login.html`.

```
Exports: LoginForm (default)
Props: onLoginSuccess?, onSignupLink?, onForgotPassword?
```

**Behavior:**
- Email + password inputs
- On submit: `account.createEmailPasswordSession(email, password)` (from `appwrite.js`)
- Calls `invalidateUserAndAuthCache()` (from `api.js`)
- On success: calls `onLoginSuccess()` callback
- "Forgot password?" link → calls `onForgotPassword()` callback
- "Sign up" link → calls `onSignupLink()` callback
- Error handling: shows inline error message
- No web-only APIs used — pure React state + Appwrite SDK

### 1.2 `js/components/auth/SignupForm.jsx`

React form component. Replaces `signup.html`.

```
Exports: SignupForm (default)
Props: onSignupSuccess?, onLoginLink?
```

**Behavior:**
- First name, last name, email, password, native language, English level inputs
- On submit:
  1. `account.create(ID.unique(), email, password, fullName)` — create account
  2. `account.createEmailPasswordSession(email, password)` — create session
  3. `tablesDB.createRow(...)` — create profile row
  4. `collectSignupGeoAndReferrer()` — fire-and-forget (dynamic import)
  5. `invalidateUserAndAuthCache()` — bust cache
- On success: calls `onSignupSuccess()` callback
- "Already have an account?" link → calls `onLoginLink()` callback
- Error handling: inline validation + API error display
- No web-only APIs — pure React + Appwrite SDK

### 1.3 `js/components/auth/RecoverPasswordForm.jsx`

React form component. Replaces `recover-password.html`.

```
Exports: RecoverPasswordForm (default)
Props: onBackToLogin?
```

**Behavior:**
- Email input
- On submit: `account.createEmailPassword(email, redirectUrl)`
  - `redirectUrl` is platform-specific, passed via `getAppOrigin()` from `url-params.js` + path
  - Web: `window.location.origin + '/reset-password'`
  - Native: deep link URL
- Show success message: "Check your email for reset link"
- "Back to login" link → calls `onBackToLogin()` callback

### 1.4 `js/components/auth/ResetPasswordForm.jsx`

React form component. Replaces `reset-password.html`.

```
Exports: ResetPasswordForm (default)
Props: onResetSuccess?, onError?
```

**Behavior:**
- Reads `userId` and `secret` from URL params via `getUrlParam()` from `url-params.js`
- New password + confirm password inputs
- On submit: `account.updateRecovery(userId, secret, password, passwordConfirm)`
- On success: shows success message, calls `onResetSuccess()`

### 1.5 `js/components/auth/index.js`

Barrel export:
```js
export { default as LoginForm } from './LoginForm.jsx';
export { default as SignupForm } from './SignupForm.jsx';
export { default as RecoverPasswordForm } from './RecoverPasswordForm.jsx';
export { default as ResetPasswordForm } from './ResetPasswordForm.jsx';
```

---

## Phase 2: Fix GuestLoginModal for Cross-Platform

### 2.1 Split `js/components/modals/GuestLoginModal.jsx`

The current implementation uses the HTML `<dialog>` element with `.showModal()` / `.close()` — web-only.

**Approach:** Create a platform-split pair:
- `GuestLoginModal.web.jsx` — keeps current `<dialog>` implementation
- `GuestLoginModal.native.jsx` — uses React Native `<Modal>` from `react-native`

**Shared logic:** The modal content (title, buttons, link handlers) is identical. Both variants:
- Read `guestModalOpen` from Zustand store
- Show three options: Log In, Sign Up, Continue as Guest
- "Log In" → calls `onLogin()` callback
- "Sign Up" → calls `onSignup()` callback
- "Continue as Guest" → `appStore.getState().setGuestModalOpen(false)`

**Web variant (`GuestLoginModal.web.jsx`):** Keep `<dialog>` with `.showModal()` / `.close()`. Use `useNavigate()` from React Router for navigation callbacks.

**Native variant (`GuestLoginModal.native.jsx`):** Use `react-native`'s `<Modal>` with `<View>` for overlay, `<TouchableOpacity>` for buttons. Use `useRouter()` from Expo Router for navigation callbacks.

---

## Phase 3: URL Params Utility

### 3.1 `js/modules/utils/url-params.js` + `.web.js` + `.native.js`

A small platform-split utility for reading URL parameters and getting the app origin.

**`url-params.web.js`:**
```js
export function getUrlParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}
export function getAppOrigin() {
    return window.location.origin;
}
```

**`url-params.native.js`:**
```js
import * as Linking from 'expo-linking';

export function getUrlParam(name) {
    const url = Linking.useURL?.() ?? null;
    if (!url) return null;
    const params = new URL(url).searchParams;
    return params.get(name);
}
export function getAppOrigin() {
    return Linking.createURL('/');
}
```

**`url-params.js` (router):**
```js
export { getUrlParam, getAppOrigin } from './url-params.web.js';
```

**Used by:** `RecoverPasswordForm` (for `redirectUrl`), `ResetPasswordForm` (for `userId`/`secret`).

---

## Phase 4: Native Bootstrap Hooks

### 4.1 `js/hooks/app-infra-native.js`

React Native equivalent of `app-infra-webonly.js`. Responsibilities:
- Initialize Appwrite client (already cross-platform)
- Set up TanStack Query client (already cross-platform)
- Wire Zustand store subscriptions
- Detect guest mode and trigger login/signup navigation
- No web-only APIs

**Key difference from web:** Instead of attaching to `window.appStore`, just export the store. Instead of `window.enabledLogs`, use a module-level flag.

### 4.2 `js/hooks/use-app-bootstrap-native.js`

React Native equivalent of `use-app-bootstrap-webonly.js`. Responsibilities:
- Run `useAuthStatus()` to check session
- Run `useUserProfile()` to load profile
- Set `isLoggedIn` in Zustand store
- Handle guest mode detection
- No `document.getElementById`, no `window.appStore`

---

## Phase 5: Route Integration

### 5.1 Web Routes (React Router)

**New file: `app/AuthLayout.jsx`**

A centered card layout for auth pages — no sidebar, no lesson loading. Renders children (the form component) in a centered container with the app logo/branding.

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

**Updated `app/routes.jsx`:**

```jsx
import { Navigate, Link } from 'react-router-dom';
import AppLayout from './AppLayout.jsx';
import AuthLayout from './AuthLayout.jsx';
import LessonContainer from '../js/components/LessonContainer.jsx';
import LoginForm from '../js/components/auth/LoginForm.jsx';
import SignupForm from '../js/components/auth/SignupForm.jsx';
import RecoverPasswordForm from '../js/components/auth/RecoverPasswordForm.jsx';
import ResetPasswordForm from '../js/components/auth/ResetPasswordForm.jsx';

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
        element: (
            <AuthLayout>
                <LoginForm
                    onLoginSuccess={() => window.location.href = '/'}
                    onSignupLink={() => window.location.href = '/signup'}
                    onForgotPassword={() => window.location.href = '/recover-password'}
                />
            </AuthLayout>
        )
    },
    {
        path: '/signup',
        element: (
            <AuthLayout>
                <SignupForm
                    onSignupSuccess={() => window.location.href = '/'}
                    onLoginLink={() => window.location.href = '/login'}
                />
            </AuthLayout>
        )
    },
    {
        path: '/recover-password',
        element: (
            <AuthLayout>
                <RecoverPasswordForm
                    onBackToLogin={() => window.location.href = '/login'}
                />
            </AuthLayout>
        )
    },
    {
        path: '/reset-password',
        element: (
            <AuthLayout>
                <ResetPasswordForm
                    onResetSuccess={() => window.location.href = '/login'}
                />
            </AuthLayout>
        )
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

**Note:** Auth route callbacks use `window.location.href` (not `useNavigate()`) because the auth components receive callbacks as props — the route definitions are outside any React component, so hooks can't be used there. The callbacks are simple redirects that work fine with `window.location.href`. If we want full SPA navigation, we'd wrap each route in a small component that uses `useNavigate()`, but for auth pages a full page reload is acceptable and simpler.

**Delete after verification:**
- `login.html`
- `signup.html`
- `recover-password.html`
- `reset-password.html`

### 5.2 Native Routes (Expo Router)

In the Expo app, auth screens would be:
```
app/
├── (auth)/
│   ├── login.jsx          → renders LoginForm
│   ├── signup.jsx         → renders SignupForm
│   ├── recover.jsx        → renders RecoverPasswordForm
│   └── reset.jsx          → renders ResetPasswordForm
```

Each screen is a thin wrapper:
```jsx
import { LoginForm } from '../../components/auth';
import { useRouter } from 'expo-router';

export default function LoginScreen() {
    const router = useRouter();
    return (
        <LoginForm
            onLoginSuccess={() => router.replace('/(main)')}
            onSignupLink={() => router.push('/(auth)/signup')}
            onForgotPassword={() => router.push('/(auth)/recover')}
        />
    );
}
```

---

## Execution Order

| Phase | What | Verify |
|-------|------|--------|
| 1 | Create 4 auth form components + barrel export | `npm run build` |
| 2 | Split GuestLoginModal into `.web.jsx` + `.native.jsx` | `npm run build` |
| 3 | Create url-params utility with platform split | `npm run build` |
| 4 | Create native bootstrap hooks | `npm run build` |
| 5 | Route integration (web routes + delete HTML pages + native stubs) | `npm run build` + manual test |

---

## What This Does NOT Change

- `appwrite.js` — no changes (already cross-platform)
- `api.js` — no changes (already cross-platform)
- `user-profile.js` — no changes (already cross-platform)
- `collect-signup-data.js` — no changes (already cross-platform)
- `store.js` — no changes (auth state already works)
- No new npm dependencies (Appwrite SDK already supports RN, Expo Linking is built-in)

---

## Verification

After Phase 1:
- Web: Render `<LoginForm />` in a test route, verify login flow works
- Web: Render `<SignupForm />` in a test route, verify signup flow works

After Phase 2:
- Web: GuestLoginModal still works with `<dialog>`
- Native: GuestLoginModal renders with React Native `<Modal>`

After Phase 4:
- Native: Bootstrap hook initializes without web-only API errors

After Phase 5:
- Web: `/login`, `/signup`, `/recover-password`, `/reset-password` routes work
- Web: After login, redirects to lesson page
- HTML pages deleted, no broken links
