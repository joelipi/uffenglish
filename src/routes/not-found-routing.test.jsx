import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

// The real route table pulls in every page's element graph (Supabase, the
// preloader, the lesson player). Mock the pages so this test observes route
// matching itself, while `PublicProfileRoute` and `NotFoundRoute` stay real —
// the share-code shape gate and the 404 page are what is under test.
const finishPreloader = vi.fn();
vi.mock('../hooks/usePreloader.js', () => ({
    usePreloader: () => ({ finishPreloader }),
}));
vi.mock('../hooks/use-native-language.js', () => ({
    useNativeLanguage: () => 'en',
}));
vi.mock('../components/profile/PublicProfile.jsx', () => ({
    default: ({ shareCode }) => React.createElement('div', { 'data-testid': 'public-profile' }, shareCode),
}));

vi.mock('./RootLayout.jsx', async () => {
    const { Outlet } = await import('react-router-dom');
    const React = await import('react');
    return { default: () => React.createElement(Outlet) };
});
// The profile and the 404 page are inside the app shell now, so the shell's
// header renders with them. This test is about route matching, not the
// header, so the header is stubbed (the shared header has its own guard).
vi.mock('../components/layout/AppHeader.web.jsx', () => ({ default: () => null }));
vi.mock('./AppLayout.jsx', () => ({ default: () => null }));
vi.mock('./AuthLayout.jsx', () => ({ default: () => null }));
vi.mock('./HomeRoute.jsx', () => ({ default: () => null }));
vi.mock('./PublicHomeRoute.jsx', () => ({ default: () => null }));
vi.mock('./ProfileRoute.jsx', () => ({ default: () => null }));
vi.mock('./LoginRoute.jsx', () => ({ default: () => null }));
vi.mock('./SignupRoute.jsx', () => ({ default: () => null }));
vi.mock('./RecoverPasswordRoute.jsx', () => ({ default: () => null }));
vi.mock('./ResetPasswordRoute.jsx', () => ({ default: () => null }));
vi.mock('./ConfirmEmailRoute.jsx', () => ({ default: () => null }));
vi.mock('../components/LessonContainer.jsx', () => ({ default: () => null }));
vi.mock('./FriendsRoute.jsx', () => ({ default: () => null }));
vi.mock('./PrivacyRoute.jsx', () => ({ default: () => null }));
vi.mock('./TermsRoute.jsx', () => ({ default: () => null }));
vi.mock('./CoursesRoute.jsx', () => ({ default: () => null }));

import { routes } from './routes.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('unknown-URL routing', () => {
    let container;
    let root;

    beforeEach(() => {
        finishPreloader.mockClear();
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
        return router;
    };

    const lastMatch = (router) => router.state.matches[router.state.matches.length - 1];

    it('finishes the preloader exactly once on the 404 branch', () => {
        renderAt('/nonsense');
        expect(container.querySelector('[data-testid="not-found-route"]')).not.toBeNull();
        expect(finishPreloader).toHaveBeenCalledTimes(1);
    });

    it('finishes the preloader exactly once on the profile branch', () => {
        renderAt('/abcd');
        expect(container.querySelector('[data-testid="public-profile"]')).not.toBeNull();
        expect(finishPreloader).toHaveBeenCalledTimes(1);
    });

    it('renders the 404 page for a two-or-more-segment unknown URL', () => {
        const router = renderAt('/a/b/c');
        expect(container.querySelector('[data-testid="not-found-route"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="public-profile"]')).toBeNull();
        expect(lastMatch(router).route.path).toBe('*');
    });

    it('renders the 404 page for a one-segment URL that cannot be a share code', () => {
        // `/nonsense` matches `/:shareCode` structurally; the shape gate is
        // what must stop it from rendering "User not found".
        const router = renderAt('/nonsense');
        expect(container.querySelector('[data-testid="not-found-route"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="public-profile"]')).toBeNull();
        expect(lastMatch(router).route.path).toBe('/:shareCode');
    });

    it('still routes a real 4-char share code to the profile page', () => {
        const router = renderAt('/abcd');
        expect(container.querySelector('[data-testid="public-profile"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="not-found-route"]')).toBeNull();
        expect(lastMatch(router).route.path).toBe('/:shareCode');
    });

    it('still routes a real 5-char share code to the profile page', () => {
        renderAt('/k9gyi');
        expect(container.querySelector('[data-testid="public-profile"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="not-found-route"]')).toBeNull();
    });

    it('normalizes an uppercase segment and routes it to the profile', () => {
        const router = renderAt('/Abcd');
        const profile = container.querySelector('[data-testid="public-profile"]');
        expect(profile).not.toBeNull();
        expect(profile.textContent).toBe('abcd'); // lookup sees the stored lowercase code
        expect(container.querySelector('[data-testid="not-found-route"]')).toBeNull();
        expect(lastMatch(router).route.path).toBe('/:shareCode');
    });

    it.each(['/ABCD', '/aBcDe', '/K9GYI'])(
        'normalizes %s to the stored lowercase code',
        (path) => {
            renderAt(path);
            const profile = container.querySelector('[data-testid="public-profile"]');
            expect(profile).not.toBeNull();
            expect(profile.textContent).toBe(path.slice(1).toLowerCase());
            expect(container.querySelector('[data-testid="not-found-route"]')).toBeNull();
        },
    );

    it('treats a truncated segment as a path, not a share code', () => {
        renderAt('/abc');
        expect(container.querySelector('[data-testid="not-found-route"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="public-profile"]')).toBeNull();
    });
});
