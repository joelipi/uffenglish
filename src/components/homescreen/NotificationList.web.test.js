// src/components/homescreen/NotificationList.web.test.js
// Presentational unit tests for the notification list. Rendered with
// createRoot + act (pattern from src/components/intro-caller-name.test.js);
// this imports only the presentational component, so no Supabase/api graph is
// pulled into vitest.
import { describe, it, expect, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import NotificationList from './NotificationList.web.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fresh = {
    id: 'n1',
    type: 'friend_response',
    created_at: '2026-09-24T11:00:00.000Z',
    read_at: null,
    payload: { actorShareCode: 'sam123', actorName: 'Sam' },
};
const older = {
    id: 'n2',
    type: 'friend_response',
    created_at: '2026-09-22T03:00:00.000Z',
    read_at: '2026-09-22T04:00:00.000Z',
    payload: { actorShareCode: 'lee456', actorName: 'Lee' },
};

describe('NotificationList.web', () => {
    let container;
    let root;

    const render = (notifications, { lang = 'en', onSelect } = {}) => {
        // Tear down any previous render so repeated render() calls in one test
        // do not leak containers attached to document.body.
        if (root) act(() => root.unmount());
        if (container) container.remove();
        root = null;
        container = null;

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => {
            root.render(
                React.createElement(NotificationList, { notifications, lang, onSelect })
            );
        });
    };

    afterEach(() => {
        if (root) act(() => root.unmount());
        if (container) container.remove();
        root = null;
        container = null;
    });

    it('renders the message, profile link and timestamp', () => {
        render([older, fresh]);

        const items = container.querySelectorAll('[data-testid="notification-item"]');
        expect(items).toHaveLength(2);

        const first = items[0];
        expect(first.textContent).toContain('Sam continued your conversation lesson! 🥳See if you need to respond.');
        const link = first.querySelector('[data-testid="notification-link"]');
        expect(link.getAttribute('href')).toBe(`${window.location.origin}/sam123`);
        expect(first.querySelector('[data-testid="notification-timestamp"]').textContent).not.toBe('');
    });

    it('no row promises a reply: the 48-hour deadline line is gone', () => {
        // The line said "You only have 48 hours to respond" on EVERY
        // friend_response — including the one the chain's closing lesson
        // produces, where there is no lesson left to respond to. It was
        // removed, not reworded, so the row must not carry it any more.
        render([older, fresh]);
        expect(container.querySelectorAll('[data-testid="notification-deadline"]')).toHaveLength(0);
        expect(container.textContent).not.toContain('48 hours');
    });

    it('localizes the message', () => {
        render([fresh], { lang: 'es' });
        expect(container.textContent).toContain('Sam ¡continuó tu lección de conversación! 🥳Mira si necesitas responder.');
    });

    it('omits the timestamp when created_at is invalid but keeps the rest', () => {
        render([{ ...fresh, created_at: 'not-a-date' }]);
        expect(container.querySelector('[data-testid="notification-item"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="notification-timestamp"]')).toBeNull();
    });

    it('calls onSelect when a linked item is clicked', () => {
        const onSelect = vi.fn();
        render([fresh], { onSelect });

        const link = container.querySelector('[data-testid="notification-link"]');
        // jsdom has no navigation; cancel the anchor default so it does not log
        // "Not implemented: navigation". The React onClick handler still runs.
        link.addEventListener('click', (event) => event.preventDefault());
        act(() => {
            link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith(fresh);
    });

    it('renders the empty state for no notifications', () => {
        render([]);
        expect(container.querySelector('[data-testid="notification-empty"]')).not.toBeNull();
        expect(container.querySelectorAll('[data-testid="notification-item"]')).toHaveLength(0);

        render(null);
        expect(container.querySelector('[data-testid="notification-empty"]')).not.toBeNull();
    });

    it('falls back to "A friend" when the actor name is missing', () => {
        render([{ ...fresh, payload: { actorShareCode: 'sam123' } }]);
        expect(container.textContent).toContain('A friend continued your conversation lesson! 🥳See if you need to respond.');
    });

    it('renders a non-link message when the actor share code is missing', () => {
        render([{ ...fresh, payload: { actorName: 'Sam' } }]);
        expect(container.querySelectorAll('[data-testid="notification-item"]')).toHaveLength(1);
        expect(container.querySelector('[data-testid="notification-link"]')).toBeNull();
        expect(container.textContent).toContain('Sam continued your conversation lesson! 🥳See if you need to respond.');
    });
});
