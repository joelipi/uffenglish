// src/components/homescreen/NotificationsBell.web.test.jsx
// The bell container: when unviewed notifications appear the inbox opens by
// itself — and in a lesson (the compact bell) it does not, so the learner
// only ever sees the bell icon there.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const apiMocks = vi.hoisted(() => ({
    // The rows the (stubbed) inbox currently holds.
    notifications: undefined,
    mutate: vi.fn(),
}));

vi.mock('../../modules/api/api.js', () => ({
    useNotifications: () => ({ data: apiMocks.notifications }),
    useMarkNotificationsRead: () => ({ mutate: apiMocks.mutate }),
}));

import NotificationsBell from './NotificationsBell.web.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const unreadRow = {
    id: 'n1',
    type: 'friend_response',
    created_at: '2026-09-24T11:00:00.000Z',
    read_at: null,
    payload: { actorShareCode: 'sam123', actorName: 'Sam' },
};
const readRow = { ...unreadRow, id: 'n2', read_at: '2026-09-24T12:00:00.000Z' };

describe('NotificationsBell.web', () => {
    let container;
    let root;

    const render = (props = {}) => {
        act(() => {
            root.render(React.createElement(NotificationsBell, { userId: 'u1', lang: 'en', ...props }));
        });
    };

    const panel = () => container.querySelector('[data-testid="notification-panel"]');
    const badge = () => container.querySelector('[data-testid="notification-badge"]');
    const clickBell = () => {
        const bell = container.querySelector('[data-testid="notification-bell"]');
        act(() => {
            bell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
    };

    beforeEach(() => {
        apiMocks.notifications = undefined;
        apiMocks.mutate.mockClear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        if (root) act(() => root.unmount());
        if (container) container.remove();
        root = null;
        container = null;
    });

    it('keeps the panel closed while there is nothing unviewed', () => {
        apiMocks.notifications = [];
        render();

        expect(container.querySelector('[data-testid="notification-bell"]')).not.toBeNull();
        expect(panel()).toBeNull();
        expect(badge()).toBeNull();
        expect(apiMocks.mutate).not.toHaveBeenCalled();
    });

    it('opens the panel by itself when a notification arrives, and views it', () => {
        apiMocks.notifications = [];
        render();
        expect(panel()).toBeNull();

        // A friend answers: the inbox now holds an unviewed notification.
        apiMocks.notifications = [unreadRow];
        render();

        expect(panel()).not.toBeNull();
        expect(container.querySelectorAll('[data-testid="notification-item"]')).toHaveLength(1);
        // The panel is on screen, so the notification counts as viewed.
        expect(apiMocks.mutate).toHaveBeenCalledWith({ userId: 'u1', ids: ['n1'] });
        // …and the badge shows the unread count until that lands.
        expect(badge().textContent).toBe('1');
    });

    it('opens the panel by itself when the learner comes back to a waiting inbox', () => {
        // The rows arrived while the app was closed: the first render already
        // carries them.
        apiMocks.notifications = [unreadRow, readRow];
        render();

        expect(panel()).not.toBeNull();
        expect(apiMocks.mutate).toHaveBeenCalledWith({ userId: 'u1', ids: ['n1'] });
    });

    it('keeps the bell icon only in a lesson (compact mode)', () => {
        apiMocks.notifications = [unreadRow];
        render({ compact: true });

        expect(container.querySelector('[data-testid="notification-bell"]')).not.toBeNull();
        expect(panel()).toBeNull();
        expect(apiMocks.mutate).not.toHaveBeenCalled();
        // The badge is the lesson's only signal.
        expect(badge().textContent).toBe('1');
    });

    it('does not open the panel when only viewed notifications are in the inbox', () => {
        apiMocks.notifications = [readRow];
        render();

        expect(panel()).toBeNull();
        expect(apiMocks.mutate).not.toHaveBeenCalled();
    });

    it('respects a manual close while no new notification arrives', () => {
        apiMocks.notifications = [unreadRow];
        render();
        expect(panel()).not.toBeNull();

        clickBell();
        expect(panel()).toBeNull();

        // The inbox is re-read (story 081) and nothing new arrived: the panel
        // must stay closed.
        render();
        expect(panel()).toBeNull();
    });

    it('opens by hand and marks the notifications read', () => {
        apiMocks.notifications = [];
        render();
        expect(panel()).toBeNull();

        apiMocks.notifications = [unreadRow];
        render({ compact: true });   // no auto-open in a lesson
        expect(panel()).toBeNull();

        clickBell();
        expect(panel()).not.toBeNull();
        expect(apiMocks.mutate).toHaveBeenCalledWith({ userId: 'u1', ids: ['n1'] });
    });
});

// The lesson carve-out depends on the compact bell being the LESSON's bell:
// ActivityStats renders it and ActivityStats is used only by LessonContainer.
describe('the compact bell is the lesson bell', () => {
    const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

    it('is rendered by ActivityStats with the compact prop', () => {
        const activityStats = read('../../components/widgets/ActivityStats.jsx');
        expect(activityStats).toContain('<NotificationsBell userId={userId} lang={lang} compact />');
    });

    it('is used only by the lesson container', () => {
        const activityStats = read('../../components/widgets/ActivityStats.jsx');
        const lessonContainer = read('../../components/LessonContainer.jsx');
        expect(lessonContainer).toContain('<ActivityStats />');
        expect(lessonContainer).toContain("import ActivityStats from './widgets/ActivityStats.jsx'");
        // The header (the app shell) renders the full-size bell.
        const appHeader = read('../../components/layout/AppHeader.web.jsx');
        expect(appHeader).toContain('<NotificationsBell userId={viewerId} lang={lang} />');
        expect(appHeader).not.toContain('compact');
    });
});
