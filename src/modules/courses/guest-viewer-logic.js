// Story 070 — lazy signup. The two pure rules the `/courses` page needs to tell
// a guest how to get an account. They live here, not in the component, so they
// are unit-testable without rendering (AGENTS.md: logic lives in modules,
// components render).
//
// The guest sentinel is deliberately NOT redefined here. `useUserProfile`'s
// core-data fallback supplies the literal 'guest' id and `CourseListings`
// already gated the install/notification banners on that exact value; reusing
// it is the point, because a second sentinel would show the guest notice to
// signed-in users (or hide it from guests).

/** Where a visitor who wants an account starts: the friend course list. */
export const COURSES_PATH = '/courses';

/**
 * True when `userId` is the anonymous placeholder rather than a real viewer.
 *
 * A missing id counts as a guest. The container resolves `undefined` while the
 * profile query is still loading, and a notice that flashes for a second at a
 * signed-in user is worse than one that appears a moment early.
 */
export function isGuestViewer(userId) {
    return !userId || userId === 'guest';
}

/**
 * Sign-in link that returns the visitor to `/courses` afterwards.
 *
 * `LoginRoute` reads the destination from the `redirect` search param, so it has
 * to be encoded — an unencoded path would still parse, but a nested one (this
 * is the pattern every entry point uses) would not survive a naive split.
 */
export function buildCoursesSignInHref() {
    return `/login?redirect=${encodeURIComponent(COURSES_PATH)}`;
}