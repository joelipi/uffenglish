// Which pages of the app are mounted INSIDE the app shell (the shared header)?
//
// The real route table is used with the pages stubbed, so this observes the
// route structure itself: every inside page must render the shared header,
// and the pages that keep their own chrome (the public landing page, the
// lesson player, the public share-code profile) must not.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

vi.mock('../hooks/usePreloader.js', () => ({
    usePreloader: () => ({ finishPreloader: vi.fn() }),
}));
vi.mock('../modules/api/api.js', () => ({
    useAuthStatus: () => ({ data: false }),
    useUserProfile: () => ({ data: null }),
    signOut: vi.fn(),
}));
vi.mock('../modules/utils/posthog.js', () => ({ trackEvent: vi.fn() }));
vi.mock('../components/homescreen/NotificationsBell.web.jsx', () => ({ default: () => null }));
vi.mock('../components/pwa/PWAInstallButton.web.jsx', () => ({ default: () => null }));
vi.mock('../components/notifications/PushNotificationsOptIn.web.jsx', () => ({ default: () => null }));

vi.mock('./RootLayout.jsx', async () => {
    const { Outlet } = await import('react-router-dom');
    const React = await import('react');
    return { default: () => React.createElement(Outlet) };
});
vi.mock('./HomeRoute.jsx', () => ({ default: () => React.createElement('div', { 'data-testid': 'page-home' }) }));
vi.mock('./ProfileRoute.jsx', () => ({ default: () => React.createElement('div', { 'data-testid': 'page-profile' }) }));
vi.mock('./CoursesRoute.jsx', () => ({ default: () => React.createElement('div', { 'data-testid': 'page-courses' }) }));
vi.mock('./WelcomeRoute.jsx', () => ({ default: () => React.createElement('div', { 'data-testid': 'page-welcome' }) }));
vi.mock('./TagRoute.jsx', () => ({ default: () => React.createElement('div', { 'data-testid': 'page-tag' }) }));
vi.mock('./FriendsRoute.jsx', () => ({ default: () => React.createElement('div', { 'data-testid': 'page-friends' }) }));
vi.mock('./PrivacyRoute.jsx', () => ({ default: () => React.createElement('div', { 'data-testid': 'page-privacy' }) }));
vi.mock('./TermsRoute.jsx', () => ({ default: () => React.createElement('div', { 'data-testid': 'page-terms' }) }));
vi.mock('./PublicHomeRoute.jsx', () => ({ default: () => React.createElement('div', { 'data-testid': 'page-landing' }) }));
vi.mock('./PublicProfileRoute.jsx', () => ({ default: () => React.createElement('div', { 'data-testid': 'page-public-profile' }) }));
vi.mock('./NotFoundRoute.jsx', () => ({ default: () => React.createElement('div', { 'data-testid': 'page-not-found' }) }));
vi.mock('./AppLayout.jsx', () => ({ default: () => React.createElement('div', { 'data-testid': 'page-lesson' }) }));
vi.mock('../components/LessonContainer.jsx', () => ({ default: () => React.createElement('div', { 'data-testid': 'page-lesson-content' }) }));
vi.mock('./AuthLayout.jsx', () => ({ default: () => React.createElement('div', { 'data-testid': 'page-auth' }) }));

import { routes } from './routes.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The inside pages of the app: every one of them shows the shared header.
// A topic page is declared with its param (`/tags/:tag`); the path rendered
// here carries a real tag. The public share-code profile and the 404 page are
// inside pages too (only the landing page and the lesson player keep their own
// chrome).
const INSIDE_PATHS = [
    '/home', '/profile', '/courses', '/friends', '/privacy', '/terms', '/welcome', '/tags/travel',
    '/login', '/signup', '/confirm-email', '/abcd', '/a/b/c',
];
// The same pages as they are DECLARED in the route table.
const DECLARED_INSIDE_PATHS = [
    '/home', '/profile', '/courses', '/friends', '/privacy', '/terms', '/welcome', '/tags/:tag',
    '/login', '/signup', '/recover-password', '/reset-password', '/confirm-email',
    '/:shareCode', '*',
];
// The pages that keep their own chrome: the public homepage (the root) and
// the lesson player.
const OUTSIDE_PATHS = ['/', '/course/model/lesson/m-g'];

describe('the shared header on every inside page', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
    });

    const renderAt = (entry) => {
        const router = createMemoryRouter(routes, { initialEntries: [entry] });
        root = createRoot(container);
        act(() => { root.render(React.createElement(RouterProvider, { router })); });
    };

    it.each(INSIDE_PATHS)('renders the shared header on %s', (entry) => {
        renderAt(entry);
        expect(container.querySelector('[data-testid="app-header"]')).not.toBeNull();
    });

    it.each(OUTSIDE_PATHS)('renders no shared header on %s', (entry) => {
        renderAt(entry);
        expect(container.querySelector('[data-testid="app-header"]')).toBeNull();
    });

    it('mounts the page below the header, inside the shell', () => {
        renderAt('/profile');
        const shell = container.querySelector('[data-testid="app-shell"]');
        const header = container.querySelector('[data-testid="app-header"]');
        const page = container.querySelector('[data-testid="page-profile"]');
        expect(shell).not.toBeNull();
        expect(shell.contains(header)).toBe(true);
        expect(shell.contains(page)).toBe(true);
        // The header comes first: the page is rendered in the region below it.
        expect(header.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
    });
});

describe('the app shell in the route table', () => {
    const src = readFileSync(path.join(__dirname, 'routes.jsx'), 'utf8');

    // The shell route's `children: [...]` array, bracket-matched (never to EOF).
    const shellChildren = () => {
        const shellAt = src.indexOf('element: <AppShellLayout />');
        expect(shellAt, 'the route table has no app shell').toBeGreaterThan(-1);
        const open = src.indexOf('children: [', shellAt);
        expect(open, 'the app shell has no children').toBeGreaterThan(shellAt);
        let depth = 0;
        for (let i = open + 'children: '.length; i < src.length; i += 1) {
            if (src[i] === '[') depth += 1;
            else if (src[i] === ']') {
                depth -= 1;
                if (depth === 0) return src.slice(open, i + 1);
            }
        }
        throw new Error('unterminated children array');
    };

    it('mounts exactly the inside pages under the shell', () => {
        const block = shellChildren();
        const paths = [...block.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
        expect(paths.sort()).toEqual([...DECLARED_INSIDE_PATHS].sort());
    });

    it('keeps the landing page and the lesson player out of the shell', () => {
        // Assert on the DECLARED paths, not on the raw block: a comment in the
        // block naming a route must not satisfy (or break) the guard.
        const paths = [...shellChildren().matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
        expect(paths).not.toContain('/');
        expect(paths.some((p) => p.startsWith('/course/'))).toBe(false);
    });

    it('mounts the public share-code profile and the 404 page inside the shell', () => {
        const paths = [...shellChildren().matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
        expect(paths).toContain('/:shareCode');
        expect(paths).toContain('*');
    });
});
