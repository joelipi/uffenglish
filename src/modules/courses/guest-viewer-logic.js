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
 * `isResolving` matters, and is why this takes an options bag: while the profile
 * query is in flight OR has errored, the viewer is UNKNOWN, not anonymous. The
 * container passes `undefined` for both states, so treating a missing id as a
 * guest told a signed-in user cold-loading `/courses` (a bookmark, or the
 * notice's own sign-in link after a reload) that they were "not signed in" — and
 * withheld the install banner from them at the same time. An unknown viewer is
 * therefore NOT a guest; the notice waits for the query to settle. A *settled*
 * missing id still counts as a guest, so a caller that has no loading state to
 * report keeps the old behaviour.
 */
export function isGuestViewer(userId, { isResolving = false } = {}) {
    if (userId) return userId === 'guest';
    return !isResolving;
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
