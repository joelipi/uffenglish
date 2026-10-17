import { describe, it, expect } from 'vitest';
import { COURSE_LISTINGS_PATH } from '../courses/friend-courses-logic.js';
import { isGuestViewer, buildCoursesSignInHref } from './guest-viewer-logic.js';

describe('isGuestViewer', () => {
    it('treats the shared "guest" sentinel as anonymous', () => {
        // The literal comes from useUserProfile's core-data fallback; reusing it
        // is what keeps the guest notice and the signed-in-only banners in step.
        expect(isGuestViewer('guest')).toBe(true);
    });

    it('treats a missing id as anonymous once the profile query has settled', () => {
        // A settled query always yields the sentinel or a real id, so a bare
        // missing id means "no loading state to report" — the old behaviour.
        expect(isGuestViewer(undefined)).toBe(true);
        expect(isGuestViewer(null)).toBe(true);
        expect(isGuestViewer('')).toBe(true);
        expect(isGuestViewer(0)).toBe(true);
    });

    it('does NOT call an unknown viewer a guest while the profile query loads', () => {
        // Story 070 review: a signed-in user cold-loading /courses must not be
        // told "You're not signed in". An unresolved profile is unknown, not
        // anonymous.
        expect(isGuestViewer(undefined, { isResolving: true })).toBe(false);
        expect(isGuestViewer(null, { isResolving: true })).toBe(false);
        // The sentinel is a positive answer, so resolving cannot overturn it.
        expect(isGuestViewer('guest', { isResolving: true })).toBe(true);
        expect(isGuestViewer('user-1', { isResolving: true })).toBe(false);
    });

    it('treats any real id as signed in', () => {
        expect(isGuestViewer('user-1')).toBe(false);
        expect(isGuestViewer('a0f1c2e3-0000-0000-0000-000000000000')).toBe(false);
        // Near-misses on the sentinel must not read as anonymous, or a real
        // user silently gets the guest notice.
        expect(isGuestViewer('Guest')).toBe(false);
        expect(isGuestViewer('guests')).toBe(false);
        expect(isGuestViewer(' guest')).toBe(false);
    });

    it('pairs the notice and the signed-in banners on one predicate', () => {
        // `CourseListings` renders the notice for `isGuest` and the
        // install/notification banners for `!isGuest`, so exactly one of the two
        // blocks renders for any viewer. The expectations are a table, not a
        // re-evaluation of the implementation, so this can fail.
        const cases = [
            ['guest', true],
            ['user-1', false],
            // Near-misses on the sentinel are real ids, or a real user silently
            // gets the guest notice.
            ['Guest', false],
            ['guests', false],
            // Settled with no id reported: the old "no loading state" contract.
            [undefined, true],
        ];
        for (const [id, expectedGuest] of cases) {
            const isGuest = isGuestViewer(id);
            expect(isGuest, `isGuestViewer(${String(id)})`).toBe(expectedGuest);
            expect(!isGuest, 'the signed-in banner gate').toBe(!expectedGuest);
        }
    });
});

describe('buildCoursesSignInHref', () => {
    it('points at the login page and returns the visitor to /courses', () => {
        const href = buildCoursesSignInHref();
        expect(href).toBe('/login?redirect=%2Fcourses');
    });

    it('survives the decode LoginRoute performs on the redirect param', () => {
        const href = buildCoursesSignInHref();
        const params = new URLSearchParams(href.slice(href.indexOf('?')));
        expect(params.get('redirect')).toBe('/courses');
        expect(params.get('redirect')).toBe(COURSE_LISTINGS_PATH);
    });
});

describe('COURSE_LISTINGS_PATH', () => {
    it('is the path CoursesRoute is registered at', () => {
        // Single source for both the notice's sign-in link and the /signup
        // redirect, so the two can never drift apart.
        expect(COURSE_LISTINGS_PATH).toBe('/courses');
    });
});
