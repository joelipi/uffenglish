import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the homepage/dashboard route split. The route table pulls in
// the full element graph (Supabase, preloader), so this asserts the wiring by
// raw source. `/home` must precede `/:shareCode` or `home` is captured as a
// share code.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, 'routes.jsx'), 'utf8');

describe('routes.jsx homepage split', () => {
    it('mounts PublicHomeRoute at /', () => {
        expect(src).toContain("{ path: '/', element: <PublicHomeRoute /> }");
    });

    it('mounts HomeRoute at /home', () => {
        expect(src).toContain("{ path: '/home', element: <HomeRoute /> }");
    });

    it('registers /home before the /:shareCode route', () => {
        const homeAt = src.indexOf("{ path: '/home', element: <HomeRoute /> }");
        const shareCodeAt = src.indexOf("{ path: '/:shareCode'");
        expect(homeAt).toBeGreaterThan(-1);
        expect(shareCodeAt).toBeGreaterThan(-1);
        expect(homeAt).toBeLessThan(shareCodeAt);
    });

    it('registers /confirm-email before the /:shareCode route', () => {
        const confirmAt = src.indexOf("{ path: '/confirm-email'");
        const shareCodeAt = src.indexOf("{ path: '/:shareCode'");
        expect(confirmAt).toBeGreaterThan(-1);
        expect(shareCodeAt).toBeGreaterThan(-1);
        expect(confirmAt).toBeLessThan(shareCodeAt);
    });

    it('mounts CoursesRoute at /courses before the /:shareCode route', () => {
        expect(src).toContain("{ path: '/courses', element: <CoursesRoute /> }");
        const coursesAt = src.indexOf("{ path: '/courses'");
        const shareCodeAt = src.indexOf("{ path: '/:shareCode'");
        expect(coursesAt).toBeGreaterThan(-1);
        expect(shareCodeAt).toBeGreaterThan(-1);
        expect(coursesAt).toBeLessThan(shareCodeAt);
    });

    it('renders the real 404 route for the catch-all instead of redirecting home', () => {
        // Story 071: a mistyped multi-segment path must not be swallowed by a
        // silent redirect. Assert on the catch-all line itself, so a comment
        // naming NotFoundRoute cannot satisfy the guard.
        const catchAllAt = src.indexOf("{ path: '*'");
        expect(catchAllAt).toBeGreaterThan(-1);
        const catchAllLine = src.slice(catchAllAt, src.indexOf('\n', catchAllAt));
        expect(catchAllLine).toContain('<NotFoundRoute />');
        expect(catchAllLine).not.toContain('Navigate');
        // Story 071 removed the silent bounce specifically; a future redirect
        // route elsewhere in the table is not what this guard is about.
        expect(src).not.toContain('<Navigate to="/" replace />');
    });

    it('declares the /:shareCode route before the catch-all', () => {
        const shareCodeAt = src.indexOf("path: '/:shareCode'");
        const catchAllAt = src.indexOf("path: '*'");
        expect(shareCodeAt).toBeGreaterThan(-1);
        expect(catchAllAt).toBeGreaterThan(-1);
        expect(shareCodeAt).toBeLessThan(catchAllAt);
    });

    // Story 070 closed the standalone signup page by redirecting it, NOT by
    // deleting it: this is an experiment with a plausible near-term reversal,
    // so the route and its component must stay resident and testable.
    describe('story 070 — /signup stays declared, only its reachability changed', () => {
        it('still imports SignupRoute and still mounts it at /signup', () => {
            expect(src).toMatch(/^import SignupRoute from '\.\/SignupRoute\.jsx';$/m);
            expect(src).toContain("{ path: '/signup', element: <AuthLayout />, children: [{ index: true, element: <SignupRoute /> }] }");
        });

        it('declares /signup before the /:shareCode catch-all', () => {
            // Declared after, `signup` is read as a share code and the redirect
            // never runs. The paren-qualified call token is searched, not a bare
            // `/signup`, so a comment naming the route cannot satisfy this.
            const signupAt = src.indexOf("path: '/signup'");
            const shareCodeAt = src.indexOf("path: '/:shareCode'");
            expect(signupAt).toBeGreaterThan(-1);
            expect(shareCodeAt).toBeGreaterThan(signupAt);
        });

        it('does not reach AuthLayout/SignupRoute at /signup, and SignupRoute no longer renders the form', () => {
            // The route keeps its AuthLayout wrapper but the child redirects, so
            // no signup form is reachable at /signup. Asserted on the component,
            // because a route-level check alone cannot see a form rendered by a
            // child element.
            //
            // The import and the element are matched with line anchors rather
            // than a bare `not.toContain('SignupForm')`: SignupRoute's own
            // comment explains where SignupForm went, so an unanchored search
            // would be satisfied by prose about the change (AGENTS.md).
            const signupRouteSrc = readFileSync(path.join(__dirname, 'SignupRoute.jsx'), 'utf8');
            expect(signupRouteSrc).not.toMatch(/^import\s+SignupForm\b/m);
            expect(signupRouteSrc).not.toMatch(/<SignupForm[\s/>]/);
            expect(signupRouteSrc).toMatch(/return\s*<Navigate\b/);
        });

        // Moved here from `home-navigation-wiring.test.js`, which was the third
        // home for the same three facts (AGENTS.md: one guard, one place).
        it('redirects to the course list and no longer honours ?redirect=', () => {
            const signupRouteSrc = readFileSync(path.join(__dirname, 'SignupRoute.jsx'), 'utf8');
            expect(signupRouteSrc).toContain('COURSE_LISTINGS_PATH');
            expect(signupRouteSrc).toContain('<Navigate to={COURSE_LISTINGS_PATH} replace />');
            // The param the entry points used to append is no longer read, so a
            // stale deep link cannot steer the redirect anywhere else.
            expect(signupRouteSrc).not.toContain('useSearchParams');
            expect(signupRouteSrc).not.toContain("searchParams.get('redirect')");
        });
    });

    it('sends the LessonError Go Home link to the dashboard at /home', () => {
        const errorAt = src.indexOf('function LessonError()');
        const errorBlock = src.slice(errorAt, src.indexOf('export const routes', errorAt));
        expect(errorAt).toBeGreaterThan(-1);
        expect(errorBlock).toContain('to="/home"');
        expect(errorBlock).not.toContain('to="/"');
    });
});
