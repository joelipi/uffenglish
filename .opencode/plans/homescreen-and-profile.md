# Plan: React Homescreen & User Profile

## Goal
Replace the standalone `homescreen.html` with a React component integrated into React Router, and create a new user profile page. Both use the existing app's styling conventions (custom Bootstrap subset, dark theme, Bootstrap Icons).

---

## Decisions

- **Homescreen layout:** Minimal — course listing, hamburger menu, continue button in bottom bar
- **Course data:** Fetches `/js/config/model.json` via TanStack Query, shows name + level + lesson count
- **Continue link:** Reads `courseId` + `activeLessonId` from Zustand store (both must exist), links to `/course/{courseId}/lesson/{activeLessonId}`
- **Profile page uses a wider standalone layout** (not `AuthLayout`'s 420px card)
- **Name changes sync TWO places:** `account.updateName(fullName)` for Account-level + TablesDB for firstName/lastName
- **Email changes need current password** — separate form with password confirmation
- **After `account.updateEmail()`:** Show message telling user to check inbox for verification
- **Guests see limited profile** — tell them to sign up, fields are read-only
- **Back button** on profile to return to homescreen
- **Sign out** → redirects to `/`

---

## Phase 1: Homescreen Component

### 1.1 `app/HomeRoute.jsx`

Thin wrapper with no AppLayout (no lesson bootstrap needed).

```jsx
// Just renders HomeScreen component
```

### 1.2 `js/components/homescreen/HomeScreen.jsx`

**Layout (top to bottom):**

1. **Top bar:** Dark bar with hamburger icon (left), "Ultra Fast Fluency" title (center)

2. **Hamburger overlay menu** (React state `menuOpen`):
   - Home (link to `/`, closes menu)
   - Profile (link to `/profile`, closes menu)
   - Divider
   - Sign In / Sign Out (conditional on `isLoggedIn`)
   - Click outside or Escape → closes menu

3. **Main content:**
   - Heading: "Courses"
   - Loading spinner while config fetch is in progress
   - Error message if config fetch fails
   - Course card for `model.json`:
     - Course name: "Grocery Shopping"
     - Level badge: "B1"
     - Lesson count: "4 lessons"
     - Click → navigate(`/course/model/lesson/g`)

4. **Bottom bar** (fixed-bottom):
   - "Continue" button (visible only if `courseId` AND `activeLessonId` both exist in Zustand)
   - Button text: "Continue →" or "Continue Lesson"
   - Click → navigate(`/course/{courseId}/lesson/{activeLessonId}`)

**Hooks:**
- `useNavigate()` for navigation
- `useStore(appStore, ...)` for `isLoggedIn`, `courseId`, `activeLessonId`
- `useQuery(['config', 'model'], ...)` for course config

### 1.3 Update `app/routes.jsx`

```jsx
{ path: '/', element: <HomeRoute /> },
// ... auth routes ...
// ... lesson routes ...
{ path: '/profile', element: <ProfileRoute /> },
{ path: '*', element: <Navigate to="/" replace /> }
```

---

## Phase 2: User Profile Component

### 2.1 `app/ProfileRoute.jsx`

Thin wrapper. No AuthLayout or AppLayout — standalone page.

### 2.2 `js/components/profile/UserProfile.jsx`

**Sections:**

1. **Header:** Back arrow (to `/`), title "Profile"

2. **Profile header card:**
   - Profile picture (`profilepicurl`, fallback to `/assets/img/userprofile.png`)
   - Display name (from Account `name`, shown but not editable here)
   - Email (shown but not editable here)
   - Member since (formatted `join_date`, read-only)

3. **Editable fields form:**
   - First Name — text input
   - Last Name — text input
   - Native Language — select dropdown
   - English Level — select dropdown
   - Save button → `syncUserMetaDataMutation()` for TablesDB + `account.updateName(fullName)` for Account
   - Success/error feedback

4. **Change email section:**
   - New Email — email input
   - Current Password — password input (required for `account.updateEmail`)
   - Update Email button → `account.updateEmail(newEmail, currentPassword)`
   - Success: "Verification email sent. Check your inbox."

5. **Change password section:**
   - Current Password — password input
   - New Password — password input (min 8 chars)
   - Confirm New Password — password input
   - Update Password button → `account.updatePassword(newPassword, oldPassword)`
   - Success/error feedback

6. **Stats section:**
   - Lessons completed count
   - Current streak (calculated from `completed_dates`)
   - English level badge
   - (Used only for display, from `useUserProfile()`)

**Guest state:** If `user.$id === 'guest'`, show a message: "Sign up to save your progress and access your profile." with a link to `/signup`. All fields read-only or hidden.

**Data source:** `useUserProfile()` from `api.js`, `account` from `appwrite.js`

### 2.3 `js/components/profile/UserProfile.native.jsx`

Stub with correct export signature.

---

## Phase 3: Cleanup

### 3.1 Delete `homescreen.html`
### 3.2 Grep for remaining `homescreen.html` references, update to `/`
### 3.3 Verify `vite.config.js` — ensure homescreen entry removed (already done)

---

## Execution Order

| Phase | What | Files | Verify |
|-------|------|-------|--------|
| 1 | HomeScreen + HomeRoute + edit routes.jsx | 2 new + 1 edit | `npm run build` |
| 2 | UserProfile + ProfileRoute + native stub | 3 new | `npm run build` |
| 3 | Delete homescreen.html + cleanup | 1 delete | `npm run build` |

---

## Files Changed

**New:**
- `app/HomeRoute.jsx`
- `js/components/homescreen/HomeScreen.jsx`
- `app/ProfileRoute.jsx`
- `js/components/profile/UserProfile.jsx`
- `js/components/profile/UserProfile.native.jsx` (stub)

**Edited:**
- `app/routes.jsx`

**Deleted:**
- `homescreen.html`
