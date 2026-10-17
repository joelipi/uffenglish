import { describe, it, expect } from 'vitest';
import { COURSES_PATH, isGuestViewer, buildCoursesSignInHref } from './guest-viewer-logic.js';

describe('isGuestViewer', () => {
    it('treats the shared "guest" sentinel as anonymous', () => {
        // The literal comes from useUserProfile's core-data fallback; reusing it
        // is what keeps the guest notice and the signed-in-only banners in step.
        expect(isGuestViewer('guest')).toBe(true);
    });

    it('treats a missing id as anonymous while the profile query loads', () => {
        expect(isGuestViewer(undefined)).toBe(true);
        expect(isGuestViewer(null)).toBe(true);
        expect(isGuestViewer('')).toBe(true);
        expect(isGuestViewer(0)).toBe(true);
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

    it('is the exact complement of the signed-in banner gate', () => {
        // The install banner and notification prompt render for signed-in
        // viewers only; deriving both from one predicate means they can never
        // disagree about who is a guest.
        for (const id of ['guest', undefined, null, '', 'user-1', 'Guest']) {
            expect(isGuestViewer(id)).toBe(!(id && id !== 'guest'));
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
        expect(params.get('redirect')).toBe(COURSES_PATH);
    });
});

describe('COURSES_PATH', () => {
    it('is the path CoursesRoute is registered at', () => {
        // Single source for both the notice's sign-in link and the /signup
        // redirect, so the two can never drift apart.
        expect(COURSES_PATH).toBe('/courses');
    });
});