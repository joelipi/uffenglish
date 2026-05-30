# Routing Migration Plan

## Architecture

- **Router**: `createBrowserRouter` + `RouterProvider` (no route `loader`)
- **Route defs**: Shared `app/routes.jsx` for both web and React Native
- **Config data**: TanStack Query keyed by `courseId` — not from route loaders, not duplicated
- **Session/UI state**: Zustand (lesson index, step index, etc.)
- **URL**: Updates on lesson progression via `useNavigate` + `onLessonChange` callback in `lesson-progression.js`

## Steps

### 1. Create `app/routes.jsx` (shared)

```
app/
  routes.jsx        # shared route definitions, works for web + native
  router.web.jsx    # createBrowserRouter wrapping routes
  router.native.js  # createMemoryRouter wrapping routes (future)
  AppLayout.jsx     # bootstrap + auth + <Outlet />
```

`routes.jsx` contains only the two current routes:
- `/course/:courseId/lesson/:lessonId` → `<LessonContainer />`
- `*` → `<Navigate to="/course/gt2/lesson/a" replace />`

### 2. Create `app/router.web.jsx`

Wraps `routes` from `routes.jsx` with `createBrowserRouter`.

### 3. Rewrite `App.jsx`

Replace `<BrowserRouter><Routes>...</Routes></BrowserRouter>` with:
```jsx
<RouterProvider router={router} fallbackElement={<Spinner />} />
```

### 4. Create `app/AppLayout.jsx`

- Runs app-wide initialization (auth check, user profile, Appwrite setup) — this is the current bootstrap logic
- Uses TanStack Query to fetch config data by `courseId` from route params, with `enabled: !!courseId` guard to prevent firing on undefined `courseId` during wildcard redirect render
- While `courseId` is undefined (fractional frame during `*` → redirect), shows the spinner
- Renders `<Outlet />` once initialized, or a spinner
- Uses React Router's built-in `errorElement` prop on the `/course/:courseId/lesson/:lessonId` route for lesson-load failures (e.g. invalid courseId/lessonId), rather than a manual boundary — this avoids conflicting with the router's error handling

### 5. Refactor `useAppBootstrap.js`

- Remove all `window.location` parsing
- Accept `courseId` and `lessonId` as parameters (from route hooks)
- Bootstrap handles only auth, user profile, and infra setup — config fetching moves to TanStack Query in `AppLayout`

### 6. Refactor `useInitializeLesson.js`

- Remove third redundant `window.location` regex parse
- Remove inline URL-cleaning logic (URL is now always clean)
- `resolveCurrentLessonId` uses only the passed `lessonId` and persisted store state — no URL fallback

### 7. Add `pendingLessonNavigation` to Zustand store

Add a `pendingLessonNavigation` field to the Zustand store. In `loadNextLesson` (`lesson-progression.js`), instead of calling a callback, set the value:

```js
// lesson-progression.js, inside loadNextLesson
appStore.setState({ pendingLessonNavigation: nextLessonId });
```

In `LessonContainer`, a `useEffect` watches the field and navigates when it changes:

```jsx
const navigate = useNavigate();
const { courseId } = useParams();
const pendingNav = useStore(appStore, state => state.pendingLessonNavigation);

useEffect(() => {
    if (pendingNav) {
        navigate(`/course/${courseId}/lesson/${pendingNav}`, { replace: true });
        appStore.setState({ pendingLessonNavigation: null });
    }
}, [pendingNav, courseId, navigate]);
```

No singleton, no registration/cleanup, no overwrite risk. `lesson-progression.js` stays framework-agnostic — it already imports `appStore`. The React layer owns navigation entirely.

### 8. Fix `SuccessButtons.jsx` repeat button

Replace `window.location.href` with `navigate()` — no full-page reload, no query param override.

### 8b. Add TODO comment to wildcard route

The `*` route in `routes.jsx` hardcodes `/course/gt2/lesson/a`. Add a `TODO` comment noting this should become a proper default/home route when one exists — same category of debt as the close button in Step 9, so they get resolved together.

### 9. Fix close button in `LessonContainer`

Current `<Link to="/">` hits the wildcard route and redirects to `/course/gt2/lesson/a`. Replace with `<Link to="..">` (relative to parent route, i.e. `/course/${courseId}`) or `<Link to="/">` with course-aware redirect. Since no home route exists yet, keep `<Link to="/">` (same visible behavior, but via React Router's `<Link>` not hardcoded). Mark with a `TODO` to route to a proper home page when one is added.

### 10. Delete dead files

- `js/hooks/navigation.js`
- `js/hooks/navigation.web.js`

## File Manifest

| Action | File |
|---|---|
| Create | `app/routes.jsx` |
| Create | `app/router.web.jsx` |
| Create | `app/AppLayout.jsx` |
| Rewrite | `App.jsx` |
| Refactor | `js/hooks/useAppBootstrap.js` |
| Refactor | `js/hooks/useInitializeLesson.js` |
| Refactor | `js/components/SuccessButtons.jsx` |
| Refactor | `js/components/LessonContainer.jsx` |
| Refactor | `js/modules/lesson-progression.js` (add `setOnLessonChange`) |
| Delete | `js/hooks/navigation.js` |
| Delete | `js/hooks/navigation.web.js` |

## Test Plan

1. 140 vitest unit tests pass
2. Playwright smoke test (`tests/answer-flow.spec.js`) on `/course/model/lesson/g` — full flow works
3. Manual: navigate to `/course/model/lesson/g`, complete lesson, verify URL changes to next lesson on progression
4. Manual: reload during lesson, verify resume at correct step
5. Manual: navigate to `/`, verify redirect to default lesson
6. Manual: navigate to invalid course/lesson, verify error handling
