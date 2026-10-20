// The shared app header: the brand bar (menu button, UFF logo, notification
// bell) and the slide-out navigation drawer. The header is mounted once by
// the app shell, so it is the SAME header on every inside page of the app.
//
// Rendered with react-dom/client createRoot + act (the repo convention).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';

const apiMocks = vi.hoisted(() => ({
    useAuthStatusImpl: vi.fn(() => ({ data: false })),
    useUserProfileImpl: vi.fn(() => ({ data: null })),
    signOutImpl: vi.fn(async () => {}),
}));

vi.mock('../../modules/api/api.js', () => ({
    useAuthStatus: (...args) => apiMocks.useAuthStatusImpl(...args),
    useUserProfile: (...args) => apiMocks.useUserProfileImpl(...args),
    signOut: (...args) => apiMocks.signOutImpl(...args),
}));
vi.mock('../../modules/utils/posthog.js', () => ({ trackEvent: vi.fn() }));
// The bell, the install entry and the push entry have their own tests; here
// they are stubs so the header's own contract is under test.
vi.mock('../homescreen/NotificationsBell.web.jsx', () => ({
    default: ({ userId }) => React.createElement('div', { 'data-testid': 'notification-bell' }, userId),
}));
vi.mock('../pwa/PWAInstallButton.web.jsx', () => ({
    default: ({ label }) => React.createElement('button', { type: 'button', 'data-testid': 'install-app' }, label),
}));
vi.mock('../notifications/PushNotificationsOptIn.web.jsx', () => ({
    default: () => React.createElement('div', { 'data-testid': 'push-enable' }),
}));

import AppHeader from './AppHeader.web.jsx';
import { APP_MENU_ITEMS } from '../../modules/navigation/app-menu-logic.js';
import Strings from '../../data/strings.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('AppHeader', () => {
    let container;
    let root;
    let locations;

    function LocationProbe() {
        const location = useLocation();
        useEffect(() => {
            locations.push(location.pathname);
        }, [location]);
        return null;
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        locations = [];
        apiMocks.useAuthStatusImpl.mockReturnValue({ data: false });
        apiMocks.useUserProfileImpl.mockReturnValue({ data: null });
        apiMocks.signOutImpl.mockReset();
        apiMocks.signOutImpl.mockResolvedValue(undefined);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        container.remove();
        root = null;
    });

    async function renderHeader() {
        // A container can only be attached to one root at a time, so a re-render
        // (a different viewer state) unmounts the previous one first.
        if (root) {
            act(() => root.unmount());
            root = null;
        }
        root = createRoot(container);
        await act(async () => {
            root.render(
                React.createElement(MemoryRouter, { initialEntries: ['/profile'] },
                    React.createElement(LocationProbe),
                    React.createElement(AppHeader)
                )
            );
        });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }

    async function openMenu() {
        await renderHeader();
        const button = container.querySelector('[data-testid="app-header"] button');
        expect(button).not.toBeNull();
        await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }

    it('renders the UFF logo image in the top bar instead of the text headline', async () => {
        await renderHeader();
        const logo = container.querySelector('[data-testid="home-logo"]');
        expect(logo).not.toBeNull();
        expect(logo.tagName).toBe('IMG');
        expect(logo.getAttribute('alt')).toBe('Ultra Fast Fluency');
        expect(container.textContent).not.toContain('Ultra Fast Fluency');
    });

    it('opens the drawer with an entry for every inside page', async () => {
        await openMenu();
        const links = Array.from(container.querySelectorAll('nav a'));
        const hrefs = links.map((a) => a.getAttribute('href'));
        for (const item of APP_MENU_ITEMS) {
            expect(hrefs, item.path).toContain(item.path);
        }
        // The landing page and the lesson player are not drawer entries.
        expect(hrefs).not.toContain('/');
    });

    it('navigates to the entry the user tapped', async () => {
        await openMenu();
        const link = Array.from(container.querySelectorAll('nav a'))
            .find((a) => a.getAttribute('href') === '/friends');
        expect(link).toBeTruthy();
        await act(async () => { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(locations[locations.length - 1]).toBe('/friends');
    });

    it('shows the notification bell for a signed-in user and a spacer for a guest', async () => {
        apiMocks.useAuthStatusImpl.mockReturnValue({ data: true });
        apiMocks.useUserProfileImpl.mockReturnValue({ data: { $id: 'user-1' } });
        await renderHeader();
        expect(container.querySelector('[data-testid="notification-bell"]')).not.toBeNull();

        // A guest stub is not an account: no bell.
        apiMocks.useUserProfileImpl.mockReturnValue({ data: { $id: 'guest' } });
        await renderHeader();
        expect(container.querySelector('[data-testid="notification-bell"]')).toBeNull();
    });

    it('offers the install and push entries to a signed-in user only', async () => {
        apiMocks.useAuthStatusImpl.mockReturnValue({ data: true });
        apiMocks.useUserProfileImpl.mockReturnValue({ data: { $id: 'user-1' } });
        await openMenu();
        expect(container.querySelector('[data-testid="install-app"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="push-enable"]')).not.toBeNull();

        apiMocks.useUserProfileImpl.mockReturnValue({ data: { $id: 'guest' } });
        await openMenu();
        expect(container.querySelector('[data-testid="install-app"]')).toBeNull();
        expect(container.querySelector('[data-testid="push-enable"]')).toBeNull();
    });

    it('shows sign in for a guest and sign out for a signed-in user', async () => {
        await openMenu();
        expect(container.textContent).toContain(Strings.get('sign_in', 'en'));

        apiMocks.useAuthStatusImpl.mockReturnValue({ data: true });
        await openMenu();
        expect(container.textContent).toContain(Strings.get('sign_out', 'en'));
    });

    it('signs out and returns to the public homepage', async () => {
        apiMocks.useAuthStatusImpl.mockReturnValue({ data: true });
        await openMenu();
        const signOut = Array.from(container.querySelectorAll('button'))
            .find((b) => b.textContent.includes(Strings.get('sign_out', 'en')));
        expect(signOut).toBeTruthy();
        await act(async () => { signOut.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(apiMocks.signOutImpl).toHaveBeenCalled();
        expect(locations[locations.length - 1]).toBe('/');
    });

    it('closes the drawer on Escape', async () => {
        await openMenu();
        expect(container.querySelector('nav')).not.toBeNull();
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(container.querySelector('nav')).toBeNull();
    });
});
